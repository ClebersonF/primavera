import { PmoError } from "../errors";
import { dataBr, daysBetween, isIsoDate, isObj, nonNeg, optText, text, type Nivel } from "./common";
import { FRENTES_OBRA, type FrenteObra } from "./campo";
import { rncAberta, type Rnc } from "./qualidade";
import type { Boletim } from "./medicao";

/**
 * Fase 4 do documento — suprimentos: fornecedor homologado (métricas SP, garantia mínima de 5 anos,
 * ABNT/concessionárias, regularidade trabalhista/SST), cotação com no mínimo 3 homologados
 * e repositório de revisão única vigente das pranchas.
 */

export const CERTIDOES = ["cnd_federal", "fgts", "trabalhista", "estadual", "municipal"] as const;
export type Certidao = (typeof CERTIDOES)[number];
export const CERTIDAO_LABEL: Record<Certidao, string> = { cnd_federal: "CND Federal", fgts: "CRF/FGTS", trabalhista: "CNDT (trabalhista)", estadual: "CND Estadual", municipal: "CND Municipal" };

export interface Fornecedor {
  id: string;
  nome: string;
  /** Só dígitos. */
  cnpj?: string;
  frentes: FrenteObra[];
  /** Experiência comprovada em SP. */
  experienciaSp: { m3?: number; m2?: number; m?: number };
  garantiaAnos: number;
  abnt: boolean;
  /** Validade de cada certidão (AAAA-MM-DD). */
  certidoes: Partial<Record<Certidao, string>>;
  sstIntegracaoEm?: string;
  contato?: string;
}

export const MAX_FORNECEDORES = 300;
export const GARANTIA_MINIMA_ANOS = 5;

export function cleanFornecedor(v: unknown): Fornecedor | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 40), nome = text(v.nome, 160);
  if (!id || !nome || !nonNeg(v.garantiaAnos) || v.garantiaAnos > 50 || typeof v.abnt !== "boolean") return null;
  const frentes = (Array.isArray(v.frentes) ? v.frentes : []).filter((f): f is FrenteObra => (FRENTES_OBRA as readonly unknown[]).includes(f));
  const exp = isObj(v.experienciaSp) ? v.experienciaSp : {};
  const f: Fornecedor = {
    id, nome, frentes: [...new Set(frentes)], garantiaAnos: v.garantiaAnos, abnt: v.abnt,
    experienciaSp: { ...(nonNeg(exp.m3) ? { m3: exp.m3 } : {}), ...(nonNeg(exp.m2) ? { m2: exp.m2 } : {}), ...(nonNeg(exp.m) ? { m: exp.m } : {}) },
    certidoes: {},
  };
  const cnpj = typeof v.cnpj === "string" ? v.cnpj.replace(/\D/g, "") : "";
  if (cnpj.length === 14) f.cnpj = cnpj;
  if (isObj(v.certidoes)) for (const c of CERTIDOES) if (isIsoDate(v.certidoes[c])) f.certidoes[c] = v.certidoes[c] as string;
  if (isIsoDate(v.sstIntegracaoEm)) f.sstIntegracaoEm = v.sstIntegracaoEm;
  const contato = optText(v.contato, 160);
  if (contato) f.contato = contato;
  return f;
}

export function nextFornecedorId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, "")) || 0), 0);
  return `F-${String(n + 1).padStart(3, "0")}`;
}

export interface Homologacao {
  apto: boolean;
  pendencias: string[];
  /** Certidões que vencem em até 30 dias. */
  vencendo: Certidao[];
}

export function homologacao(f: Fornecedor, hoje: string): Homologacao {
  const p: string[] = [];
  const exp = f.experienciaSp;
  if (!((exp.m3 ?? 0) > 0 || (exp.m2 ?? 0) > 0 || (exp.m ?? 0) > 0)) p.push("Sem experiência comprovada em SP (m³, m² ou m)");
  if (f.garantiaAnos < GARANTIA_MINIMA_ANOS) p.push(`Garantia de ${f.garantiaAnos} ano(s): o mínimo é ${GARANTIA_MINIMA_ANOS}`);
  if (!f.abnt) p.push("Sem declaração de conformidade ABNT/concessionárias");
  const vencendo: Certidao[] = [];
  for (const c of CERTIDOES) {
    const val = f.certidoes[c];
    if (!val) p.push(`${CERTIDAO_LABEL[c]} não informada`);
    else if (val < hoje) p.push(`${CERTIDAO_LABEL[c]} vencida em ${dataBr(val)}`);
    else if (daysBetween(hoje, val) <= 30) vencendo.push(c);
  }
  if (f.frentes.length === 0) p.push("Nenhuma frente de serviço informada");
  return { apto: p.length === 0, pendencias: p, vencendo };
}

/**
 * Score 0–100: começa em 100 e perde por RNC (grave 15, leve 5; aberta há mais de 7 dias, mais 5),
 * por boletim devolvido (3) e por certidão vencida (10). Não substitui a homologação.
 */
export function scoreFornecedor(f: Fornecedor, rncs: readonly Rnc[], boletins: readonly Boletim[], hoje: string): number {
  let s = 100;
  for (const r of rncs) {
    if (r.fornecedorId !== f.id) continue;
    s -= r.gravidade === "grave" ? 15 : 5;
    if (rncAberta(r) && daysBetween(r.abertaEm.slice(0, 10), hoje) > 7) s -= 5;
  }
  for (const b of boletins) if (b.fornecedorId === f.id && b.devolucao) s -= 3;
  for (const c of CERTIDOES) if (f.certidoes[c] && f.certidoes[c]! < hoje) s -= 10;
  return Math.max(0, Math.min(100, s));
}

export const nivelScore = (s: number): Nivel => (s >= 80 ? "verde" : s >= 60 ? "amarelo" : "vermelho");

/* ------------------------------------ Cotações ------------------------------------ */

export interface Proposta {
  fornecedorId: string;
  valor: number;
  prazoDias: number;
  obs?: string;
}

export interface Cotacao {
  id: string;
  titulo: string;
  /** Requisição técnica (F4.01): escopo e quantitativos. */
  escopo: string;
  frente?: FrenteObra;
  trechoId?: string;
  atividadeId?: string;
  /** Pranchas citadas, com a revisão vigente no momento da requisição. */
  pranchas: { codigo: string; rev: string }[];
  criadaEm: string;
  criadaPor: string;
  propostas: Proposta[];
  escolha?: { fornecedorId: string; justificativa?: string; em: string; por: string; solicitacaoId?: string };
}

export const MAX_COTACOES = 400;
export const MIN_PROPOSTAS = 3;

export function cleanCotacao(v: unknown): Cotacao | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), titulo = text(v.titulo, 200), escopo = text(v.escopo, 4000), criadaPor = text(v.criadaPor, 100);
  if (!id || !titulo || !escopo || !criadaPor || typeof v.criadaEm !== "string" || Number.isNaN(Date.parse(v.criadaEm))) return null;
  const c: Cotacao = {
    id, titulo, escopo, criadaEm: v.criadaEm, criadaPor,
    pranchas: (Array.isArray(v.pranchas) ? v.pranchas : []).flatMap((p) => (isObj(p) && text(p.codigo, 40) && text(p.rev, 10) ? [{ codigo: text(p.codigo, 40)!, rev: text(p.rev, 10)! }] : [])).slice(0, 60),
    propostas: [],
  };
  const vistos = new Set<string>();
  for (const p of Array.isArray(v.propostas) ? v.propostas : []) {
    if (!isObj(p)) continue;
    const fid = text(p.fornecedorId, 40);
    if (!fid || vistos.has(fid) || !nonNeg(p.valor) || !nonNeg(p.prazoDias)) continue;
    vistos.add(fid);
    c.propostas.push({ fornecedorId: fid, valor: p.valor, prazoDias: Math.round(p.prazoDias), ...(optText(p.obs, 300) ? { obs: optText(p.obs, 300) } : {}) });
  }
  if ((FRENTES_OBRA as readonly unknown[]).includes(v.frente)) c.frente = v.frente as FrenteObra;
  const t = optText(v.trechoId, 40), a = optText(v.atividadeId, 60);
  if (t) c.trechoId = t;
  if (a) c.atividadeId = a;
  if (isObj(v.escolha)) {
    const e = v.escolha;
    const fid = text(e.fornecedorId, 40), por = text(e.por, 100);
    if (fid && por && typeof e.em === "string" && !Number.isNaN(Date.parse(e.em)) && vistos.has(fid)) {
      c.escolha = { fornecedorId: fid, em: e.em, por, ...(optText(e.justificativa, 1000) ? { justificativa: optText(e.justificativa, 1000) } : {}), ...(optText(e.solicitacaoId, 20) ? { solicitacaoId: optText(e.solicitacaoId, 20) } : {}) };
    }
  }
  return c;
}

export function nextCotacaoId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, "")) || 0), 0);
  return `COT-${String(n + 1).padStart(3, "0")}`;
}

/** Mapa comparativo: propostas ordenadas pelo menor valor, com a homologação de cada fornecedor. */
export function mapaComparativo(c: Cotacao, fornecedores: readonly Fornecedor[], hoje: string) {
  return [...c.propostas]
    .sort((a, b) => a.valor - b.valor || a.prazoDias - b.prazoDias)
    .map((p, i, arr) => {
      const f = fornecedores.find((x) => x.id === p.fornecedorId);
      return { ...p, fornecedor: f, homologado: f ? homologacao(f, hoje).apto : false, menor: i === 0, difMenor: arr[0]!.valor > 0 ? (p.valor - arr[0]!.valor) / arr[0]!.valor : 0 };
    });
}

/**
 * Escolha do vencedor. Regra dos 3: precisa de ao menos 3 propostas de homologados;
 * com menos, ou escolhendo quem não é o menor preço, a justificativa é obrigatória.
 * O vencedor precisa estar homologado.
 */
export function escolherProposta(c: Cotacao, fornecedorId: string, fornecedores: readonly Fornecedor[], hoje: string, por: string, emIso: string, justificativa?: string): Cotacao {
  if (c.escolha) throw new PmoError("Esta cotação já tem vencedor.");
  const mapa = mapaComparativo(c, fornecedores, hoje);
  const alvo = mapa.find((m) => m.fornecedorId === fornecedorId);
  if (!alvo) throw new PmoError("Fornecedor sem proposta nesta cotação.");
  if (!alvo.homologado) throw new PmoError("O vencedor precisa estar homologado (veja as pendências no cadastro).");
  const homologadas = mapa.filter((m) => m.homologado).length;
  const just = justificativa?.trim() ?? "";
  if (homologadas < MIN_PROPOSTAS && just.length < 10) throw new PmoError(`Só ${homologadas} proposta(s) de homologados (mínimo ${MIN_PROPOSTAS}): justifique a exceção.`);
  if (!alvo.menor && just.length < 10) throw new PmoError("O escolhido não é o menor preço: justifique a escolha.");
  return { ...c, escolha: { fornecedorId, em: emIso, por: por.trim().slice(0, 100) || "—", ...(just ? { justificativa: just.slice(0, 1000) } : {}) } };
}

/* ---------------------------- Pranchas: revisão única vigente ---------------------------- */

export interface RevisaoPrancha {
  rev: string;
  em: string;
  por: string;
  /** Link do arquivo (repositório, Drive) ou caminho no armazenamento. */
  arquivo?: string;
  nota?: string;
}

export interface Prancha {
  codigo: string;
  titulo: string;
  disciplina: string;
  revisoes: RevisaoPrancha[];
}

export const MAX_PRANCHAS = 800;

export function cleanPrancha(v: unknown): Prancha | null {
  if (!isObj(v)) return null;
  const codigo = text(v.codigo, 40), titulo = text(v.titulo, 200), disciplina = text(v.disciplina, 60);
  if (!codigo || !titulo || !disciplina) return null;
  const revs: RevisaoPrancha[] = [];
  const vistos = new Set<string>();
  for (const r of Array.isArray(v.revisoes) ? v.revisoes : []) {
    if (!isObj(r)) continue;
    const rev = text(r.rev, 10), por = text(r.por, 100);
    if (!rev || !por || !isIsoDate(r.em) || vistos.has(rev)) continue;
    vistos.add(rev);
    revs.push({ rev, em: r.em, por, ...(optText(r.arquivo, 600) ? { arquivo: optText(r.arquivo, 600) } : {}), ...(optText(r.nota, 500) ? { nota: optText(r.nota, 500) } : {}) });
  }
  if (revs.length === 0) return null;
  return { codigo, titulo, disciplina, revisoes: revs.slice(-50) };
}

/** A vigente é sempre a última: só existe uma. */
export const revisaoVigente = (p: Prancha) => p.revisoes.at(-1)!;

export function novaRevisao(p: Prancha, r: RevisaoPrancha): Prancha {
  if (p.revisoes.some((x) => x.rev === r.rev)) throw new PmoError(`A revisão ${r.rev} já existe para ${p.codigo}.`);
  if (!isIsoDate(r.em) || r.em < revisaoVigente(p).em) throw new PmoError("A nova revisão não pode ser anterior à vigente.");
  return { ...p, revisoes: [...p.revisoes, r] };
}

/** Pranchas citadas numa requisição que deixaram de ser vigentes (risco de executar projeto obsoleto). */
export function pranchasObsoletas(citadas: readonly { codigo: string; rev: string }[], pranchas: readonly Prancha[]): { codigo: string; citada: string; vigente: string }[] {
  return citadas.flatMap((c) => {
    const p = pranchas.find((x) => x.codigo === c.codigo);
    if (!p) return [];
    const vig = revisaoVigente(p).rev;
    return vig !== c.rev ? [{ codigo: c.codigo, citada: c.rev, vigente: vig }] : [];
  });
}

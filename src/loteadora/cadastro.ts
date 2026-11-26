import { PmoError } from "../errors";
import { parseBrNumber } from "../money";
import { isObj, nonNeg, optText, text } from "./common";

/** Módulo 1 — Cadastro Master: ficha do empreendimento, ruas/trechos e lotes. */

export const EMPREENDIMENTO_TIPOS = ["loteamento", "condominio_lotes"] as const;
export type EmpreendimentoTipo = (typeof EMPREENDIMENTO_TIPOS)[number];

export interface FichaEmpreendimento {
  tipo?: EmpreendimentoTipo;
  municipio?: string;
  uf?: string;
  /** CNPJ da SPE, só dígitos. */
  cnpjSpe?: string;
  areaBrutaM2?: number;
  areaCessaoM2?: number;
  areaVendavelM2?: number;
  /** v1.1 — análise obrigatória do Plano Diretor da cidade (F1.02/F1.03, Módulo 1). */
  planoDiretor?: AnalisePlanoDiretor;
}

/** F1.02: Plano Diretor, diretrizes urbanísticas da Prefeitura e restrições ambientais. */
export interface AnalisePlanoDiretor {
  /** Lei do Plano Diretor (número/ano) e zona do imóvel. */
  lei?: string;
  zoneamento?: string;
  /** Parâmetros que o projeto precisa cumprir. */
  loteMinimoM2?: number;
  testadaMinimaM?: number;
  /** Percentual mínimo de áreas públicas (sistema viário + verdes + institucional) sobre a gleba, 0..1. */
  areasPublicasMinPct?: number;
  /** Taxa de ocupação máxima do lote (0..1) e coeficiente de aproveitamento máximo. */
  taxaOcupacaoMax?: number;
  coefAproveitamentoMax?: number;
  restricoes?: string;
  /** Vistos técnicos da análise (F1.02: engenharia, conselho, gestão regulatória e projetos). */
  vistos?: { nome: string; em: string }[];
  analisadoPor?: string;
  analisadoEm?: string;
  /** Parecer: o estudo de massa está aderente ao Plano Diretor? */
  conforme?: boolean;
  validadoPor?: string;
}

export interface Trecho {
  id: string;
  rua: string;
  /** Nome do trecho dentro da rua (ex.: "estaca 0 a 12"). */
  nome: string;
  larguraPistaM?: number;
  passeioM?: number;
  pavimentoM2?: number;
}

export const STATUS_FISICO = ["a_executar", "em_obra", "infra_concluida", "entregue"] as const;
export type StatusFisico = (typeof STATUS_FISICO)[number];
export const STATUS_FISICO_LABEL: Record<StatusFisico, string> = { a_executar: "A executar", em_obra: "Em obra", infra_concluida: "Infraestrutura concluída", entregue: "Entregue" };

export const STATUS_COMERCIAL = ["bloqueado", "caucionado", "disponivel", "reservado", "vendido"] as const;
export type StatusComercial = (typeof STATUS_COMERCIAL)[number];
export const STATUS_COMERCIAL_LABEL: Record<StatusComercial, string> = { bloqueado: "Bloqueado", caucionado: "Caução Prefeitura — bloqueado", disponivel: "Disponível", reservado: "Reservado", vendido: "Vendido" };

export interface Lote {
  /** Quadra + número, ex.: "A-12". */
  id: string;
  quadra: string;
  numero: string;
  areaM2: number;
  matricula?: string;
  trechoId?: string;
  fisico: StatusFisico;
  comercial: StatusComercial;
}

export const MAX_LOTES = 3000;
export const MAX_TRECHOS = 600;

export const loteId = (quadra: string, numero: string) => `${quadra.trim().toUpperCase()}-${numero.trim().toUpperCase()}`;

export function cleanFicha(v: unknown): FichaEmpreendimento | null {
  if (!isObj(v)) return null;
  const f: FichaEmpreendimento = {};
  if ((EMPREENDIMENTO_TIPOS as readonly string[]).includes(v.tipo as string)) f.tipo = v.tipo as EmpreendimentoTipo;
  const mun = optText(v.municipio, 80);
  if (mun) f.municipio = mun;
  if (typeof v.uf === "string" && /^[A-Z]{2}$/.test(v.uf)) f.uf = v.uf;
  if (typeof v.cnpjSpe === "string" && /^\d{14}$/.test(v.cnpjSpe)) f.cnpjSpe = v.cnpjSpe;
  for (const k of ["areaBrutaM2", "areaCessaoM2", "areaVendavelM2"] as const) if (nonNeg(v[k])) f[k] = v[k] as number;
  const pd = cleanPlanoDiretor(v.planoDiretor);
  if (pd) f.planoDiretor = pd;
  return f;
}

export function cleanPlanoDiretor(v: unknown): AnalisePlanoDiretor | undefined {
  if (!isObj(v)) return undefined;
  const p: AnalisePlanoDiretor = {};
  for (const k of ["lei", "zoneamento", "analisadoPor", "validadoPor"] as const) {
    const t = optText(v[k], 120);
    if (t) p[k] = t;
  }
  const r = optText(v.restricoes, 2000);
  if (r) p.restricoes = r;
  for (const k of ["loteMinimoM2", "testadaMinimaM"] as const) if (nonNeg(v[k])) p[k] = v[k] as number;
  if (nonNeg(v.areasPublicasMinPct) && v.areasPublicasMinPct <= 1) p.areasPublicasMinPct = v.areasPublicasMinPct;
  if (nonNeg(v.taxaOcupacaoMax) && v.taxaOcupacaoMax <= 1) p.taxaOcupacaoMax = v.taxaOcupacaoMax;
  if (nonNeg(v.coefAproveitamentoMax) && v.coefAproveitamentoMax <= 20) p.coefAproveitamentoMax = v.coefAproveitamentoMax;
  if (Array.isArray(v.vistos)) {
    const vistos = v.vistos.flatMap((x) => {
      if (!isObj(x)) return [];
      const nome = optText(x.nome, 100);
      return nome && typeof x.em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.em) ? [{ nome, em: x.em }] : [];
    });
    const unicos = vistos.filter((x, i) => vistos.findIndex((y) => y.nome.toLowerCase() === x.nome.toLowerCase()) === i).slice(0, 12);
    if (unicos.length) p.vistos = unicos;
  }
  if (typeof v.analisadoEm === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.analisadoEm)) p.analisadoEm = v.analisadoEm;
  if (typeof v.conforme === "boolean") p.conforme = v.conforme;
  return Object.keys(p).length ? p : undefined;
}

/**
 * Trava de conformidade urbanística (v1.1, F1.02/F1.03): sem a análise concluída e conforme, o
 * empreendimento não segue para protocolo; lotes abaixo do mínimo e áreas públicas abaixo do exigido
 * aparecem como pendência.
 */
export function conformidadePlanoDiretor(f: FichaEmpreendimento, lotes: readonly Lote[] = []): { status: "pendente" | "conforme" | "nao_conforme"; pendencias: string[] } {
  const pd = f.planoDiretor;
  const pend: string[] = [];
  if (!pd?.analisadoEm || pd.conforme === undefined) pend.push("Análise do Plano Diretor não concluída (F1.02)");
  else if (!pd.conforme) pend.push("Parecer de não conformidade com o Plano Diretor");
  if (pd?.loteMinimoM2) {
    const menores = lotes.filter((l) => l.areaM2 < pd.loteMinimoM2!);
    if (menores.length) pend.push(`${menores.length} lote(s) abaixo do lote mínimo de ${pd.loteMinimoM2} m² (ex.: ${menores.slice(0, 3).map((l) => l.id).join(", ")})`);
  }
  if (pd?.areasPublicasMinPct && f.areaBrutaM2 && f.areaCessaoM2 !== undefined) {
    const pct = f.areaCessaoM2 / f.areaBrutaM2;
    if (pct + 1e-9 < pd.areasPublicasMinPct) pend.push(`Áreas públicas em ${(pct * 100).toFixed(1).replace(".", ",")}% da gleba; o Plano Diretor exige ${(pd.areasPublicasMinPct * 100).toFixed(1).replace(".", ",")}%`);
  }
  const status = !pd?.analisadoEm || pd.conforme === undefined ? "pendente" : pend.length ? "nao_conforme" : "conforme";
  return { status, pendencias: pend };
}

export function cleanTrecho(v: unknown): Trecho | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 40);
  const rua = text(v.rua, 80);
  const nome = text(v.nome, 80);
  if (!id || !rua || !nome) return null;
  const t: Trecho = { id, rua, nome };
  for (const k of ["larguraPistaM", "passeioM", "pavimentoM2"] as const) if (nonNeg(v[k])) t[k] = v[k] as number;
  return t;
}

export function cleanLote(v: unknown): Lote | null {
  if (!isObj(v)) return null;
  const quadra = text(v.quadra, 20);
  const numero = text(v.numero, 20);
  if (!quadra || !numero || !nonNeg(v.areaM2) || v.areaM2 <= 0) return null;
  if (!(STATUS_FISICO as readonly string[]).includes(v.fisico as string) || !(STATUS_COMERCIAL as readonly string[]).includes(v.comercial as string)) return null;
  const l: Lote = { id: loteId(quadra, numero), quadra: quadra.toUpperCase(), numero: numero.toUpperCase(), areaM2: v.areaM2, fisico: v.fisico as StatusFisico, comercial: v.comercial as StatusComercial };
  const mat = optText(v.matricula, 40);
  if (mat) l.matricula = mat;
  const tr = optText(v.trechoId, 40);
  if (tr) l.trechoId = tr;
  return l;
}

/* ---------------------------------- importação ---------------------------------- */

export interface ImportErro { linha: number; mensagem: string }
export interface ImportResultado<T> { itens: T[]; erros: ImportErro[] }

/** Divide uma linha de CSV respeitando aspas ("1,5" fica inteiro; "" dentro de aspas vira "). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
export const csvFold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Número de planilha brasileira ("1.400", "250,50", "1.234,5 m²"); unidades e espaços são ignorados. */
export const csvNum = (s: string): number => parseBrNumber(s.replace(/[^\d.,-]/g, ""));

export function csvTabela(textIn: string): { header: string[]; rows: { linha: number; cells: string[] }[] } {
  const lines = textIn.replace(/^﻿/, "").split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) throw new PmoError("Arquivo vazio.");
  const sep = (lines[first]!.match(/;/g) ?? []).length >= (lines[first]!.match(/,/g) ?? []).length ? ";" : lines[first]!.includes("\t") ? "\t" : ",";
  const header = splitLine(lines[first]!, sep).map(csvFold);
  const rows = lines.slice(first + 1).map((l, i) => ({ linha: first + i + 2, cells: splitLine(l, sep) })).filter((r) => r.cells.some((c) => c !== ""));
  return { header, rows };
}

/** Coluna pelo nome (sem acento, caixa ou símbolos); unidades no fim do nome são ignoradas ("Área (m²)" = "area"). */
export const csvColuna = (header: string[], ...names: string[]) => {
  const exact = header.findIndex((h) => names.includes(h));
  if (exact >= 0) return exact;
  return header.findIndex((h) => names.some((n) => n.length >= 4 && (h === `${n}m` || h === `${n}m2` || h === `${n}ha`)));
};

/**
 * Lotes a partir de planilha (CSV com ; ou ,). Colunas aceitas (sem acento, qualquer caixa):
 * quadra; lote|numero; area|aream2; matricula; trecho; fisico|statusfisico; comercial|statuscomercial.
 * Situação ausente: física "a_executar" e comercial "bloqueado" (sem matrícula não se vende — trava R-01).
 */
export function importLotesCsv(csv: string): ImportResultado<Lote> {
  const { header, rows } = csvTabela(csv);
  const iq = csvColuna(header, "quadra", "qd"), il = csvColuna(header, "lote", "numero", "n", "lt"), ia = csvColuna(header, "area", "aream2", "areatotal");
  if (iq < 0 || il < 0 || ia < 0) throw new PmoError("A planilha precisa das colunas quadra, lote e área.");
  const im = csvColuna(header, "matricula"), it = csvColuna(header, "trecho", "trechoid", "rua"), ifi = csvColuna(header, "fisico", "statusfisico"), ic = csvColuna(header, "comercial", "statuscomercial");
  const itens: Lote[] = [];
  const erros: ImportErro[] = [];
  const vistos = new Set<string>();
  for (const r of rows) {
    if (itens.length >= MAX_LOTES) { erros.push({ linha: r.linha, mensagem: `Limite de ${MAX_LOTES} lotes atingido.` }); break; }
    const statusF = ifi >= 0 ? csvFold(r.cells[ifi] ?? "") : "";
    const statusC = ic >= 0 ? csvFold(r.cells[ic] ?? "") : "";
    const fisico = (STATUS_FISICO.find((s) => csvFold(s) === statusF || csvFold(STATUS_FISICO_LABEL[s]) === statusF) ?? "a_executar") as StatusFisico;
    const comercial = (STATUS_COMERCIAL.find((s) => csvFold(s) === statusC || csvFold(STATUS_COMERCIAL_LABEL[s]) === statusC) ?? "bloqueado") as StatusComercial;
    const lote = cleanLote({ quadra: r.cells[iq], numero: r.cells[il], areaM2: csvNum(r.cells[ia] ?? ""), matricula: im >= 0 ? r.cells[im] : undefined, trechoId: it >= 0 ? r.cells[it] : undefined, fisico, comercial });
    if (!lote) { erros.push({ linha: r.linha, mensagem: "Quadra, lote ou área inválidos." }); continue; }
    if (vistos.has(lote.id)) { erros.push({ linha: r.linha, mensagem: `Lote ${lote.id} repetido.` }); continue; }
    vistos.add(lote.id);
    itens.push(lote);
  }
  return { itens, erros };
}

/** Trechos: colunas rua; trecho|nome; id (opcional, senão gerado); largura|pista; passeio|calcada; pavimento|aream2. */
export function importTrechosCsv(csv: string): ImportResultado<Trecho> {
  const { header, rows } = csvTabela(csv);
  const ir = csvColuna(header, "rua", "via", "logradouro"), in_ = csvColuna(header, "trecho", "nome", "segmento");
  if (ir < 0 || in_ < 0) throw new PmoError("A planilha precisa das colunas rua e trecho.");
  const iid = csvColuna(header, "id", "codigo"), il = csvColuna(header, "largura", "larguradapista", "pista", "largurapistam"), ip = csvColuna(header, "passeio", "calcada", "passeiom"), ia = csvColuna(header, "pavimento", "pavimentom2", "aream2", "area");
  const itens: Trecho[] = [];
  const erros: ImportErro[] = [];
  const vistos = new Set<string>();
  for (const r of rows) {
    if (itens.length >= MAX_TRECHOS) { erros.push({ linha: r.linha, mensagem: `Limite de ${MAX_TRECHOS} trechos atingido.` }); break; }
    const id = (iid >= 0 && r.cells[iid]) || `T${String(itens.length + 1).padStart(3, "0")}`;
    const num = (i: number) => (i >= 0 && r.cells[i] ? csvNum(r.cells[i]!) : undefined);
    const t = cleanTrecho({ id, rua: r.cells[ir], nome: r.cells[in_], larguraPistaM: num(il), passeioM: num(ip), pavimentoM2: num(ia) });
    if (!t) { erros.push({ linha: r.linha, mensagem: "Rua ou trecho em branco." }); continue; }
    if (vistos.has(t.id)) { erros.push({ linha: r.linha, mensagem: `Trecho ${t.id} repetido.` }); continue; }
    vistos.add(t.id);
    itens.push(t);
  }
  return { itens, erros };
}

/* ------------------------------------ resumo ------------------------------------ */

export interface ResumoCadastro {
  lotes: number;
  areaLotesM2: number;
  semMatricula: number;
  porComercial: Record<StatusComercial, number>;
  porFisico: Record<StatusFisico, number>;
  /** Lotes ligados a um trecho que não existe no cadastro. */
  trechoInexistente: string[];
  /** Diferença entre a soma das áreas dos lotes e a área vendável da ficha (null sem ficha). */
  difAreaVendavelM2: number | null;
  /** Lote marcado vendido ou reservado sem matrícula: fere a trava legal do R-01. */
  vendaSemMatricula: string[];
}

export function resumoCadastro(lotes: readonly Lote[], trechos: readonly Trecho[], ficha?: FichaEmpreendimento): ResumoCadastro {
  const porComercial = Object.fromEntries(STATUS_COMERCIAL.map((s) => [s, 0])) as Record<StatusComercial, number>;
  const porFisico = Object.fromEntries(STATUS_FISICO.map((s) => [s, 0])) as Record<StatusFisico, number>;
  const ids = new Set(trechos.map((t) => t.id));
  let area = 0;
  let semMatricula = 0;
  const trechoInexistente: string[] = [];
  const vendaSemMatricula: string[] = [];
  for (const l of lotes) {
    porComercial[l.comercial]++;
    porFisico[l.fisico]++;
    area += l.areaM2;
    if (!l.matricula) semMatricula++;
    if (l.trechoId && !ids.has(l.trechoId)) trechoInexistente.push(l.id);
    if (!l.matricula && (l.comercial === "vendido" || l.comercial === "reservado")) vendaSemMatricula.push(l.id);
  }
  const areaLotesM2 = Math.round(area * 100) / 100;
  return {
    lotes: lotes.length, areaLotesM2, semMatricula, porComercial, porFisico, trechoInexistente, vendaSemMatricula,
    difAreaVendavelM2: ficha?.areaVendavelM2 !== undefined ? Math.round((areaLotesM2 - ficha.areaVendavelM2) * 100) / 100 : null,
  };
}

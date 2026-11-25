import { DEFAULT_CALENDAR, isWorkDay, type WorkCalendar } from "../cpm/calendar";
import { PmoError } from "../errors";
import { addDays, isIsoDate, isObj, nonNeg, optText, text } from "./common";

/**
 * Fase 2 — Canteiro e anti-refação (documento, 5.1 e 3.1).
 * Gates por rua/trecho: cada frente só começa no trecho quando as que ela exige estão concluídas,
 * e só conclui com o checklist de liberação completo. O diário de obra alimenta o avanço por trecho.
 */

export const FRENTES_OBRA = ["terraplenagem", "drenagem", "agua_esgoto", "guias", "eletrica", "pavimentacao", "calcadas", "tvo"] as const;
export type FrenteObra = (typeof FRENTES_OBRA)[number];

export const FRENTE_OBRA_LABEL: Record<FrenteObra, string> = {
  terraplenagem: "1 · Terraplenagem e bacias",
  drenagem: "2 · Drenagem pluvial",
  agua_esgoto: "3 · Água e esgoto",
  guias: "4 · Guias, sarjetas e bocas de lobo",
  eletrica: "5 · Rede elétrica e iluminação",
  pavimentacao: "6 · Pavimentação (CBUQ)",
  calcadas: "7 · Calçadas, sinalização e arborização",
  tvo: "8 · Limpeza, as-built e TVO",
};

/** Frentes que precisam estar 100% concluídas no trecho antes de começar (a trava). */
export const PRE_REQUISITOS: Record<FrenteObra, readonly FrenteObra[]> = {
  terraplenagem: [],
  drenagem: ["terraplenagem"],
  agua_esgoto: ["drenagem"],
  guias: ["drenagem", "agua_esgoto"],
  eletrica: ["guias"],
  // Trava crítica: 100% de drenagem, água, esgoto e guias.
  pavimentacao: ["drenagem", "agua_esgoto", "guias"],
  calcadas: ["pavimentacao"],
  tvo: ["terraplenagem", "drenagem", "agua_esgoto", "guias", "eletrica", "pavimentacao", "calcadas"],
};

/** Itens de liberação (critério do documento); editáveis por obra no futuro, fixos nesta fase. */
export const CHECKLIST_PADRAO: Record<FrenteObra, readonly string[]> = {
  terraplenagem: ["Alvará de execução emitido", "Projeto vigente no canteiro", "Greide conferido por topografia", "Ensaio de compactação aprovado"],
  drenagem: ["Tubulação e PVs executados", "Dissipadores e conexão à lagoa", "Conformidade ABNT NBR 8890"],
  agua_esgoto: ["Projeto SABESP aprovado", "Teste de pressão aprovado", "Teste de estanqueidade aprovado", "Ramais posicionados"],
  guias: ["Alinhamento e caimento conferidos", "Laudo do concreto FCK 25 MPa"],
  eletrica: ["Projeto Energisa aprovado", "Postes, cabos MT/BT e transformadores", "Aterramento no padrão"],
  pavimentacao: ["Subleito de bica corrida 15 cm", "Imprimação CM30", "Capa CBUQ 4 cm", "Ensaios aprovados"],
  calcadas: ["Sinalização CONTRAN", "Berços e tutores do plantio", "Manutenção do plantio programada (24 meses)"],
  tvo: ["As-built entregue", "Recebimento Prefeitura", "Recebimento SABESP", "Recebimento Energisa", "Recebimento CETESB", "TVO emitido"],
};

export interface ItemChecklist {
  item: string;
  ok: boolean;
  por?: string;
  em?: string;
}

/** Ordem de serviço da frente no trecho (F4.05): contrato assinado, ART de execução e integração SST. */
export interface OrdemServico {
  fornecedorId: string;
  contratoNumero: string;
  contratoAssinadoEm: string;
  artNumero: string;
  emitidaEm: string;
  por: string;
}

export interface FrenteTrecho {
  trechoId: string;
  frente: FrenteObra;
  /** Atividade do cronograma que executa esta frente no trecho (o atraso do Gantt aparece no gate). */
  atividadeId?: string;
  os?: OrdemServico;
  /** 0..100, do diário de obra (o maior avanço informado). */
  percent: number;
  iniciadaEm?: string;
  concluidaEm?: string;
  checklist: ItemChecklist[];
}

export const MAX_FRENTES_TRECHO = 600 * FRENTES_OBRA.length;
export const chaveFrente = (trechoId: string, frente: FrenteObra) => `${trechoId}|${frente}`;

export function cleanFrenteTrecho(v: unknown): FrenteTrecho | null {
  if (!isObj(v)) return null;
  const trechoId = text(v.trechoId, 40);
  if (!trechoId || !(FRENTES_OBRA as readonly unknown[]).includes(v.frente)) return null;
  if (!nonNeg(v.percent) || v.percent > 100) return null;
  const checklist = (Array.isArray(v.checklist) ? v.checklist : []).flatMap((c): ItemChecklist[] => {
    if (!isObj(c)) return [];
    const item = text(c.item, 160);
    if (!item || typeof c.ok !== "boolean") return [];
    return [{ item, ok: c.ok, ...(optText(c.por, 100) ? { por: optText(c.por, 100) } : {}), ...(isIsoDate(c.em) ? { em: c.em } : {}) }];
  });
  const f: FrenteTrecho = { trechoId, frente: v.frente as FrenteObra, percent: Math.round(v.percent * 10) / 10, checklist };
  if (isIsoDate(v.iniciadaEm)) f.iniciadaEm = v.iniciadaEm;
  if (isIsoDate(v.concluidaEm)) f.concluidaEm = v.concluidaEm;
  const at = optText(v.atividadeId, 60);
  if (at) f.atividadeId = at;
  if (isObj(v.os)) {
    const o = v.os;
    const forn = text(o.fornecedorId, 40), num = text(o.contratoNumero, 60), art = text(o.artNumero, 60), por = text(o.por, 100);
    if (forn && num && art && por && isIsoDate(o.contratoAssinadoEm) && isIsoDate(o.emitidaEm)) f.os = { fornecedorId: forn, contratoNumero: num, contratoAssinadoEm: o.contratoAssinadoEm, artNumero: art, emitidaEm: o.emitidaEm, por };
  }
  return f;
}

/** Frentes executadas por terceiros: precisam de OS antes de começar (a TVO é da própria loteadora). */
export const exigeOS = (f: FrenteObra) => f !== "tvo";

export const frenteConcluida = (f: FrenteTrecho | undefined) => !!f?.concluidaEm;

export function frenteDe(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra): FrenteTrecho | undefined {
  return lista.find((f) => f.trechoId === trechoId && f.frente === frente);
}

export type SituacaoGate = "bloqueada" | "liberada" | "em_execucao" | "concluida";
export const SITUACAO_GATE_LABEL: Record<SituacaoGate, string> = { bloqueada: "Bloqueada", liberada: "Liberada", em_execucao: "Em execução", concluida: "Concluída" };

export interface Gate {
  situacao: SituacaoGate;
  /** Por que não pode começar (vazio se pode). */
  travas: string[];
}

/**
 * Situação da frente no trecho. A TVO exige, além das 7 frentes, zero RNC aberta no trecho.
 * `rncAbertasNoTrecho` vem do módulo de qualidade.
 */
export function gate(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, rncAbertasNoTrecho = 0): Gate {
  const atual = frenteDe(lista, trechoId, frente);
  if (atual?.concluidaEm) return { situacao: "concluida", travas: [] };
  const travas = PRE_REQUISITOS[frente].filter((p) => !frenteConcluida(frenteDe(lista, trechoId, p))).map((p) => `${FRENTE_OBRA_LABEL[p].slice(4)} não concluída`);
  if (frente === "tvo" && rncAbertasNoTrecho > 0) travas.push(`${rncAbertasNoTrecho} RNC aberta(s) no trecho`);
  if (!atual?.iniciadaEm && exigeOS(frente) && !atual?.os) travas.push("Sem OS emitida (contrato, ART e integração de SST)");
  if (atual?.iniciadaEm) return { situacao: "em_execucao", travas };
  return { situacao: travas.length ? "bloqueada" : "liberada", travas };
}

const novaFrente = (trechoId: string, frente: FrenteObra): FrenteTrecho => ({ trechoId, frente, percent: 0, checklist: CHECKLIST_PADRAO[frente].map((item) => ({ item, ok: false })) });

function substituir(lista: readonly FrenteTrecho[], f: FrenteTrecho): FrenteTrecho[] {
  const i = lista.findIndex((x) => x.trechoId === f.trechoId && x.frente === f.frente);
  return i < 0 ? [...lista, f] : lista.map((x, j) => (j === i ? f : x));
}

/** Inicia a frente no trecho. Recusa se a trava não foi liberada (é o ponto do anti-refação). */
export function iniciarFrente(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, em: string, rncAbertasNoTrecho = 0): FrenteTrecho[] {
  if (!isIsoDate(em)) throw new PmoError("Data de início inválida.");
  const g = gate(lista, trechoId, frente, rncAbertasNoTrecho);
  if (g.situacao === "concluida" || g.situacao === "em_execucao") throw new PmoError("Essa frente já foi iniciada no trecho.");
  if (g.travas.length) throw new PmoError(`Trava anti-refação: ${g.travas.join("; ")}.`);
  const base = frenteDe(lista, trechoId, frente) ?? novaFrente(trechoId, frente);
  return substituir(lista, { ...base, iniciadaEm: em });
}

export function marcarChecklist(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, indice: number, ok: boolean, por: string, em: string): FrenteTrecho[] {
  const base = frenteDe(lista, trechoId, frente) ?? novaFrente(trechoId, frente);
  if (base.concluidaEm) throw new PmoError("Frente concluída: o checklist não muda mais.");
  if (!base.checklist[indice]) throw new PmoError("Item de checklist inexistente.");
  const checklist = base.checklist.map((c, i) => (i === indice ? (ok ? { item: c.item, ok: true, por: por.trim().slice(0, 100) || "—", em } : { item: c.item, ok: false }) : c));
  return substituir(lista, { ...base, checklist });
}

/** Liga (ou desliga, com `undefined`) a frente do trecho a uma atividade do cronograma. */
export function vincularAtividade(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, atividadeId: string | undefined): FrenteTrecho[] {
  const base = frenteDe(lista, trechoId, frente) ?? novaFrente(trechoId, frente);
  const { atividadeId: _a, ...resto } = base;
  void _a;
  return substituir(lista, atividadeId ? { ...resto, atividadeId } : resto);
}

/** Grava a OS já validada (ver `emitirOS` em os.ts). */
export function gravarOS(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, os: OrdemServico): FrenteTrecho[] {
  const base = frenteDe(lista, trechoId, frente) ?? novaFrente(trechoId, frente);
  if (base.iniciadaEm) throw new PmoError("A frente já começou: a OS é emitida antes do início.");
  return substituir(lista, { ...base, os });
}

/** Avanço vindo do diário: guarda o maior percentual informado (o avanço físico não regride). */
export function registrarAvanco(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, percent: number): FrenteTrecho[] {
  if (!(percent >= 0 && percent <= 100)) throw new PmoError("Avanço deve ficar entre 0 e 100%.");
  const base = frenteDe(lista, trechoId, frente);
  if (!base?.iniciadaEm) throw new PmoError(`${FRENTE_OBRA_LABEL[frente].slice(4)} ainda não foi iniciada no trecho ${trechoId}.`);
  if (base.concluidaEm) return [...lista];
  // Gate 6 (anti-refação): nenhum avanço de base, imprimação ou CBUQ com subterrâneo e guias pendentes na rua.
  if (frente === "pavimentacao" && percent > base.percent) {
    const pend = PRE_REQUISITOS.pavimentacao.filter((p) => !frenteConcluida(frenteDe(lista, trechoId, p)));
    if (pend.length)
      throw new PmoError(`Trava do Gate 6 (anti-refação) no trecho ${trechoId}: pavimentação não avança antes de 100% de ${pend.map((p) => FRENTE_OBRA_LABEL[p].slice(4).toLowerCase()).join(", ")}.`);
  }
  return substituir(lista, { ...base, percent: Math.max(base.percent, Math.round(percent * 10) / 10) });
}

/** Conclui a frente: exige 100% de avanço e o checklist de liberação completo. */
export function concluirFrente(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, em: string, rncAbertasNoTrecho = 0): FrenteTrecho[] {
  if (!isIsoDate(em)) throw new PmoError("Data de conclusão inválida.");
  const base = frenteDe(lista, trechoId, frente);
  if (!base?.iniciadaEm) throw new PmoError("A frente ainda não foi iniciada.");
  if (base.concluidaEm) throw new PmoError("A frente já está concluída.");
  if (em < base.iniciadaEm) throw new PmoError("A conclusão não pode ser antes do início.");
  const faltam = base.checklist.filter((c) => !c.ok).map((c) => c.item);
  if (faltam.length) throw new PmoError(`Checklist de liberação incompleto: ${faltam.join("; ")}.`);
  if (rncAbertasNoTrecho > 0) throw new PmoError(`Há ${rncAbertasNoTrecho} RNC aberta(s) no trecho: trate antes de concluir.`);
  return substituir(lista, { ...base, percent: 100, concluidaEm: em });
}

/** Avanço físico do trecho: média simples das 8 frentes. */
export function avancoTrecho(lista: readonly FrenteTrecho[], trechoId: string): number {
  const soma = FRENTES_OBRA.reduce((s, f) => s + (frenteDe(lista, trechoId, f)?.percent ?? 0), 0);
  return Math.round((soma / FRENTES_OBRA.length) * 10) / 10;
}

/* --------------------------------- Diário de obra --------------------------------- */

export const CLIMAS = ["sol", "nublado", "chuva", "chuva_forte"] as const;
export type Clima = (typeof CLIMAS)[number];
export const CLIMA_LABEL: Record<Clima, string> = { sol: "Sol", nublado: "Nublado", chuva: "Chuva", chuva_forte: "Chuva forte" };

export interface FotoDiario {
  id: string;
  nome: string;
  /** Caminho no repositório de arquivos (bucket privado) quando o upload deu certo. */
  storagePath?: string;
  /** Miniatura JPEG embutida (data URL), só quando o upload não estava disponível. */
  miniatura?: string;
  tiradaEm: string;
  lat?: number;
  lng?: number;
  trechoId?: string;
}

export interface AvancoDiario {
  trechoId: string;
  frente: FrenteObra;
  percent: number;
}

export interface DiarioObra {
  /** Dia do diário (AAAA-MM-DD). Um por dia. */
  data: string;
  efetivo: number;
  equipamentos: string;
  clima: Clima;
  chuvaMm: number;
  texto: string;
  avancos: AvancoDiario[];
  fotos: FotoDiario[];
  /** ISO com hora: para conferir o limite das 17h30. */
  registradoEm: string;
  por: string;
}

export const MAX_DIARIOS = 1500;
export const MAX_FOTOS_DIARIO = 12;
/** Miniaturas embutidas pesam no planejamento da obra: no máximo esta quantidade por obra. */
export const MAX_MINIATURAS_OBRA = 40;
const MAX_MINIATURA = 40_000;

function cleanFoto(v: unknown): FotoDiario | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 60), nome = text(v.nome, 160);
  if (!id || !nome || typeof v.tiradaEm !== "string" || Number.isNaN(Date.parse(v.tiradaEm))) return null;
  const storagePath = optText(v.storagePath, 400);
  const miniatura = typeof v.miniatura === "string" && v.miniatura.startsWith("data:image/") && v.miniatura.length <= MAX_MINIATURA ? v.miniatura : undefined;
  if (!storagePath && !miniatura) return null;
  const f: FotoDiario = { id, nome, tiradaEm: v.tiradaEm };
  if (storagePath) f.storagePath = storagePath;
  if (miniatura) f.miniatura = miniatura;
  if (typeof v.lat === "number" && Math.abs(v.lat) <= 90 && typeof v.lng === "number" && Math.abs(v.lng) <= 180) {
    f.lat = v.lat;
    f.lng = v.lng;
  }
  const t = optText(v.trechoId, 40);
  if (t) f.trechoId = t;
  return f;
}

export function cleanDiario(v: unknown): DiarioObra | null {
  if (!isObj(v) || !isIsoDate(v.data)) return null;
  if (!nonNeg(v.efetivo) || !Number.isInteger(v.efetivo) || !nonNeg(v.chuvaMm) || v.chuvaMm > 1000) return null;
  if (!(CLIMAS as readonly unknown[]).includes(v.clima)) return null;
  if (typeof v.registradoEm !== "string" || Number.isNaN(Date.parse(v.registradoEm))) return null;
  const por = text(v.por, 100);
  if (!por) return null;
  const avancos = (Array.isArray(v.avancos) ? v.avancos : []).flatMap((a): AvancoDiario[] => {
    if (!isObj(a)) return [];
    const trechoId = text(a.trechoId, 40);
    if (!trechoId || !(FRENTES_OBRA as readonly unknown[]).includes(a.frente) || !nonNeg(a.percent) || a.percent > 100) return [];
    return [{ trechoId, frente: a.frente as FrenteObra, percent: a.percent }];
  });
  const fotos = (Array.isArray(v.fotos) ? v.fotos : []).flatMap((f) => cleanFoto(f) ?? []).slice(0, MAX_FOTOS_DIARIO);
  return {
    data: v.data, efetivo: v.efetivo, equipamentos: optText(v.equipamentos, 500) ?? "", clima: v.clima as Clima, chuvaMm: v.chuvaMm,
    texto: optText(v.texto, 4000) ?? "", avancos, fotos, registradoEm: v.registradoEm, por,
  };
}

/** Prazo do diário: até 17h30 do mesmo dia (hora local do canteiro, informada pelo app como ISO com fuso). */
export function diarioNoPrazo(d: DiarioObra, limite = "17:30"): boolean {
  const reg = new Date(d.registradoEm);
  const local = d.registradoEm.length > 19 && /[+-]\d{2}:\d{2}$/.test(d.registradoEm) ? d.registradoEm.slice(0, 16) : null;
  if (local) return local.slice(0, 10) < d.data || (local.slice(0, 10) === d.data && local.slice(11, 16) <= limite);
  // Sem fuso explícito: compara em UTC-3 (Brasília).
  const br = new Date(reg.getTime() - 3 * 3_600_000).toISOString();
  return br.slice(0, 10) < d.data || (br.slice(0, 10) === d.data && br.slice(11, 16) <= limite);
}

/** Dia improdutivo por chuva: chuva forte, ou pluviometria a partir do limite (mm). */
export const diaDeChuva = (d: DiarioObra, limiteMm = 10) => d.clima === "chuva_forte" || d.chuvaMm >= limiteMm;

/**
 * Dias úteis sem diário de `desde` até ontem (o dia de hoje vale até 17h30).
 * `agoraLocal` = "AAAA-MM-DDTHH:MM" na hora do canteiro.
 */
export function diariosFaltando(diarios: readonly DiarioObra[], desde: string, agoraLocal: string, cal: WorkCalendar = DEFAULT_CALENDAR, limite = "17:30"): string[] {
  const hoje = agoraLocal.slice(0, 10);
  const datas = new Set(diarios.map((d) => d.data));
  const out: string[] = [];
  if (!isIsoDate(desde) || desde > hoje) return out;
  for (let d = desde; d <= hoje && out.length < 400; d = addDays(d, 1)) {
    if (!isWorkDay(d, cal) || datas.has(d)) continue;
    if (d === hoje && agoraLocal.slice(11, 16) <= limite) continue;
    out.push(d);
  }
  return out;
}

/** Aplica os avanços do diário às frentes (para gravar junto com o diário). */
export function aplicarAvancos(frentes: readonly FrenteTrecho[], d: DiarioObra): FrenteTrecho[] {
  let lista = [...frentes];
  for (const a of d.avancos) lista = registrarAvanco(lista, a.trechoId, a.frente, a.percent);
  return lista;
}

/* ---------------------------- Chuva no cronograma (3.8) ---------------------------- */

export type DecisaoChuva = "aceito" | "recusado";

/**
 * Dias de chuva do diário que ainda não viraram dia não útil nem foram recusados pelo gestor.
 * Só dias úteis contam: chuva num sábado não muda o cronograma.
 */
export function diasDeChuvaPendentes(diarios: readonly DiarioObra[], decisoes: Readonly<Record<string, DecisaoChuva>>, cal: WorkCalendar = DEFAULT_CALENDAR, limiteMm = 10): string[] {
  return diarios.filter((d) => diaDeChuva(d, limiteMm) && isWorkDay(d.data, cal) && !Object.prototype.hasOwnProperty.call(decisoes, d.data)).map((d) => d.data);
}

import { DEFAULT_CALENDAR, workDaysBetween, type WorkCalendar } from "../cpm/calendar";
import { PmoError } from "../errors";
import { daysBetween, isIsoDate, isObj, nonNeg, optText, text } from "./common";

/**
 * Módulo 4 — Central de Alçadas da Sol Maior (documento, seções 2.2 e 2.3):
 * Demanda → Pré-aprovação técnica (Diretoria) → Presidência (alçada máxima) → Financeiro (liberação) → execução.
 * Toda decisão grava data, pessoa, papel e justificativa. Quem decide é conferido pelo papel na equipe da obra.
 */

export const PAPEIS = ["presidente", "diretoria_tecnica", "consultor", "ambiental", "cfo", "juridico", "projetista", "canteiro", "comercial"] as const;
export type Papel = (typeof PAPEIS)[number];
export const PAPEL_LABEL: Record<Papel, string> = {
  presidente: "Presidência",
  diretoria_tecnica: "Engenharia sênior (diretoria)",
  consultor: "Engenharia / conselho (orçamento e viabilidade)",
  ambiental: "Gestão executiva, ambiental e regulatória",
  cfo: "Diretoria financeira (CFO)",
  juridico: "Jurídico",
  projetista: "Engenharia de projetos",
  canteiro: "Gestão de obras / canteiro",
  comercial: "Comercial / corretores",
};

export interface Membro {
  id: string;
  nome: string;
  email?: string;
  /** Celular com DDI e DDD, só dígitos (para avisos por WhatsApp). */
  telefone?: string;
  papel: Papel;
}

export const TIPOS = ["contratacao", "orcamento", "aditivo", "medicao", "protocolo", "excecao_comercial"] as const;
export type TipoSolicitacao = (typeof TIPOS)[number];
export const TIPO_LABEL: Record<TipoSolicitacao, string> = {
  contratacao: "Contratação de fornecedor",
  orcamento: "Orçamento técnico",
  aditivo: "Aditivo ou serviço extra",
  medicao: "Medição de obra",
  protocolo: "Protocolo regulatório crítico",
  excecao_comercial: "Exceção de tabela (comercial)",
};

export const ETAPAS = ["pre_aprovacao", "presidencia", "financeiro"] as const;
export type Etapa = (typeof ETAPAS)[number];
export const ETAPA_LABEL: Record<Etapa, string> = { pre_aprovacao: "Pré-aprovação diretiva/jurídica", presidencia: "Presidência", financeiro: "Liberação financeira" };
/** Quem pode decidir em cada etapa (segregação de funções). */
export const PAPEIS_DA_ETAPA: Record<Etapa, readonly Papel[]> = {
  pre_aprovacao: ["diretoria_tecnica", "consultor", "ambiental", "juridico"],
  presidencia: ["presidente"],
  financeiro: ["cfo"],
};

export type Acao = "aprovar" | "devolver" | "reprovar";
export interface Decisao {
  etapa: Etapa;
  acao: Acao;
  membroId: string;
  nome: string;
  papel: Papel;
  /** ISO-8601 com hora. */
  em: string;
  justificativa?: string;
}

export type StatusSolicitacao = "pendente" | "devolvida" | "aprovada" | "reprovada";

export interface Solicitacao {
  id: string;
  tipo: TipoSolicitacao;
  titulo: string;
  valor: number;
  urgente: boolean;
  /** Atividade do cronograma afetada: ordena a fila pelo caminho crítico. */
  atividadeId?: string;
  /** Só medição: dentro do contrato aprovado dispensa a Presidência (nota da RACI, etapa 7). */
  dentroDoContrato?: boolean;
  /** Impacto no reforecast em R$ (obrigatório em aditivo antes da Presidência). */
  impactoReforecast?: number;
  criadaEm: string;
  criadaPor: string;
  decisoes: Decisao[];
  /** Reenvios depois de uma devolução: o fluxo recomeça na pré-aprovação. */
  reenvios: Reenvio[];
}

export interface Reenvio {
  em: string;
  por: string;
  ajuste: string;
}

export const MAX_SOLICITACOES = 600;
export const MAX_EQUIPE = 60;

/* ------------------------------------ fluxo ------------------------------------ */

/** Etapas exigidas para a solicitação, em ordem. */
export function etapasExigidas(s: Pick<Solicitacao, "tipo" | "dentroDoContrato" | "valor">): Etapa[] {
  const out: Etapa[] = ["pre_aprovacao"];
  if (!(s.tipo === "medicao" && s.dentroDoContrato)) out.push("presidencia");
  if (s.valor > 0 && s.tipo !== "excecao_comercial") out.push("financeiro");
  return out;
}

const ultimoReenvio = (s: Solicitacao) => s.reenvios.at(-1)?.em ?? "";

/** Decisões que valem: as posteriores ao último reenvio (o reenvio reinicia o fluxo). */
function decisoesVigentes(s: Solicitacao): Decisao[] {
  const r = ultimoReenvio(s);
  return r ? s.decisoes.filter((d) => Date.parse(d.em) >= Date.parse(r)) : s.decisoes;
}

export function statusSolicitacao(s: Solicitacao): { status: StatusSolicitacao; proxima: Etapa | null; aguardandoDesde: string } {
  const vig = decisoesVigentes(s);
  const ult = vig.at(-1);
  if (ult?.acao === "reprovar") return { status: "reprovada", proxima: null, aguardandoDesde: ult.em };
  if (ult?.acao === "devolver") return { status: "devolvida", proxima: null, aguardandoDesde: ult.em };
  const feitas = new Set(vig.filter((d) => d.acao === "aprovar").map((d) => d.etapa));
  const proxima = etapasExigidas(s).find((e) => !feitas.has(e)) ?? null;
  const desde = ult?.em ?? (ultimoReenvio(s) || s.criadaEm);
  return { status: proxima ? "pendente" : "aprovada", proxima, aguardandoDesde: desde };
}

/**
 * Registra uma decisão, conferindo papel, justificativa e as regras do documento.
 * `resubmeter` (sem etapa) reabre uma solicitação devolvida.
 */
export function decidir(s: Solicitacao, membro: Membro, acao: Acao, emIso: string, justificativa?: string): Solicitacao {
  const st = statusSolicitacao(s);
  if (st.status !== "pendente" || !st.proxima) throw new PmoError(st.status === "devolvida" ? "Solicitação devolvida: reenvie antes de decidir." : "Solicitação já encerrada.");
  const etapa = st.proxima;
  if (!PAPEIS_DA_ETAPA[etapa].includes(membro.papel)) throw new PmoError(`${ETAPA_LABEL[etapa]} é decisão de ${PAPEIS_DA_ETAPA[etapa].map((p) => PAPEL_LABEL[p]).join(" ou ")}.`);
  const just = justificativa?.trim() ?? "";
  if (acao !== "aprovar" && just.length < 5) throw new PmoError("Devolver ou reprovar exige justificativa.");
  if (acao === "aprovar" && etapa === "pre_aprovacao" && s.tipo === "aditivo" && s.impactoReforecast === undefined) throw new PmoError("Aditivo: registre o impacto no reforecast antes da pré-aprovação.");
  if (acao === "aprovar" && etapa === "pre_aprovacao" && s.decisoes.some((d) => d.membroId === membro.id && d.etapa !== "pre_aprovacao")) throw new PmoError("Quem decide em outra etapa não pode pré-aprovar a mesma solicitação.");
  if (Number.isNaN(Date.parse(emIso)) || Date.parse(emIso) < Date.parse(st.aguardandoDesde)) throw new PmoError("Data da decisão inválida.");
  const d: Decisao = { etapa, acao, membroId: membro.id, nome: membro.nome, papel: membro.papel, em: emIso, ...(just ? { justificativa: just.slice(0, 500) } : {}) };
  return { ...s, decisoes: [...s.decisoes, d] };
}

/** Reenvia uma solicitação devolvida, com o ajuste feito; o fluxo recomeça na pré-aprovação. */
export function reenviar(s: Solicitacao, por: string, emIso: string, ajuste: string): Solicitacao {
  if (statusSolicitacao(s).status !== "devolvida") throw new PmoError("Só uma solicitação devolvida pode ser reenviada.");
  const a = ajuste.trim();
  if (a.length < 5) throw new PmoError("Descreva o ajuste feito.");
  if (Number.isNaN(Date.parse(emIso)) || Date.parse(emIso) < Date.parse(s.decisoes.at(-1)!.em)) throw new PmoError("Data do reenvio inválida.");
  return { ...s, reenvios: [...s.reenvios, { em: emIso, por: por.trim().slice(0, 100) || "—", ajuste: a.slice(0, 500) }] };
}

/* ----------------------------------- SLA e fila ----------------------------------- */

export interface SlaAprovacao {
  /** Dias úteis aguardando a etapa atual. */
  diasUteis: number;
  /** Horas corridas (para o urgente de 48 h). */
  horas: number;
  atrasada: boolean;
  limite: string;
}

/** SLA de aprovação: até 3 dias úteis por etapa; urgente, 48 horas corridas. */
export function slaAprovacao(s: Solicitacao, agoraIso: string, cal: WorkCalendar = DEFAULT_CALENDAR): SlaAprovacao | null {
  const st = statusSolicitacao(s);
  if (st.status !== "pendente") return null;
  const desde = st.aguardandoDesde;
  const horas = Math.max(0, (Date.parse(agoraIso) - Date.parse(desde)) / 3_600_000);
  const diasUteis = workDaysBetween(desde.slice(0, 10), agoraIso.slice(0, 10), cal);
  const atrasada = s.urgente ? horas > 48 : diasUteis > 3;
  return { diasUteis, horas: Math.floor(horas), atrasada, limite: s.urgente ? "48 horas" : "3 dias úteis" };
}

/**
 * Fila da Central: pendentes primeiro pelo caminho crítico (folga ≤ 0), depois menor folga, urgência,
 * maior valor e mais antigas. `folgas` = folga total em dias úteis por atividade (do CPM).
 */
export function filaDeAprovacao(lista: readonly Solicitacao[], folgas: Readonly<Record<string, number>> = {}): Solicitacao[] {
  const folga = (s: Solicitacao) => (s.atividadeId !== undefined && Object.prototype.hasOwnProperty.call(folgas, s.atividadeId) ? folgas[s.atividadeId]! : Number.POSITIVE_INFINITY);
  return lista
    .filter((s) => statusSolicitacao(s).status === "pendente")
    .sort((a, b) => {
      const ca = folga(a) <= 0 ? 0 : 1, cb = folga(b) <= 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (folga(a) !== folga(b)) return folga(a) - folga(b);
      if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
      if (a.valor !== b.valor) return b.valor - a.valor;
      return a.criadaEm.localeCompare(b.criadaEm);
    });
}

/** Tempo entre a pré-aprovação e a decisão da Presidência (KPI "SLA de Aprovação Executiva"), em dias úteis. */
export function slaExecutivo(s: Solicitacao, cal: WorkCalendar = DEFAULT_CALENDAR): number | null {
  const v = decisoesVigentes(s);
  const pre = v.find((d) => d.etapa === "pre_aprovacao" && d.acao === "aprovar");
  const pres = v.find((d) => d.etapa === "presidencia");
  return pre && pres ? workDaysBetween(pre.em.slice(0, 10), pres.em.slice(0, 10), cal) : null;
}

/* ------------------------------------ limpeza ------------------------------------ */

export function cleanMembro(v: unknown): Membro | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 40), nome = text(v.nome, 100);
  if (!id || !nome || !(PAPEIS as readonly string[]).includes(v.papel as string)) return null;
  const m: Membro = { id, nome, papel: v.papel as Papel };
  if (typeof v.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) && v.email.length <= 120) m.email = v.email;
  if (typeof v.telefone === "string") {
    const t = v.telefone.replace(/\D/g, "");
    if (t.length >= 12 && t.length <= 15) m.telefone = t;
  }
  return m;
}

const isIsoTime = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) && isIsoDate(v.slice(0, 10));

export function cleanSolicitacao(v: unknown): Solicitacao | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 40), titulo = text(v.titulo, 200), criadaPor = text(v.criadaPor, 100);
  if (!id || !titulo || !criadaPor || !(TIPOS as readonly string[]).includes(v.tipo as string) || !nonNeg(v.valor) || !isIsoTime(v.criadaEm)) return null;
  const s: Solicitacao = { id, tipo: v.tipo as TipoSolicitacao, titulo, valor: v.valor, urgente: v.urgente === true, criadaEm: v.criadaEm, criadaPor, decisoes: [], reenvios: [] };
  const at = optText(v.atividadeId, 60);
  if (at) s.atividadeId = at;
  if (typeof v.dentroDoContrato === "boolean" && s.tipo === "medicao") s.dentroDoContrato = v.dentroDoContrato;
  if (typeof v.impactoReforecast === "number" && Number.isFinite(v.impactoReforecast)) s.impactoReforecast = v.impactoReforecast;
  for (const d of Array.isArray(v.decisoes) ? v.decisoes.slice(0, 50) : []) {
    if (!isObj(d) || !(ETAPAS as readonly string[]).includes(d.etapa as string) || !["aprovar", "devolver", "reprovar"].includes(d.acao as string) || !isIsoTime(d.em) || !(PAPEIS as readonly string[]).includes(d.papel as string)) continue;
    const mid = text(d.membroId, 40), nome = text(d.nome, 100);
    if (!mid || !nome) continue;
    const j = optText(d.justificativa, 500);
    s.decisoes.push({ etapa: d.etapa as Etapa, acao: d.acao as Acao, membroId: mid, nome, papel: d.papel as Papel, em: d.em, ...(j ? { justificativa: j } : {}) });
  }
  for (const r of Array.isArray(v.reenvios) ? v.reenvios.slice(0, 20) : []) {
    if (!isObj(r) || !isIsoTime(r.em)) continue;
    const por = text(r.por, 100), aj = text(r.ajuste, 500);
    if (por && aj) s.reenvios.push({ em: r.em, por, ajuste: aj });
  }
  return s;
}

export function novaSolicitacao(p: { id: string; tipo: TipoSolicitacao; titulo: string; valor: number; urgente?: boolean; atividadeId?: string; dentroDoContrato?: boolean; impactoReforecast?: number; criadaPor: string; criadaEm: string }): Solicitacao {
  const s = cleanSolicitacao({ ...p, urgente: p.urgente === true, decisoes: [], reenvios: [] });
  if (!s) throw new PmoError("Solicitação inválida: título, tipo, valor maior ou igual a zero e solicitante são obrigatórios.");
  return s;
}

export function nextSolicitacaoId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, p) => Math.max(m, Number(/^AL-(\d+)$/.exec(p.id)?.[1] ?? 0)), 0);
  return `AL-${String(n + 1).padStart(4, "0")}`;
}

/** Dias corridos parada (para o alerta "aprovação parada > 3 d.u." usa-se slaAprovacao). */
export const diasParada = (s: Solicitacao, hoje: string) => daysBetween(statusSolicitacao(s).aguardandoDesde.slice(0, 10), hoje);

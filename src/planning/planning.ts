import { MAX_CONTRACTS, MAX_PAYMENTS, cleanContract, cleanContractDeltas, cleanPayment, summarizeContracts, validatePayment, type Contract, type ContractSummary, type Payment } from "../contracts/contracts";
import type { Baseline } from "../baseline/baseline";
import { transitionChange, type ChangeRequest, type ChangeStatus } from "../changes/changeRequest";
import { DEFAULT_CALENDAR, type WorkCalendar } from "../cpm/calendar";
import { LINK_TYPES, type LinkType } from "../cpm/types";
import { addDaysIso, parseIsoDate } from "../dates";
import { PmoError } from "../errors";
import { MAX_SCENARIOS, validateScenario, type Scenario } from "../scenarios/scenario";
import { assessCbs, splitInvoice, type CbsAssessment, type Purchase, type PurchaseCategory } from "../tax/cbs";

export interface CostEntry {
  committed?: number;
  actual?: number;
  etc?: number;
}

/** Dados de cronograma de uma atividade, no estilo do Primavera. Cada campo ausente usa o padrão derivado do cadastro. */
export interface ActivityPlan {
  /** Duração em dias úteis (0 = marco). */
  durationDays?: number;
  /** Predecessoras com tipo e defasagem. `[]` = começa no início da obra; ausente = em sequência na lista. */
  predecessors?: { id: string; type?: LinkType; lag?: number }[];
  /** 0..100; vale sobre o percentual do status. */
  percentComplete?: number;
  /** "Não iniciar antes de" (YYYY-MM-DD). */
  notBefore?: string;
  /** "Terminar até" (YYYY-MM-DD): prazo-limite; não move a atividade, só aponta violação (ver `deadlineChecks`). */
  deadline?: string;
  /** Código de atividade (grupo), texto livre até 40 caracteres. */
  group?: string;
  /** Restrição obrigatória: a atividade começa ou termina na data, prevalecendo sobre as predecessoras. */
  constraint?: { kind: "iniciar_em" | "terminar_em"; date: string };
  /** Passos da atividade, com peso; sem % informado, o avanço é a soma dos pesos concluídos. */
  steps?: ActivityStep[];
  /** Documentos e produtos de trabalho ligados à atividade. */
  documents?: ActivityDocument[];
  /** Recursos atribuídos (função ou pessoa) com unidades (1 = dedicação integral). Ausente = só o responsável do cadastro, com 1 unidade. */
  assignments?: ResourceAssignmentPlan[];
  /** Códigos de atividade definidos pelo usuário: id do tipo (`ActivityCodeType.id`) → valor. */
  codes?: Record<string, string>;
  /** Data real de início (YYYY-MM-DD). */
  actualStart?: string;
  /** Data real de término (YYYY-MM-DD, inclusive); implica 100% concluído se o % não for informado. */
  actualFinish?: string;
}

export interface ActivityStep {
  title: string;
  done: boolean;
  /** Peso relativo, 1 a 100. */
  weight: number;
}
export const DOCUMENT_KINDS = ["documento", "produto", "evidencia", "licenca"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = ["pendente", "entregue", "aprovado"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
/** Documento ou produto de trabalho de uma atividade (como os "work products and documents" do Primavera). */
export interface ActivityDocument {
  name: string;
  kind: DocumentKind;
  status: DocumentStatus;
  /** Endereço http(s) do arquivo, quando houver. */
  url?: string;
}
export const MAX_STEPS = 30;
export const MAX_DOCUMENTS = 20;

/** Avanço pelos passos (0..100, uma casa); null sem passos. */
export function stepsPercent(steps: readonly ActivityStep[] | undefined): number | null {
  if (!steps || steps.length === 0) return null;
  const total = steps.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  const done = steps.reduce((s, x) => s + (x.done ? x.weight : 0), 0);
  return Math.round((done / total) * 1000) / 10;
}

export interface ResourceAssignmentPlan {
  resource: string;
  /** Fração de uma pessoa por dia (0,05 a 20). */
  units: number;
}
export const MAX_ASSIGNMENTS = 10;
export const MAX_CODE_TYPES = 10;
export const MAX_CODE_VALUES = 50;
export const MAX_CODE_LENGTH = 40;

/** Tipo de código de atividade (como os códigos de atividade do Primavera): nome e lista fechada de valores. */
export interface ActivityCodeType {
  id: string;
  name: string;
  values: string[];
}

export const RISK_STATUSES = ["aberto", "mitigando", "ocorrido", "encerrado"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const MAX_RISKS = 200;

/** Item do registro de riscos: probabilidade e impacto de 1 (muito baixo) a 5 (muito alto). */
export interface Risk {
  id: string;
  title: string;
  probability: number;
  impact: number;
  status: RiskStatus;
  owner?: string;
  mitigation?: string;
  /** Atividade afetada (opcional). */
  activityId?: string;
}

export const ISSUE_STATUSES = ["aberta", "em_andamento", "resolvida"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const MAX_ISSUES = 300;
export const MAX_PROGRAM_LENGTH = 60;

/** Questão (issue): problema que já ocorreu e precisa de ação, diferente do risco, que ainda pode ocorrer. */
export interface Issue {
  id: string;
  title: string;
  status: IssueStatus;
  /** 1 (baixa) a 3 (alta). */
  priority: 1 | 2 | 3;
  owner?: string;
  /** Prazo para resolver (YYYY-MM-DD). */
  dueDate?: string;
  resolution?: string;
  /** Atividade afetada (opcional). */
  activityId?: string;
}

export const MAX_HISTORY = 300;
export const MAX_TAX_PURCHASES = 100;

const PURCHASE_CATEGORIES: readonly PurchaseCategory[] = ["cloud", "software", "api", "utilidades", "aluguel", "combustivel", "manutencao_frota", "equipamento_campo", "laudos_analises", "folha_clt", "pro_labore", "rpa_autonomo", "uso_pessoal", "outro"];

/** Nota de compra da obra, para o crédito de CBS. */
export interface TaxPurchase extends Purchase {
  id: string;
}

/** Tributação (CBS) da obra: fatia de serviços de engenharia no faturamento e compras com CBS destacada. */
export interface TaxState {
  /** 0..1: parte do faturamento (orçamento da obra) que é serviço de engenharia; o resto é licença de software. */
  engineeringShare: number;
  purchases: TaxPurchase[];
}

/** Estado do licenciamento GRAPROHAB/CETESB da obra, como digitado na tela (textos). */
export interface LicensingState {
  /** YYYY-MM-DD ou "" */
  start: string;
  withComunique: boolean;
  /** Dias por etapa (texto digitado), por id de etapa. */
  days: Record<string, string>;
  /** Ids dos documentos já reunidos. */
  present: string[];
  /** Data de emissão da certidão ("" se não houver). */
  issuedOn: string;
  /** Largura do rio em metros (texto). */
  river: string;
  /** Tabelas de área por fonte (Planta, Memorial…) → campo → texto. */
  areas: Record<string, Record<string, string>>;
}

export const MAX_LICENSE_PROCESSES = 20;

/** Processo de licenciamento adicional (o principal continua em `licensing`): mesmo estado, com id e nome. */
export interface LicenseProcess extends LicensingState {
  id: string;
  name: string;
}

export const EMPTY_LICENSING: LicensingState = Object.freeze({ start: "", withComunique: false, days: {}, present: [], issuedOn: "", river: "20", areas: {} }) as LicensingState;

/** Linha do histórico de alterações do planejamento. */
export interface HistoryEntry {
  /** ISO-8601 */
  at: string;
  by: string;
  summary: string;
}

/**
 * Dados de planejamento de uma obra que o cadastro não tinha: linhas de base, custos e pedidos de
 * mudança. Vão dentro da própria obra (mesmo registro do Odoo). `rev` conta as gravações, para
 * detectar edição concorrente.
 */
export interface WorkPlanning {
  rev: number;
  baselines: Baseline[];
  /** Posição (0 = primeira) da linha de base primária, usada no EVM e no Gantt; ausente = a mais recente. */
  primaryBaseline?: number;
  /** Custos por id de atividade. */
  costs: Record<string, CostEntry>;
  changes: ChangeRequest[];
  /** Cronograma por atividade (id da atividade). */
  activityPlans: Record<string, ActivityPlan>;
  /** Feriados da obra (YYYY-MM-DD), além de sábados e domingos. */
  holidays: string[];
  /** Registro de riscos da obra. */
  risks: Risk[];
  /** Histórico de alterações (mais antigas primeiro; guarda as últimas MAX_HISTORY). */
  history: HistoryEntry[];
  /** Diária (R$) por responsável, usada no custo de mão de obra. */
  resourceRates: Record<string, number>;
  /** Licenciamento GRAPROHAB da obra (ausente até ser preenchido). */
  licensing?: LicensingState;
  /** Outros processos de licenciamento do mesmo projeto (fases, órgãos, outorgas). */
  licenses: LicenseProcess[];
  /** CBS da obra (ausente até ser preenchido). */
  tax?: TaxState;
  /** Impacto socioambiental do projeto (ausente até ser preenchido). */
  impact?: ImpactState;
  /** Cenários "e se" salvos (não alteram o plano). */
  scenarios: Scenario[];
  /** Questões (issues) da obra. */
  issues: Issue[];
  /** Contratos e compromissos ligados às atividades. */
  contracts: Contract[];
  /** Pagamentos (realizados e previstos) dos contratos, com data. */
  payments: Payment[];
  /** Capacidade (pessoas por dia) por recurso; ausente = 1. */
  resourceCapacity: Record<string, number>;
  /** Tipos de código de atividade definidos para a obra. */
  codeTypes: ActivityCodeType[];
  /** Programa ou carteira a que o projeto pertence (nível acima do projeto); ausente = sem programa. */
  program?: string;
}

/** Dimensões do impacto socioambiental, cada uma de 0 (nenhum) a 5 (muito alto). */
export const IMPACT_DIMENSIONS = ["ecological", "climate", "water", "social"] as const;
export type ImpactDimension = (typeof IMPACT_DIMENSIONS)[number];
export const IMPACT_LABEL: Record<ImpactDimension, string> = {
  ecological: "Biodiversidade e recuperação ambiental",
  climate: "Clima (redução ou remoção de emissões)",
  water: "Recursos hídricos e solo",
  social: "Benefício social e comunitário",
};

/** Objetivos de Desenvolvimento Sustentável (ONU), nomes em português usados no Brasil. */
export const SDG_LABELS: readonly string[] = [
  "Erradicação da pobreza", "Fome zero e agricultura sustentável", "Saúde e bem-estar", "Educação de qualidade", "Igualdade de gênero",
  "Água potável e saneamento", "Energia limpa e acessível", "Trabalho decente e crescimento econômico", "Indústria, inovação e infraestrutura",
  "Redução das desigualdades", "Cidades e comunidades sustentáveis", "Consumo e produção responsáveis", "Ação contra a mudança global do clima",
  "Vida na água", "Vida terrestre", "Paz, justiça e instituições eficazes", "Parcerias e meios de implementação",
];

/** Perfil de impacto socioambiental de um projeto (estimativa do time, não certificação). */
export interface ImpactState {
  scores: Record<ImpactDimension, number>;
  /** Área recuperada ou protegida (hectares). */
  hectares?: number;
  /** Pessoas beneficiadas diretamente. */
  beneficiaries?: number;
  /** Emissões evitadas ou removidas (tCO2e). */
  tco2e?: number;
  notes?: string;
  /** ODS (1 a 17) a que o projeto contribui, em ordem crescente e sem repetição. */
  sdgs?: number[];
  /** Metodologia usada para chegar às notas e metas (ex.: protocolo, norma, laudo). */
  method?: string;
  /** Evidência: referência de laudo, relatório ou documento que sustenta os números. */
  evidence?: string;
}

/** Índice de impacto 0..1: média das quatro dimensões sobre o máximo (5). */
export function impactIndex(s: Pick<ImpactState, "scores"> | undefined): number | null {
  if (!s) return null;
  const sum = IMPACT_DIMENSIONS.reduce((a, d) => a + s.scores[d], 0);
  return Math.round((sum / (IMPACT_DIMENSIONS.length * 5)) * 1000) / 1000;
}

export const EMPTY_IMPACT: ImpactState = Object.freeze({ scores: Object.freeze({ ecological: 0, climate: 0, water: 0, social: 0 }) }) as ImpactState;

export const EMPTY_PLANNING: WorkPlanning = Object.freeze({
  rev: 0,
  baselines: [],
  costs: {},
  changes: [],
  activityPlans: {},
  holidays: [],
  risks: [],
  history: [],
  resourceRates: {},
  scenarios: [],
  issues: [],
  licenses: [],
  resourceCapacity: {},
  codeTypes: [],
  contracts: [],
  payments: [],
}) as WorkPlanning;
export const MAX_HOLIDAYS = 400;
export const MAX_PREDECESSORS = 50;
export const MAX_DURATION_DAYS = 3650;
export const MAX_GROUP_LENGTH = 40;
export const MAX_BASELINES = 20;
const STATUSES: ReadonlySet<string> = new Set(["rascunho", "em_aprovacao", "aprovada", "rejeitada"]);
const COST_KEYS = ["committed", "actual", "etc"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isMoney = (v: unknown): v is number => isNum(v) && v >= 0;
const safeKey = (k: string) => k !== "" && k !== "__proto__" && k !== "constructor" && k !== "prototype";

function cleanBaseline(v: unknown): Baseline | null {
  if (!isObj(v) || typeof v.name !== "string" || v.name.trim() === "" || typeof v.createdAt !== "string") return null;
  if (!isNum(v.projectDuration) || !isNum(v.totalCost) || !Array.isArray(v.items)) return null;
  const items = [];
  for (const it of v.items) {
    if (!isObj(it) || typeof it.id !== "string" || !isNum(it.start) || !isNum(it.finish) || !isNum(it.duration) || !isNum(it.plannedCost)) return null;
    items.push({ id: it.id, start: it.start, finish: it.finish, duration: it.duration, plannedCost: it.plannedCost });
  }
  return { name: v.name, createdAt: v.createdAt, projectDuration: v.projectDuration, totalCost: v.totalCost, items };
}

function cleanDeltas(v: unknown): { activityId: string; delta: number }[] | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const d of v) {
    if (!isObj(d) || typeof d.activityId !== "string" || !isNum(d.delta)) return null;
    out.push({ activityId: d.activityId, delta: d.delta });
  }
  return out;
}

function cleanChange(v: unknown): ChangeRequest | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.title !== "string" || typeof v.status !== "string" || !STATUSES.has(v.status)) return null;
  const dur = cleanDeltas(v.durationDeltas);
  const cost = cleanDeltas(v.costDeltas);
  const contractDeltas = cleanContractDeltas(v.contractDeltas);
  if (dur === null || cost === null || contractDeltas === null) return null;
  const cr: ChangeRequest = { id: v.id, title: v.title, status: v.status as ChangeStatus };
  if (contractDeltas) cr.contractDeltas = contractDeltas;
  if (dur) cr.durationDeltas = dur;
  if (cost) cr.costDeltas = cost;
  return cr;
}

const validDate = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    parseIsoDate(v);
    return true;
  } catch {
    return false;
  }
};

function cleanPredecessors(v: unknown): { id: string; type?: LinkType; lag?: number }[] | null {
  if (!Array.isArray(v) || v.length > MAX_PREDECESSORS) return null;
  const out: { id: string; type?: LinkType; lag?: number }[] = [];
  const seen = new Set<string>();
  for (const p of v) {
    if (!isObj(p) || typeof p.id !== "string" || p.id === "" || seen.has(p.id)) return null;
    if (p.type !== undefined && !(LINK_TYPES as readonly string[]).includes(p.type as string)) return null;
    if (p.lag !== undefined && !(Number.isInteger(p.lag) && Math.abs(p.lag as number) <= MAX_DURATION_DAYS)) return null;
    seen.add(p.id);
    const q: { id: string; type?: LinkType; lag?: number } = { id: p.id };
    if (p.type !== undefined) q.type = p.type as LinkType;
    if (p.lag !== undefined) q.lag = p.lag as number;
    out.push(q);
  }
  return out;
}

/** Valida um ActivityPlan; devolve null se algum campo estiver inválido. */
function cleanActivityPlan(v: unknown): ActivityPlan | null {
  if (!isObj(v)) return null;
  const out: ActivityPlan = {};
  if (v.durationDays !== undefined) {
    if (!(Number.isInteger(v.durationDays) && (v.durationDays as number) >= 0 && (v.durationDays as number) <= MAX_DURATION_DAYS)) return null;
    out.durationDays = v.durationDays as number;
  }
  if (v.predecessors !== undefined) {
    const p = cleanPredecessors(v.predecessors);
    if (p === null) return null;
    out.predecessors = p;
  }
  if (v.percentComplete !== undefined) {
    if (!(isNum(v.percentComplete) && v.percentComplete >= 0 && v.percentComplete <= 100)) return null;
    out.percentComplete = v.percentComplete;
  }
  if (v.notBefore !== undefined) {
    if (!validDate(v.notBefore)) return null;
    out.notBefore = v.notBefore;
  }
  if (v.deadline !== undefined) {
    if (!validDate(v.deadline)) return null;
    out.deadline = v.deadline;
  }
  for (const k of ["actualStart", "actualFinish"] as const) {
    if (v[k] !== undefined) {
      if (!validDate(v[k])) return null;
      out[k] = v[k] as string;
    }
  }
  if (out.actualStart && out.actualFinish && out.actualFinish < out.actualStart) return null;
  if (v.group !== undefined) {
    if (typeof v.group !== "string") return null;
    const g = v.group.trim();
    if (g.length > MAX_GROUP_LENGTH) return null;
    if (g !== "") out.group = g;
  }
  if (v.constraint !== undefined) {
    if (!isObj(v.constraint) || (v.constraint.kind !== "iniciar_em" && v.constraint.kind !== "terminar_em") || !validDate(v.constraint.date)) return null;
    out.constraint = { kind: v.constraint.kind, date: v.constraint.date };
  }
  if (v.steps !== undefined) {
    if (!Array.isArray(v.steps) || v.steps.length > MAX_STEPS) return null;
    const steps: ActivityStep[] = [];
    for (const x of v.steps) {
      if (!isObj(x) || typeof x.done !== "boolean") return null;
      const title = optText(x.title, 120);
      if (!title || !(isNum(x.weight) && x.weight >= 1 && x.weight <= 100)) return null;
      steps.push({ title, done: x.done, weight: Math.round(x.weight * 100) / 100 });
    }
    if (steps.length > 0) out.steps = steps;
  }
  if (v.documents !== undefined) {
    if (!Array.isArray(v.documents) || v.documents.length > MAX_DOCUMENTS) return null;
    const docs: ActivityDocument[] = [];
    for (const x of v.documents) {
      if (!isObj(x)) return null;
      const name = optText(x.name, 120);
      const url = optText(x.url, 500);
      if (!name || url === null) return null;
      if (typeof x.kind !== "string" || !(DOCUMENT_KINDS as readonly string[]).includes(x.kind)) return null;
      if (typeof x.status !== "string" || !(DOCUMENT_STATUSES as readonly string[]).includes(x.status)) return null;
      if (url !== undefined && !/^https?:\/\/[^\s]+$/i.test(url)) return null;
      const d: ActivityDocument = { name, kind: x.kind as DocumentKind, status: x.status as DocumentStatus };
      if (url) d.url = url;
      docs.push(d);
    }
    if (docs.length > 0) out.documents = docs;
  }
  if (v.assignments !== undefined) {
    if (!Array.isArray(v.assignments) || v.assignments.length > MAX_ASSIGNMENTS) return null;
    const list: ResourceAssignmentPlan[] = [];
    for (const a of v.assignments) {
      if (!isObj(a) || typeof a.resource !== "string") return null;
      const resource = a.resource.trim();
      if (resource === "" || resource.length > 100 || !safeKey(resource) || !isNum(a.units) || a.units < 0.05 || a.units > 20) return null;
      if (list.some((x) => x.resource === resource)) return null;
      list.push({ resource, units: Math.round(a.units * 100) / 100 });
    }
    if (list.length > 0) out.assignments = list;
  }
  if (v.codes !== undefined) {
    if (!isObj(v.codes) || Object.keys(v.codes).length > MAX_CODE_TYPES) return null;
    const codes: Record<string, string> = {};
    for (const [k, x] of Object.entries(v.codes)) {
      if (!safeKey(k) || k.length > 40 || typeof x !== "string") return null;
      const t = x.trim();
      if (t.length > MAX_CODE_LENGTH) return null;
      if (t !== "") codes[k] = t;
    }
    if (Object.keys(codes).length > 0) out.codes = codes;
  }
  return out;
}

function cleanCodeType(v: unknown): ActivityCodeType | null {
  if (!isObj(v) || typeof v.id !== "string" || v.id === "" || v.id.length > 40 || !safeKey(v.id)) return null;
  const name = optText(v.name, MAX_CODE_LENGTH);
  if (!name || !Array.isArray(v.values) || v.values.length > MAX_CODE_VALUES) return null;
  const values: string[] = [];
  for (const x of v.values) {
    if (typeof x !== "string") return null;
    const t = x.trim();
    if (t.length > MAX_CODE_LENGTH) return null;
    if (t !== "" && !values.includes(t)) values.push(t);
  }
  return { id: v.id, name, values };
}

const isLevel = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
const optText = (v: unknown, max: number): string | undefined | null => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > max) return null;
  const t = v.trim();
  return t === "" ? undefined : t;
};

function cleanRisk(v: unknown): Risk | null {
  if (!isObj(v) || typeof v.id !== "string" || v.id === "" || !safeKey(v.id)) return null;
  const title = optText(v.title, 200);
  if (!title || !isLevel(v.probability) || !isLevel(v.impact)) return null;
  if (typeof v.status !== "string" || !(RISK_STATUSES as readonly string[]).includes(v.status)) return null;
  const owner = optText(v.owner, 100);
  const mitigation = optText(v.mitigation, 1000);
  const activityId = optText(v.activityId, 200);
  if (owner === null || mitigation === null || activityId === null) return null;
  const r: Risk = { id: v.id, title, probability: v.probability, impact: v.impact, status: v.status as RiskStatus };
  if (owner) r.owner = owner;
  if (mitigation) r.mitigation = mitigation;
  if (activityId) r.activityId = activityId;
  return r;
}

function cleanIssue(v: unknown): Issue | null {
  if (!isObj(v) || typeof v.id !== "string" || v.id === "" || !safeKey(v.id)) return null;
  const title = optText(v.title, 200);
  if (!title) return null;
  if (typeof v.status !== "string" || !(ISSUE_STATUSES as readonly string[]).includes(v.status)) return null;
  if (v.priority !== 1 && v.priority !== 2 && v.priority !== 3) return null;
  const owner = optText(v.owner, 100);
  const resolution = optText(v.resolution, 1000);
  const activityId = optText(v.activityId, 200);
  if (owner === null || resolution === null || activityId === null) return null;
  if (v.dueDate !== undefined && v.dueDate !== "" && !validDate(v.dueDate)) return null;
  const q: Issue = { id: v.id, title, status: v.status as IssueStatus, priority: v.priority };
  if (owner) q.owner = owner;
  if (typeof v.dueDate === "string" && v.dueDate !== "") q.dueDate = v.dueDate;
  if (resolution) q.resolution = resolution;
  if (activityId) q.activityId = activityId;
  return q;
}

const short = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** Valida o estado do licenciamento; devolve null se algum campo for inválido. */
export function cleanLicensing(v: unknown): LicensingState | null {
  if (!isObj(v)) return null;
  const start = v.start === "" ? "" : validDate(v.start) ? (v.start as string) : null;
  const issuedOn = v.issuedOn === "" ? "" : validDate(v.issuedOn) ? (v.issuedOn as string) : null;
  const river = short(v.river, 12);
  if (start === null || issuedOn === null || river === null || typeof v.withComunique !== "boolean") return null;
  const days: Record<string, string> = {};
  if (!isObj(v.days) || Object.keys(v.days).length > 30) return null;
  for (const [k, x] of Object.entries(v.days)) {
    const t = short(x, 12);
    if (!safeKey(k) || k.length > 40 || t === null) return null;
    days[k] = t;
  }
  if (!Array.isArray(v.present) || v.present.length > 60) return null;
  const present: string[] = [];
  for (const d of v.present) {
    const t = short(d, 60);
    if (t === null || t === "") return null;
    if (!present.includes(t)) present.push(t);
  }
  const areas: Record<string, Record<string, string>> = {};
  if (!isObj(v.areas) || Object.keys(v.areas).length > 10) return null;
  for (const [src, fields] of Object.entries(v.areas)) {
    if (!safeKey(src) || src.length > 60 || !isObj(fields) || Object.keys(fields).length > 10) return null;
    const out: Record<string, string> = {};
    for (const [f, x] of Object.entries(fields)) {
      const t = short(x, 20);
      if (!safeKey(f) || f.length > 20 || t === null) return null;
      out[f] = t;
    }
    areas[src] = out;
  }
  return { start, withComunique: v.withComunique, days, present, issuedOn, river, areas };
}

function cleanLicenseProcess(v: unknown): LicenseProcess | null {
  if (!isObj(v) || typeof v.id !== "string" || v.id === "" || !safeKey(v.id) || v.id.length > 40) return null;
  const name = optText(v.name, 80);
  const state = cleanLicensing(v);
  if (!name || state === null) return null;
  return { id: v.id, name, ...state };
}

/** Valida o estado de CBS; devolve null se algum campo for inválido. */
export function cleanImpact(v: unknown): ImpactState | null {
  if (!isObj(v) || !isObj(v.scores)) return null;
  const scores = {} as Record<ImpactDimension, number>;
  for (const d of IMPACT_DIMENSIONS) {
    const x = v.scores[d];
    if (!(Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 5)) return null;
    scores[d] = x as number;
  }
  const out: ImpactState = { scores };
  for (const k of ["hectares", "beneficiaries", "tco2e"] as const) {
    if (v[k] !== undefined) {
      if (!(isNum(v[k]) && (v[k] as number) >= 0 && (v[k] as number) <= 1e12)) return null;
      out[k] = v[k] as number;
    }
  }
  const notes = optText(v.notes, 1000);
  if (notes === null) return null;
  if (notes) out.notes = notes;
  if (v.sdgs !== undefined) {
    if (!Array.isArray(v.sdgs) || v.sdgs.length > SDG_LABELS.length || !v.sdgs.every((n) => Number.isInteger(n) && n >= 1 && n <= SDG_LABELS.length)) return null;
    const uniq = [...new Set(v.sdgs as number[])].sort((a, b) => a - b);
    if (uniq.length > 0) out.sdgs = uniq;
  }
  for (const [k, max] of [["method", 300], ["evidence", 500]] as const) {
    const t = optText(v[k], max);
    if (t === null) return null;
    if (t) out[k] = t;
  }
  return out;
}

export function cleanTax(v: unknown): TaxState | null {
  if (!isObj(v) || !isNum(v.engineeringShare) || v.engineeringShare < 0 || v.engineeringShare > 1) return null;
  if (!Array.isArray(v.purchases) || v.purchases.length > MAX_TAX_PURCHASES) return null;
  const purchases: TaxPurchase[] = [];
  const seen = new Set<string>();
  for (const x of v.purchases) {
    if (!isObj(x) || typeof x.id !== "string" || x.id === "" || x.id.length > 40 || !safeKey(x.id) || seen.has(x.id)) return null;
    if (typeof x.category !== "string" || !(PURCHASE_CATEGORIES as readonly string[]).includes(x.category)) return null;
    if (!isMoney(x.cbsDestacada) || typeof x.supplierIsRegularPJ !== "boolean") return null;
    if (x.linkedToActivity !== undefined && typeof x.linkedToActivity !== "boolean") return null;
    const d = optText(x.description, 200);
    if (d === null) return null;
    seen.add(x.id);
    const q: TaxPurchase = { id: x.id, category: x.category as PurchaseCategory, cbsDestacada: x.cbsDestacada, supplierIsRegularPJ: x.supplierIsRegularPJ };
    if (d) q.description = d;
    if (x.linkedToActivity !== undefined) q.linkedToActivity = x.linkedToActivity;
    purchases.push(q);
  }
  return { engineeringShare: v.engineeringShare, purchases };
}

function cleanHolidays(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(validDate))].sort().slice(0, MAX_HOLIDAYS);
}

/** Lê o planejamento de dados externos (JSON do Odoo ou do cache): descarta o que estiver inválido. */
export function normalizePlanning(raw: unknown): WorkPlanning {
  if (!isObj(raw)) return EMPTY_PLANNING;
  const baselines = (Array.isArray(raw.baselines) ? raw.baselines : []).flatMap((b) => cleanBaseline(b) ?? []).slice(-MAX_BASELINES);
  const seen = new Set<string>();
  const changes = (Array.isArray(raw.changes) ? raw.changes : []).flatMap((c) => {
    const cr = cleanChange(c);
    if (!cr || seen.has(cr.id)) return [];
    seen.add(cr.id);
    return [cr];
  });
  const costs: Record<string, CostEntry> = {};
  if (isObj(raw.costs)) {
    for (const [id, e] of Object.entries(raw.costs)) {
      if (!safeKey(id) || !isObj(e)) continue;
      const entry: CostEntry = {};
      for (const k of COST_KEYS) if (isMoney(e[k])) entry[k] = e[k];
      if (Object.keys(entry).length > 0) costs[id] = entry;
    }
  }
  const activityPlans: Record<string, ActivityPlan> = {};
  if (isObj(raw.activityPlans)) {
    for (const [id, v] of Object.entries(raw.activityPlans)) {
      const ap = safeKey(id) ? cleanActivityPlan(v) : null;
      if (ap && Object.keys(ap).length > 0) activityPlans[id] = ap;
    }
  }
  const codeTypes: ActivityCodeType[] = [];
  if (Array.isArray(raw.codeTypes)) {
    const seenType = new Set<string>();
    for (const t of raw.codeTypes.slice(0, MAX_CODE_TYPES)) {
      const c = cleanCodeType(t);
      if (c && !seenType.has(c.id)) {
        seenType.add(c.id);
        codeTypes.push(c);
      }
    }
  }
  // Códigos que apontam para tipo ou valor que não existe mais são descartados.
  for (const [id, ap] of Object.entries(activityPlans)) {
    if (!ap.codes) continue;
    const kept = Object.fromEntries(Object.entries(ap.codes).filter(([k, val]) => codeTypes.find((t) => t.id === k)?.values.includes(val)));
    if (Object.keys(kept).length === 0) {
      const { codes: _drop, ...rest } = ap;
      if (Object.keys(rest).length === 0) delete activityPlans[id];
      else activityPlans[id] = rest;
    } else ap.codes = kept;
  }
  const contracts: Contract[] = [];
  if (Array.isArray(raw.contracts)) {
    const seenK = new Set<string>();
    for (const k of raw.contracts.slice(0, MAX_CONTRACTS)) {
      const c = cleanContract(k);
      if (c && !seenK.has(c.id)) {
        seenK.add(c.id);
        contracts.push(c);
      }
    }
  }
  const payments: Payment[] = [];
  if (Array.isArray(raw.payments)) {
    const seenP = new Set<string>();
    for (const x of raw.payments.slice(0, MAX_PAYMENTS)) {
      const c = cleanPayment(x);
      if (c && !seenP.has(c.id) && contracts.some((k) => k.id === c.contractId)) {
        seenP.add(c.id);
        payments.push(c);
      }
    }
  }
  const resourceCapacity: Record<string, number> = {};
  if (isObj(raw.resourceCapacity)) {
    for (const [k, v] of Object.entries(raw.resourceCapacity)) if (safeKey(k) && k.length <= 100 && isNum(v) && v > 0 && v <= 100) resourceCapacity[k] = v;
  }
  const rev = Number.isInteger(raw.rev) && (raw.rev as number) >= 0 ? (raw.rev as number) : 0;
  const risks: Risk[] = [];
  if (Array.isArray(raw.risks)) {
    const seen = new Set<string>();
    for (const r of raw.risks.slice(0, MAX_RISKS)) {
      const c = cleanRisk(r);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        risks.push(c);
      }
    }
  }
  const issues: Issue[] = [];
  if (Array.isArray(raw.issues)) {
    const seenIssue = new Set<string>();
    for (const q of raw.issues.slice(0, MAX_ISSUES)) {
      const c = cleanIssue(q);
      if (c && !seenIssue.has(c.id)) {
        seenIssue.add(c.id);
        issues.push(c);
      }
    }
  }
  const licenses: LicenseProcess[] = [];
  if (Array.isArray(raw.licenses)) {
    const seenLic = new Set<string>();
    for (const l of raw.licenses.slice(0, MAX_LICENSE_PROCESSES)) {
      const c = cleanLicenseProcess(l);
      if (c && !seenLic.has(c.id)) {
        seenLic.add(c.id);
        licenses.push(c);
      }
    }
  }
  const history: HistoryEntry[] = [];
  if (Array.isArray(raw.history)) {
    for (const h of raw.history) {
      if (isObj(h) && typeof h.at === "string" && typeof h.by === "string" && typeof h.summary === "string" && h.summary !== "" && h.summary.length <= 500 && h.by.length <= 100 && Number.isFinite(Date.parse(h.at))) {
        history.push({ at: h.at, by: h.by, summary: h.summary });
      }
    }
  }
  const resourceRates: Record<string, number> = {};
  if (isObj(raw.resourceRates)) {
    for (const [k, v] of Object.entries(raw.resourceRates)) if (safeKey(k) && k.length <= 100 && isMoney(v)) resourceRates[k] = v;
  }
  const result: WorkPlanning = { rev, baselines, costs, changes, activityPlans, holidays: cleanHolidays(raw.holidays), risks, history: history.slice(-MAX_HISTORY), resourceRates, scenarios: [], issues, licenses, resourceCapacity, codeTypes, contracts, payments };
  const scenarios: Scenario[] = [];
  if (Array.isArray(raw.scenarios)) {
    const seen = new Set<string>();
    for (const x of raw.scenarios.slice(0, MAX_SCENARIOS)) {
      try {
        validateScenario(x as Scenario);
        const sc = x as Scenario;
        if (!seen.has(sc.id) && safeKey(sc.id)) {
          seen.add(sc.id);
          scenarios.push({ id: sc.id, name: sc.name.trim(), ...(sc.costFactor !== undefined ? { costFactor: sc.costFactor } : {}), changes: sc.changes.map((c) => ({ ...c })) });
        }
      } catch {
        /* cenário inválido: descartado */
      }
    }
  }
  result.scenarios = scenarios;
  const tax = raw.tax === undefined ? null : cleanTax(raw.tax);
  if (tax) result.tax = tax;
  const licensing = raw.licensing === undefined ? null : cleanLicensing(raw.licensing);
  if (licensing) result.licensing = licensing;
  const impact = raw.impact === undefined ? null : cleanImpact(raw.impact);
  if (impact) result.impact = impact;
  const program = optText(raw.program, MAX_PROGRAM_LENGTH);
  if (program) result.program = program;
  if (Number.isInteger(raw.primaryBaseline) && (raw.primaryBaseline as number) >= 0 && (raw.primaryBaseline as number) < baselines.length) {
    result.primaryBaseline = raw.primaryBaseline as number;
  }
  return result;
}

const bump = (p: WorkPlanning, patch: Partial<WorkPlanning>): WorkPlanning => ({ ...p, ...patch, rev: p.rev + 1 });

export function withBaseline(p: WorkPlanning, baseline: Baseline): WorkPlanning {
  if (cleanBaseline(baseline) === null) throw new PmoError("Baseline inválida.");
  if (p.baselines.length >= MAX_BASELINES) throw new PmoError(`Limite de ${MAX_BASELINES} baselines por obra.`);
  return bump(p, { baselines: [...p.baselines, baseline] });
}

/** Linha de base primária: a escolhida, ou a mais recente quando nenhuma foi escolhida. */
export function primaryBaselineOf(p: Pick<WorkPlanning, "baselines" | "primaryBaseline">): Baseline | undefined {
  const i = p.primaryBaseline;
  return i !== undefined && Number.isInteger(i) && i >= 0 && i < p.baselines.length ? p.baselines[i] : p.baselines.at(-1);
}

/** Escolhe a linha de base primária pela posição; `undefined` volta ao padrão (a mais recente). */
export function withPrimaryBaseline(p: WorkPlanning, index: number | undefined): WorkPlanning {
  if (index !== undefined && !(Number.isInteger(index) && index >= 0 && index < p.baselines.length)) throw new PmoError("Linha de base inexistente.");
  if (index === p.primaryBaseline) return p;
  const next: WorkPlanning = { ...p, rev: p.rev + 1 };
  if (index === undefined) delete next.primaryBaseline;
  else next.primaryBaseline = index;
  return next;
}

/** `patch` com valor `undefined` apaga o campo. */
export function withCost(p: WorkPlanning, activityId: string, patch: CostEntry): WorkPlanning {
  if (!safeKey(activityId)) throw new PmoError("Atividade inválida para custo.");
  const entry: CostEntry = { ...p.costs[activityId] };
  for (const k of COST_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === undefined) delete entry[k];
    else if (isMoney(v)) entry[k] = v;
    else throw new PmoError(`Valor inválido em ${k}: use um número maior ou igual a zero.`);
  }
  const costs = { ...p.costs };
  if (Object.keys(entry).length === 0) delete costs[activityId];
  else costs[activityId] = entry;
  return bump(p, { costs });
}

/**
 * Altera o cronograma de uma atividade. Campo com `undefined` volta ao padrão. Predecessoras que
 * criem ciclo só são detectadas ao montar o plano; valide com o motor antes de gravar.
 */
export function withActivityPlan(p: WorkPlanning, activityId: string, patch: ActivityPlan): WorkPlanning {
  if (!safeKey(activityId)) throw new PmoError("Atividade inválida.");
  const merged: Record<string, unknown> = { ...p.activityPlans[activityId] };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || (k === "group" && typeof v === "string" && v.trim() === "")) delete merged[k];
    else merged[k] = k === "group" ? String(v).trim() : v;
  }
  const clean = cleanActivityPlan(merged);
  if (clean === null) throw new PmoError("Dados do cronograma da atividade inválidos (duração, percentual, datas — o término real não pode ser antes do início real —, predecessoras ou grupo).");
  if ((clean.predecessors ?? []).some((q) => q.id === activityId)) throw new PmoError("Uma atividade não pode ser predecessora de si mesma.");
  for (const [k, val] of Object.entries(clean.codes ?? {})) {
    const t = p.codeTypes.find((x) => x.id === k);
    if (!t) throw new PmoError("Código de atividade de um tipo que não existe.");
    if (!t.values.includes(val)) throw new PmoError(`O valor "${val}" não existe no código "${t.name}".`);
  }
  if (JSON.stringify(clean) === JSON.stringify(p.activityPlans[activityId] ?? {})) return p;
  const activityPlans = { ...p.activityPlans };
  if (Object.keys(clean).length === 0) delete activityPlans[activityId];
  else activityPlans[activityId] = clean;
  return bump(p, { activityPlans });
}

/** Cria ou atualiza (pelo id) um contrato. */
export function withContract(p: WorkPlanning, contract: Contract): WorkPlanning {
  const clean = cleanContract(contract);
  if (clean === null) throw new PmoError("Contrato inválido: nome, valor maior ou igual a zero, situação e datas no formato AAAA-MM-DD.");
  const i = p.contracts.findIndex((k) => k.id === clean.id);
  if (i < 0 && p.contracts.length >= MAX_CONTRACTS) throw new PmoError(`No máximo ${MAX_CONTRACTS} contratos.`);
  if (i >= 0 && JSON.stringify(p.contracts[i]) === JSON.stringify(clean)) return p;
  return bump(p, { contracts: i < 0 ? [...p.contracts, clean] : p.contracts.map((k, j) => (j === i ? clean : k)) });
}

/** Remove o contrato e os pagamentos dele; recusa se alguma ordem de mudança o referencia. */
export function withoutContract(p: WorkPlanning, id: string): WorkPlanning {
  if (!p.contracts.some((k) => k.id === id)) return p;
  if (p.changes.some((c) => c.contractDeltas?.some((d) => d.contractId === id))) throw new PmoError("Há pedido de mudança ligado a este contrato; remova o ajuste antes.");
  return bump(p, { contracts: p.contracts.filter((k) => k.id !== id), payments: p.payments.filter((x) => x.contractId !== id) });
}

export function nextContractId(p: Pick<WorkPlanning, "contracts">): string {
  const max = p.contracts.reduce((m, k) => Math.max(m, Number(/^K-(\d+)$/.exec(k.id)?.[1] ?? 0)), 0);
  return `K-${max + 1}`;
}

/** Cria ou atualiza (pelo id) um pagamento. */
export function withPayment(p: WorkPlanning, payment: Payment): WorkPlanning {
  const clean = cleanPayment(payment);
  if (clean === null) throw new PmoError("Pagamento inválido: valor maior que zero, data AAAA-MM-DD e situação.");
  validatePayment(p.contracts, clean);
  const i = p.payments.findIndex((x) => x.id === clean.id);
  if (i < 0 && p.payments.length >= MAX_PAYMENTS) throw new PmoError(`No máximo ${MAX_PAYMENTS} pagamentos.`);
  if (i >= 0 && JSON.stringify(p.payments[i]) === JSON.stringify(clean)) return p;
  return bump(p, { payments: i < 0 ? [...p.payments, clean] : p.payments.map((x, j) => (j === i ? clean : x)) });
}

export function withoutPayment(p: WorkPlanning, id: string): WorkPlanning {
  if (!p.payments.some((x) => x.id === id)) return p;
  return bump(p, { payments: p.payments.filter((x) => x.id !== id) });
}

export function nextPaymentId(p: Pick<WorkPlanning, "payments">): string {
  const max = p.payments.reduce((m, x) => Math.max(m, Number(/^P-(\d+)$/.exec(x.id)?.[1] ?? 0)), 0);
  return `P-${max + 1}`;
}

/** Situação dos contratos, já com os ajustes das ordens de mudança aprovadas. */
export function contractsOf(p: Pick<WorkPlanning, "contracts" | "payments" | "changes">): ContractSummary[] {
  const approved = p.changes.filter((c) => c.status === "aprovada").flatMap((c) => c.contractDeltas ?? []);
  return summarizeContracts(p.contracts, p.payments, approved);
}

/** Define (ou remove, com `undefined`) a capacidade de um recurso, em pessoas por dia. */
export function withResourceCapacity(p: WorkPlanning, resource: string, capacity: number | undefined): WorkPlanning {
  const name = resource.trim();
  if (!safeKey(name) || name.length > 100) throw new PmoError("Nome de recurso inválido.");
  if (capacity !== undefined && !(isNum(capacity) && capacity > 0 && capacity <= 100)) throw new PmoError("A capacidade deve ser maior que zero e até 100.");
  if (p.resourceCapacity[name] === capacity) return p;
  const resourceCapacity = { ...p.resourceCapacity };
  if (capacity === undefined) delete resourceCapacity[name];
  else resourceCapacity[name] = capacity;
  return bump(p, { resourceCapacity });
}

/** Cria ou atualiza (pelo id) um tipo de código de atividade. Ao tirar um valor, os códigos que o usavam são limpos das atividades. */
export function withCodeType(p: WorkPlanning, type: ActivityCodeType): WorkPlanning {
  const clean = cleanCodeType(type);
  if (clean === null) throw new PmoError(`Tipo de código inválido: nome (até ${MAX_CODE_LENGTH} caracteres) e até ${MAX_CODE_VALUES} valores de até ${MAX_CODE_LENGTH} caracteres.`);
  const i = p.codeTypes.findIndex((t) => t.id === clean.id);
  if (i < 0 && p.codeTypes.length >= MAX_CODE_TYPES) throw new PmoError(`No máximo ${MAX_CODE_TYPES} tipos de código.`);
  if (i >= 0 && JSON.stringify(p.codeTypes[i]) === JSON.stringify(clean)) return p;
  const codeTypes = i < 0 ? [...p.codeTypes, clean] : p.codeTypes.map((t, j) => (j === i ? clean : t));
  return bump({ ...p, activityPlans: pruneCodes(p.activityPlans, (k, val) => k !== clean.id || clean.values.includes(val)) }, { codeTypes });
}

export function withoutCodeType(p: WorkPlanning, id: string): WorkPlanning {
  if (!p.codeTypes.some((t) => t.id === id)) return p;
  return bump({ ...p, activityPlans: pruneCodes(p.activityPlans, (k) => k !== id) }, { codeTypes: p.codeTypes.filter((t) => t.id !== id) });
}

function pruneCodes(plans: Record<string, ActivityPlan>, keep: (typeId: string, value: string) => boolean): Record<string, ActivityPlan> {
  const out: Record<string, ActivityPlan> = {};
  for (const [id, ap] of Object.entries(plans)) {
    if (!ap.codes) {
      out[id] = ap;
      continue;
    }
    const codes = Object.fromEntries(Object.entries(ap.codes).filter(([k, v]) => keep(k, v)));
    const { codes: _old, ...rest } = ap;
    const next: ActivityPlan = Object.keys(codes).length > 0 ? { ...rest, codes } : rest;
    if (Object.keys(next).length > 0) out[id] = next;
  }
  return out;
}

/** Próximo id livre no formato T-1, T-2… */
export function nextCodeTypeId(p: Pick<WorkPlanning, "codeTypes">): string {
  const max = p.codeTypes.reduce((m, t) => Math.max(m, Number(/^T-(\d+)$/.exec(t.id)?.[1] ?? 0)), 0);
  return `T-${max + 1}`;
}

/** Atribuições efetivas de uma atividade: as do planejamento ou, sem elas, o responsável do cadastro (1 unidade). */
export function effectiveAssignments(plan: ActivityPlan | undefined, owner: string | undefined): ResourceAssignmentPlan[] {
  if (plan?.assignments && plan.assignments.length > 0) return plan.assignments;
  const o = owner?.trim();
  return o ? [{ resource: o, units: 1 }] : [];
}

/** Agrupa ids de atividade pelo valor do código `typeId` ("" = sem valor). */
export function groupByCode(ids: readonly string[], plans: Readonly<Record<string, ActivityPlan>>, typeId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of ids) {
    const v = (Object.hasOwn(plans, id) ? plans[id]?.codes?.[typeId] : undefined) ?? "";
    out.set(v, [...(out.get(v) ?? []), id]);
  }
  return out;
}

export interface GlobalChange {
  /** Soma de dias úteis à duração de cada atividade (pode ser negativa; mínimo final 0). */
  durationDelta?: number;
  /** Multiplica a duração (0,1 a 10), arredondando; aplicado antes do delta. */
  durationFactor?: number;
  /** Define o código (grupo). */
  group?: string;
  /** Define o valor de um código de atividade definido pelo usuário. */
  code?: { typeId: string; value: string };
  /** "Terminar até" desloca em dias corridos as datas já definidas (ignora atividades sem prazo). */
  deadlineShiftDays?: number;
  /** Define "Não iniciar antes de". */
  notBefore?: string;
  /** Define o prazo "Terminar até". */
  deadline?: string;
}

/** Mudança global (como no Primavera): aplica uma operação a várias atividades de uma vez, tudo ou nada. */
export function applyGlobalChange(p: WorkPlanning, targets: readonly { id: string; duration: number }[], change: GlobalChange): WorkPlanning {
  if (targets.length === 0) throw new PmoError("Escolha ao menos uma atividade.");
  if (change.durationFactor !== undefined && !(isNum(change.durationFactor) && change.durationFactor >= 0.1 && change.durationFactor <= 10)) throw new PmoError("O fator de duração deve ficar entre 0,1 e 10.");
  if (change.durationDelta !== undefined && !Number.isInteger(change.durationDelta)) throw new PmoError("O ajuste de duração deve ser inteiro.");
  if (change.deadlineShiftDays !== undefined && !Number.isInteger(change.deadlineShiftDays)) throw new PmoError("O deslocamento de prazo deve ser inteiro (dias corridos).");
  if (Object.values(change).every((v) => v === undefined)) throw new PmoError("Informe ao menos uma alteração.");
  let next = p;
  for (const t of targets) {
    const patch: ActivityPlan = {};
    if (change.durationFactor !== undefined || change.durationDelta !== undefined) {
      const base = next.activityPlans[t.id]?.durationDays ?? t.duration;
      patch.durationDays = Math.max(0, Math.round(base * (change.durationFactor ?? 1)) + (change.durationDelta ?? 0));
    }
    if (change.group !== undefined) patch.group = change.group;
    if (change.notBefore !== undefined) patch.notBefore = change.notBefore;
    if (change.deadline !== undefined) patch.deadline = change.deadline;
    const curDeadline = next.activityPlans[t.id]?.deadline;
    if (change.deadlineShiftDays !== undefined && curDeadline !== undefined) patch.deadline = addDaysIso(curDeadline, change.deadlineShiftDays);
    if (change.code) patch.codes = { ...(next.activityPlans[t.id]?.codes ?? {}), [change.code.typeId]: change.code.value };
    next = withActivityPlan(next, t.id, patch);
  }
  return next;
}

/** Cria ou atualiza (pelo id) um risco. */
export function withRisk(p: WorkPlanning, risk: Risk): WorkPlanning {
  const clean = cleanRisk(risk);
  if (clean === null) throw new PmoError("Risco inválido: informe título, probabilidade e impacto de 1 a 5 e um status válido.");
  const i = p.risks.findIndex((r) => r.id === clean.id);
  if (i < 0 && p.risks.length >= MAX_RISKS) throw new PmoError(`No máximo ${MAX_RISKS} riscos.`);
  if (i >= 0 && JSON.stringify(p.risks[i]) === JSON.stringify(clean)) return p;
  const risks = i < 0 ? [...p.risks, clean] : p.risks.map((r, j) => (j === i ? clean : r));
  return bump(p, { risks });
}

export function withoutRisk(p: WorkPlanning, id: string): WorkPlanning {
  if (!p.risks.some((r) => r.id === id)) return p;
  return bump(p, { risks: p.risks.filter((r) => r.id !== id) });
}

/** Próximo id sequencial (R-001, R-002…). */
export function nextRiskId(p: Pick<WorkPlanning, "risks">): string {
  const max = p.risks.reduce((m, r) => Math.max(m, Number(/^R-(\d+)$/.exec(r.id)?.[1] ?? 0)), 0);
  return `R-${String(max + 1).padStart(3, "0")}`;
}

/** Exposição = probabilidade × impacto (1..25). */
export const riskScore = (r: Pick<Risk, "probability" | "impact">): number => r.probability * r.impact;

export type RiskLevel = "baixo" | "medio" | "alto" | "critico";
export function riskLevel(score: number): RiskLevel {
  return score >= 15 ? "critico" : score >= 10 ? "alto" : score >= 5 ? "medio" : "baixo";
}

/** Matriz 5×5 (linha = impacto 5→1, coluna = probabilidade 1→5) com os riscos ainda ativos (não encerrados). */
export function riskMatrix(risks: readonly Risk[]): { probability: number; impact: number; level: RiskLevel; ids: string[] }[] {
  const cells: { probability: number; impact: number; level: RiskLevel; ids: string[] }[] = [];
  for (let impact = 5; impact >= 1; impact--) {
    for (let probability = 1; probability <= 5; probability++) {
      cells.push({
        probability,
        impact,
        level: riskLevel(probability * impact),
        ids: risks.filter((r) => r.status !== "encerrado" && r.probability === probability && r.impact === impact).map((r) => r.id),
      });
    }
  }
  return cells;
}

/** Define (ou remove, com `undefined`) a diária de um responsável. */
export function withResourceRate(p: WorkPlanning, resource: string, rate: number | undefined): WorkPlanning {
  const name = resource.trim();
  if (!safeKey(name) || name.length > 100) throw new PmoError("Nome de responsável inválido.");
  if (rate !== undefined && !isMoney(rate)) throw new PmoError("A diária deve ser um valor maior ou igual a zero.");
  if (p.resourceRates[name] === rate) return p;
  const resourceRates = { ...p.resourceRates };
  if (rate === undefined) delete resourceRates[name];
  else resourceRates[name] = rate;
  return bump(p, { resourceRates });
}

/** Grava o estado do licenciamento (valida; sem mudança devolve o mesmo objeto). */
export function withLicensing(p: WorkPlanning, state: LicensingState): WorkPlanning {
  const clean = cleanLicensing(state);
  if (clean === null) throw new PmoError("Dados de licenciamento inválidos (datas, textos longos demais ou campos fora do formato).");
  if (JSON.stringify(clean) === JSON.stringify(p.licensing ?? EMPTY_LICENSING)) return p;
  return bump(p, { licensing: clean });
}

/** Cria ou atualiza (pelo id) um processo de licenciamento adicional. */
export function withLicenseProcess(p: WorkPlanning, proc: LicenseProcess): WorkPlanning {
  const clean = cleanLicenseProcess(proc);
  if (clean === null) throw new PmoError("Processo de licenciamento inválido: informe um nome (até 80 caracteres) e dados no formato correto.");
  const i = p.licenses.findIndex((l) => l.id === clean.id);
  if (i < 0 && p.licenses.length >= MAX_LICENSE_PROCESSES) throw new PmoError(`No máximo ${MAX_LICENSE_PROCESSES} processos adicionais.`);
  if (i >= 0 && JSON.stringify(p.licenses[i]) === JSON.stringify(clean)) return p;
  return bump(p, { licenses: i < 0 ? [...p.licenses, clean] : p.licenses.map((l, j) => (j === i ? clean : l)) });
}

export function withoutLicenseProcess(p: WorkPlanning, id: string): WorkPlanning {
  if (!p.licenses.some((l) => l.id === id)) return p;
  return bump(p, { licenses: p.licenses.filter((l) => l.id !== id) });
}

/** Próximo id livre no formato L-1, L-2… */
export function nextLicenseId(p: Pick<WorkPlanning, "licenses">): string {
  const max = p.licenses.reduce((m, l) => Math.max(m, Number(/^L-(\d+)$/.exec(l.id)?.[1] ?? 0)), 0);
  return `L-${max + 1}`;
}

/** Resumo dos processos do projeto (o principal conta só se tiver sido preenchido): total, iniciados e com certidão emitida. */
export function licensingSummary(p: Pick<WorkPlanning, "licensing" | "licenses">): { total: number; started: number; issued: number } {
  const all: LicensingState[] = [...(p.licensing && JSON.stringify(p.licensing) !== JSON.stringify(EMPTY_LICENSING) ? [p.licensing] : []), ...p.licenses];
  return { total: all.length, started: all.filter((l) => l.start !== "").length, issued: all.filter((l) => l.issuedOn !== "").length };
}

export const EMPTY_TAX: TaxState = Object.freeze({ engineeringShare: 1, purchases: [] }) as TaxState;

/** Grava o estado de CBS (valida; sem mudança devolve o mesmo objeto). */
export function withTax(p: WorkPlanning, state: TaxState): WorkPlanning {
  const clean = cleanTax(state);
  if (clean === null) throw new PmoError("Dados de CBS inválidos: fatia entre 0 e 1, categoria conhecida, CBS maior ou igual a zero e ids únicos.");
  if (JSON.stringify(clean) === JSON.stringify(p.tax ?? EMPTY_TAX)) return p;
  return bump(p, { tax: clean });
}

/** Próximo id sequencial de nota de compra (NF-001…). */
export function nextPurchaseId(state: Pick<TaxState, "purchases">): string {
  const max = state.purchases.reduce((m, x) => Math.max(m, Number(/^NF-(\d+)$/.exec(x.id)?.[1] ?? 0)), 0);
  return `NF-${String(max + 1).padStart(3, "0")}`;
}

/** Apuração de CBS da obra: faturamento = orçamento dividido em engenharia/software, menos o crédito das compras. */
export function assessWorkCbs(budget: number, state: TaxState = EMPTY_TAX): { assessment: CbsAssessment; blendedRate: number } {
  const split = splitInvoice(budget, state.engineeringShare);
  const assessment = assessCbs(
    split.lines.map((l) => ({ description: l.description, kind: l.kind, amount: l.base })),
    state.purchases,
  );
  return { assessment, blendedRate: split.blendedRate };
}

/** Cria ou atualiza (pelo id) um cenário "e se". */
/** Cria ou atualiza (pelo id) uma questão. */
export function withIssue(p: WorkPlanning, issue: Issue): WorkPlanning {
  const clean = cleanIssue(issue);
  if (!clean) throw new PmoError("Questão inválida: título, situação, prioridade (1 a 3) e prazo no formato AAAA-MM-DD.");
  const i = p.issues.findIndex((q) => q.id === clean.id);
  if (i < 0 && p.issues.length >= MAX_ISSUES) throw new PmoError(`No máximo ${MAX_ISSUES} questões.`);
  if (i >= 0 && JSON.stringify(p.issues[i]) === JSON.stringify(clean)) return p;
  return bump(p, { issues: i < 0 ? [...p.issues, clean] : p.issues.map((q, j) => (j === i ? clean : q)) });
}

export function withoutIssue(p: WorkPlanning, id: string): WorkPlanning {
  if (!p.issues.some((q) => q.id === id)) return p;
  return bump(p, { issues: p.issues.filter((q) => q.id !== id) });
}

/** Próximo id livre no formato Q-1, Q-2… */
export function nextIssueId(p: Pick<WorkPlanning, "issues">): string {
  const max = p.issues.reduce((m, q) => Math.max(m, Number(/^Q-(\d+)$/.exec(q.id)?.[1] ?? 0)), 0);
  return `Q-${max + 1}`;
}

/** Questões ainda não resolvidas cujo prazo já passou em `today` (YYYY-MM-DD). */
export function overdueIssues(issues: readonly Issue[], today: string): Issue[] {
  return issues.filter((q) => q.status !== "resolvida" && q.dueDate !== undefined && q.dueDate < today);
}

/** Define (ou limpa, com texto vazio) o programa do projeto. */
export function withProgram(p: WorkPlanning, program: string | undefined): WorkPlanning {
  const clean = program === undefined ? undefined : optText(program, MAX_PROGRAM_LENGTH);
  if (clean === null) throw new PmoError(`Programa: no máximo ${MAX_PROGRAM_LENGTH} caracteres.`);
  if (clean === p.program) return p;
  const { program: _old, ...rest } = p;
  return bump(clean ? { ...rest, program: clean } as WorkPlanning : rest as WorkPlanning, {});
}

/** Grava o impacto socioambiental do projeto. */
export function withImpact(p: WorkPlanning, state: ImpactState): WorkPlanning {
  const clean = cleanImpact(state);
  if (clean === null) throw new PmoError("Impacto inválido: notas de 0 a 5 em cada dimensão e valores numéricos não negativos.");
  if (JSON.stringify(clean) === JSON.stringify(p.impact)) return p;
  return bump(p, { impact: clean });
}

export function withScenario(p: WorkPlanning, sc: Scenario): WorkPlanning {
  validateScenario(sc);
  if (!safeKey(sc.id)) throw new PmoError("Id de cenário inválido.");
  const clean: Scenario = { id: sc.id, name: sc.name.trim(), ...(sc.costFactor !== undefined ? { costFactor: sc.costFactor } : {}), changes: sc.changes.map((c) => ({ ...c })) };
  const i = p.scenarios.findIndex((x) => x.id === clean.id);
  if (i < 0 && p.scenarios.length >= MAX_SCENARIOS) throw new PmoError(`No máximo ${MAX_SCENARIOS} cenários.`);
  if (i >= 0 && JSON.stringify(p.scenarios[i]) === JSON.stringify(clean)) return p;
  return bump(p, { scenarios: i < 0 ? [...p.scenarios, clean] : p.scenarios.map((x, j) => (j === i ? clean : x)) });
}

export function withoutScenario(p: WorkPlanning, id: string): WorkPlanning {
  return p.scenarios.some((x) => x.id === id) ? bump(p, { scenarios: p.scenarios.filter((x) => x.id !== id) }) : p;
}

/** Próximo id sequencial de cenário (CEN-001…). */
export function nextScenarioId(p: Pick<WorkPlanning, "scenarios">): string {
  const max = p.scenarios.reduce((m, x) => Math.max(m, Number(/^CEN-(\d+)$/.exec(x.id)?.[1] ?? 0)), 0);
  return `CEN-${String(max + 1).padStart(3, "0")}`;
}

/** Substitui a lista de feriados (datas YYYY-MM-DD). */
export function withHolidays(p: WorkPlanning, holidays: readonly string[]): WorkPlanning {
  if (holidays.length > MAX_HOLIDAYS) throw new PmoError(`No máximo ${MAX_HOLIDAYS} feriados.`);
  for (const h of holidays) if (!validDate(h)) throw new PmoError(`Feriado inválido (use YYYY-MM-DD): ${String(h)}`);
  return bump(p, { holidays: [...new Set(holidays)].sort() });
}

/** Calendário da obra: segunda a sexta, menos os feriados cadastrados. */
export function calendarOf(p: Pick<WorkPlanning, "holidays"> | undefined): WorkCalendar {
  return { workWeekdays: DEFAULT_CALENDAR.workWeekdays, holidays: p?.holidays ?? [] };
}

/** Aplica os cronogramas por atividade sobre as atividades do cadastro (sem alterar a entrada). */
export function mergeActivityPlans<T extends { id: string }>(
  activities: readonly T[],
  plans: Readonly<Record<string, ActivityPlan>> | undefined,
): (T & ActivityPlan)[] {
  return activities.map((a) => {
    const ap = plans && Object.hasOwn(plans, a.id) ? plans[a.id] : undefined;
    if (!ap) return { ...a };
    const merged = { ...a, ...ap };
    // Passos definem o avanço quando não há % nem término real informados.
    const sp = stepsPercent(ap.steps);
    if (sp !== null && ap.percentComplete === undefined && ap.actualFinish === undefined) merged.percentComplete = sp;
    return merged;
  });
}

export function withChange(p: WorkPlanning, cr: ChangeRequest): WorkPlanning {
  if (cleanChange(cr) === null) throw new PmoError("Pedido de mudança inválido.");
  if (cr.status !== "rascunho") throw new PmoError("Todo pedido novo começa como rascunho.");
  if (p.changes.some((c) => c.id === cr.id)) throw new PmoError(`Pedido de mudança duplicado: ${cr.id}`);
  return bump(p, { changes: [...p.changes, cr] });
}

export function withChangeStatus(p: WorkPlanning, changeId: string, to: ChangeStatus): WorkPlanning {
  const cr = p.changes.find((c) => c.id === changeId);
  if (!cr) throw new PmoError(`Pedido de mudança não encontrado: ${changeId}`);
  const next = transitionChange(cr, to);
  return bump(p, { changes: p.changes.map((c) => (c.id === changeId ? next : c)) });
}

/** Próximo id sequencial de pedido (CR-001, CR-002…), mesmo após pedidos removidos ou importados. */
export function nextChangeId(p: Pick<WorkPlanning, "changes">): string {
  const max = p.changes.reduce((m, c) => {
    const n = /^CR-(\d+)$/.exec(c.id);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `CR-${String(max + 1).padStart(3, "0")}`;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keysChanged = <T>(a: Record<string, T>, b: Record<string, T>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !sameJson(a[k], b[k])).sort();

/** Descreve em português o que mudou entre dois planejamentos (uma frase por área alterada). */
export function describePlanningChange(prev: WorkPlanning, next: WorkPlanning): string[] {
  const out: string[] = [];
  const ap = keysChanged(prev.activityPlans, next.activityPlans);
  if (ap.length) out.push(`Cronograma alterado em ${ap.length} atividade(s): ${ap.slice(0, 5).join(", ")}${ap.length > 5 ? "…" : ""}`);
  if (!sameJson(prev.holidays, next.holidays)) out.push(`Feriados: ${prev.holidays.length} → ${next.holidays.length}`);
  if (next.baselines.length > prev.baselines.length) out.push(`Linha de base criada: ${next.baselines.at(-1)?.name ?? ""}`);
  else if (!sameJson(prev.baselines, next.baselines)) out.push("Linhas de base alteradas");
  if (prev.primaryBaseline !== next.primaryBaseline) out.push(next.primaryBaseline === undefined ? "Linha de base primária: a mais recente" : `Linha de base primária: ${next.baselines[next.primaryBaseline]?.name ?? ""}`);
  for (const sc of next.scenarios) if (!prev.scenarios.some((x) => x.id === sc.id)) out.push(`Cenário ${sc.id} criado: ${sc.name}`);
  for (const sc of prev.scenarios) if (!next.scenarios.some((x) => x.id === sc.id)) out.push(`Cenário ${sc.id} removido`);
  if (!sameJson(prev.impact, next.impact)) out.push("Impacto socioambiental atualizado");
  if (!sameJson(prev.tax, next.tax)) out.push("CBS da obra atualizada");
  if (!sameJson(prev.licensing, next.licensing)) out.push("Licenciamento GRAPROHAB atualizado");
  for (const l of next.licenses) {
    const old = prev.licenses.find((x) => x.id === l.id);
    if (!old) out.push(`Processo de licenciamento ${l.id} criado: ${l.name}`);
    else if (!sameJson(old, l)) out.push(`Processo de licenciamento ${l.id} atualizado: ${l.name}`);
  }
  for (const l of prev.licenses) if (!next.licenses.some((x) => x.id === l.id)) out.push(`Processo de licenciamento ${l.id} removido`);
  if (!sameJson(prev.resourceRates, next.resourceRates)) out.push("Diárias de recursos alteradas");
  for (const k of next.contracts) {
    const old = prev.contracts.find((x) => x.id === k.id);
    if (!old) out.push(`Contrato ${k.id} criado: ${k.name}`);
    else if (!sameJson(old, k)) out.push(`Contrato ${k.id} atualizado: ${k.name}`);
  }
  for (const k of prev.contracts) if (!next.contracts.some((x) => x.id === k.id)) out.push(`Contrato ${k.id} removido`);
  for (const x of next.payments) {
    const old = prev.payments.find((y) => y.id === x.id);
    if (!old) out.push(`Pagamento ${x.id} registrado (${x.contractId}, ${x.status})`);
    else if (!sameJson(old, x)) out.push(`Pagamento ${x.id} atualizado${old.status !== x.status ? ` (${old.status} → ${x.status})` : ""}`);
  }
  for (const x of prev.payments) if (!next.payments.some((y) => y.id === x.id) && next.contracts.some((k) => k.id === x.contractId)) out.push(`Pagamento ${x.id} removido`);
  if (!sameJson(prev.resourceCapacity, next.resourceCapacity)) out.push("Capacidade de recursos alterada");
  for (const t of next.codeTypes) {
    const old = prev.codeTypes.find((x) => x.id === t.id);
    if (!old) out.push(`Código de atividade criado: ${t.name}`);
    else if (!sameJson(old, t)) out.push(`Código de atividade atualizado: ${t.name}`);
  }
  for (const t of prev.codeTypes) if (!next.codeTypes.some((x) => x.id === t.id)) out.push(`Código de atividade removido: ${t.name}`);
  const cost = keysChanged(prev.costs, next.costs);
  if (cost.length) out.push(`Custos alterados em ${cost.length} atividade(s)`);
  for (const c of next.changes) {
    const old = prev.changes.find((x) => x.id === c.id);
    if (!old) out.push(`Pedido de mudança ${c.id} criado`);
    else if (old.status !== c.status) out.push(`Pedido de mudança ${c.id}: ${old.status} → ${c.status}`);
  }
  for (const r of next.risks) {
    const old = prev.risks.find((x) => x.id === r.id);
    if (!old) out.push(`Risco ${r.id} registrado`);
    else if (!sameJson(old, r)) out.push(`Risco ${r.id} atualizado${old.status !== r.status ? ` (${old.status} → ${r.status})` : ""}`);
  }
  for (const r of prev.risks) if (!next.risks.some((x) => x.id === r.id)) out.push(`Risco ${r.id} removido`);
  for (const q of next.issues) {
    const old = prev.issues.find((x) => x.id === q.id);
    if (!old) out.push(`Questão ${q.id} registrada`);
    else if (!sameJson(old, q)) out.push(`Questão ${q.id} atualizada${old.status !== q.status ? ` (${old.status} → ${q.status})` : ""}`);
  }
  for (const q of prev.issues) if (!next.issues.some((x) => x.id === q.id)) out.push(`Questão ${q.id} removida`);
  if (prev.program !== next.program) out.push(next.program ? `Programa: ${next.program}` : "Programa removido");
  return out;
}

/** Acrescenta ao histórico uma linha por mudança detectada; sem mudança, devolve `next` intacto. */
export function recordHistory(prev: WorkPlanning, next: WorkPlanning, by: string, at: string): WorkPlanning {
  const lines = describePlanningChange(prev, next);
  if (lines.length === 0) return next;
  const who = by.trim().slice(0, 100) || "Desconhecido";
  const added = lines.map((summary) => ({ at, by: who, summary: summary.slice(0, 500) }));
  return { ...next, history: [...next.history, ...added].slice(-MAX_HISTORY) };
}

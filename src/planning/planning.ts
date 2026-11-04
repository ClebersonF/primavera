import type { Baseline } from "../baseline/baseline";
import { transitionChange, type ChangeRequest, type ChangeStatus } from "../changes/changeRequest";
import { DEFAULT_CALENDAR, type WorkCalendar } from "../cpm/calendar";
import { LINK_TYPES, type LinkType } from "../cpm/types";
import { parseIsoDate } from "../dates";
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
  /** Data real de início (YYYY-MM-DD). */
  actualStart?: string;
  /** Data real de término (YYYY-MM-DD, inclusive); implica 100% concluído se o % não for informado. */
  actualFinish?: string;
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
  /** CBS da obra (ausente até ser preenchido). */
  tax?: TaxState;
  /** Impacto socioambiental do projeto (ausente até ser preenchido). */
  impact?: ImpactState;
  /** Cenários "e se" salvos (não alteram o plano). */
  scenarios: Scenario[];
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
  if (dur === null || cost === null) return null;
  const cr: ChangeRequest = { id: v.id, title: v.title, status: v.status as ChangeStatus };
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
  return out;
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
  const result: WorkPlanning = { rev, baselines, costs, changes, activityPlans, holidays: cleanHolidays(raw.holidays), risks, history: history.slice(-MAX_HISTORY), resourceRates, scenarios: [] };
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
  if (JSON.stringify(clean) === JSON.stringify(p.activityPlans[activityId] ?? {})) return p;
  const activityPlans = { ...p.activityPlans };
  if (Object.keys(clean).length === 0) delete activityPlans[activityId];
  else activityPlans[activityId] = clean;
  return bump(p, { activityPlans });
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
    return ap ? { ...a, ...ap } : { ...a };
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
  if (!sameJson(prev.resourceRates, next.resourceRates)) out.push("Diárias de recursos alteradas");
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

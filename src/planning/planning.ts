import type { Baseline } from "../baseline/baseline";
import { transitionChange, type ChangeRequest, type ChangeStatus } from "../changes/changeRequest";
import { DEFAULT_CALENDAR, type WorkCalendar } from "../cpm/calendar";
import { LINK_TYPES, type LinkType } from "../cpm/types";
import { parseIsoDate } from "../dates";
import { PmoError } from "../errors";

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
  /** Código de atividade (grupo), texto livre até 40 caracteres. */
  group?: string;
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

/**
 * Dados de planejamento de uma obra que o cadastro não tinha: linhas de base, custos e pedidos de
 * mudança. Vão dentro da própria obra (mesmo registro do Odoo). `rev` conta as gravações, para
 * detectar edição concorrente.
 */
export interface WorkPlanning {
  rev: number;
  baselines: Baseline[];
  /** Custos por id de atividade. */
  costs: Record<string, CostEntry>;
  changes: ChangeRequest[];
  /** Cronograma por atividade (id da atividade). */
  activityPlans: Record<string, ActivityPlan>;
  /** Feriados da obra (YYYY-MM-DD), além de sábados e domingos. */
  holidays: string[];
  /** Registro de riscos da obra. */
  risks: Risk[];
}

export const EMPTY_PLANNING: WorkPlanning = Object.freeze({
  rev: 0,
  baselines: [],
  costs: {},
  changes: [],
  activityPlans: {},
  holidays: [],
  risks: [],
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
  return { rev, baselines, costs, changes, activityPlans, holidays: cleanHolidays(raw.holidays), risks };
}

const bump = (p: WorkPlanning, patch: Partial<WorkPlanning>): WorkPlanning => ({ ...p, ...patch, rev: p.rev + 1 });

export function withBaseline(p: WorkPlanning, baseline: Baseline): WorkPlanning {
  if (cleanBaseline(baseline) === null) throw new PmoError("Baseline inválida.");
  if (p.baselines.length >= MAX_BASELINES) throw new PmoError(`Limite de ${MAX_BASELINES} baselines por obra.`);
  return bump(p, { baselines: [...p.baselines, baseline] });
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
  if (clean === null) throw new PmoError("Dados do cronograma da atividade inválidos (duração, percentual, data, predecessoras ou grupo).");
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

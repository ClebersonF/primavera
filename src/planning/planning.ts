import type { Baseline } from "../baseline/baseline";
import { transitionChange, type ChangeRequest, type ChangeStatus } from "../changes/changeRequest";
import { PmoError } from "../errors";

export interface CostEntry {
  committed?: number;
  actual?: number;
  etc?: number;
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
}

export const EMPTY_PLANNING: WorkPlanning = Object.freeze({ rev: 0, baselines: [], costs: {}, changes: [] }) as WorkPlanning;
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
  const rev = Number.isInteger(raw.rev) && (raw.rev as number) >= 0 ? (raw.rev as number) : 0;
  return { rev, baselines, costs, changes };
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

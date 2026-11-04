import { PmoError } from "../errors";
import { fromCents, toCents } from "../money";
import { planWbs, type WbsNodeInput } from "../wbs/wbs";

export type ChangeStatus = "rascunho" | "em_aprovacao" | "aprovada" | "rejeitada";

export interface ChangeRequest {
  id: string;
  title: string;
  status: ChangeStatus;
  /** Ajustes de duração (dias úteis, pode ser negativo) por atividade-folha. */
  durationDeltas?: { activityId: string; delta: number }[];
  /** Ajustes de custo (BRL, pode ser negativo) por atividade-folha. */
  costDeltas?: { activityId: string; delta: number }[];
}

const TRANSITIONS: Record<ChangeStatus, ChangeStatus[]> = {
  rascunho: ["em_aprovacao"],
  em_aprovacao: ["aprovada", "rejeitada", "rascunho"],
  aprovada: [],
  rejeitada: ["rascunho"],
};

/** Move o pedido de mudança para outro estado, respeitando o fluxo de aprovação. */
export function transitionChange(cr: ChangeRequest, to: ChangeStatus): ChangeRequest {
  if (!Object.hasOwn(TRANSITIONS, cr.status)) throw new PmoError(`Status desconhecido no pedido ${cr.id}: ${String(cr.status)}`);
  if (!TRANSITIONS[cr.status].includes(to)) {
    throw new PmoError(`Transição inválida do pedido ${cr.id}: ${cr.status} → ${to}`);
  }
  return { ...cr, status: to };
}

export interface ChangeImpact {
  durationBefore: number;
  durationAfter: number;
  /** Positivo = atraso. */
  durationDelta: number;
  costBefore: number;
  costAfter: number;
  costDelta: number;
  criticalPathBefore: string[];
  criticalPathAfter: string[];
  /** Atividades que passam a ser críticas por causa da mudança. */
  newlyCritical: string[];
}

/** Aplica os ajustes às atividades-folha, sem mudar o status. */
function withDeltas(inputs: readonly WbsNodeInput[], cr: ChangeRequest): WbsNodeInput[] {
  const dur = new Map<string, number>();
  const cost = new Map<string, number>();
  const leafIds = new Set<string>();
  const parents = new Set(inputs.map((n) => n.parentId).filter((p): p is string => p !== null));
  for (const n of inputs) if (!parents.has(n.id)) leafIds.add(n.id);

  const collect = (target: Map<string, number>, list: { activityId: string; delta: number }[] | undefined, what: string) => {
    for (const d of list ?? []) {
      if (!leafIds.has(d.activityId)) {
        throw new PmoError(`Pedido ${cr.id}: ${what} aponta para atividade inexistente ou resumo: ${d.activityId}`);
      }
      if (!Number.isFinite(d.delta)) throw new PmoError(`Pedido ${cr.id}: ${what} inválido em ${d.activityId}`);
      target.set(d.activityId, (target.get(d.activityId) ?? 0) + d.delta);
    }
  };
  collect(dur, cr.durationDeltas, "ajuste de duração");
  collect(cost, cr.costDeltas, "ajuste de custo");

  return inputs.map((n) => {
    if (!leafIds.has(n.id)) return { ...n };
    const next = { ...n };
    const dd = dur.get(n.id);
    if (dd !== undefined) {
      if (!Number.isInteger(dd)) throw new PmoError(`Pedido ${cr.id}: ajuste de duração deve ser inteiro (${n.id})`);
      const d = (n.duration ?? 0) + dd;
      if (d < 0) throw new PmoError(`Pedido ${cr.id}: a duração de ${n.id} ficaria negativa (${d})`);
      next.duration = d;
    }
    const cd = cost.get(n.id);
    if (cd !== undefined) {
      const c = toCents(n.plannedCost ?? 0) + toCents(cd);
      if (c < 0) throw new PmoError(`Pedido ${cr.id}: o custo de ${n.id} ficaria negativo`);
      next.plannedCost = fromCents(c);
    }
    return next;
  });
}

/** Mostra o impacto em prazo, custo e caminho crítico antes da decisão (qualquer status). */
export function assessChange(inputs: readonly WbsNodeInput[], cr: ChangeRequest): ChangeImpact {
  const before = planWbs(inputs);
  const after = planWbs(withDeltas(inputs, cr));
  const wasCritical = new Set(before.cpm.criticalPath);
  return {
    durationBefore: before.projectDuration,
    durationAfter: after.projectDuration,
    durationDelta: after.projectDuration - before.projectDuration,
    costBefore: before.totalPlannedCost,
    costAfter: after.totalPlannedCost,
    costDelta: fromCents(toCents(after.totalPlannedCost) - toCents(before.totalPlannedCost)),
    criticalPathBefore: before.cpm.criticalPath,
    criticalPathAfter: after.cpm.criticalPath,
    newlyCritical: after.cpm.criticalPath.filter((id) => !wasCritical.has(id)),
  };
}

/** Devolve a EAP com a mudança aprovada incorporada. Só aceita pedidos com status "aprovada". */
export function applyApprovedChange(inputs: readonly WbsNodeInput[], cr: ChangeRequest): WbsNodeInput[] {
  if (cr.status !== "aprovada") {
    throw new PmoError(`O pedido ${cr.id} não está aprovado (status: ${cr.status})`);
  }
  return withDeltas(inputs, cr);
}

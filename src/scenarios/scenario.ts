import { PmoError } from "../errors";
import { fromCents, toCents } from "../money";
import { planWbs, type WbsNodeInput } from "../wbs/wbs";

export const MAX_SCENARIOS = 20;
export const MAX_SCENARIO_CHANGES = 100;

/** Alteração hipotética em uma atividade. Campos ausentes = sem alteração. */
export interface ScenarioChange {
  activityId: string;
  /** Dias úteis a somar à duração (pode ser negativo). */
  durationDelta?: number;
  /** Dias úteis de atraso no início (≥ 0). */
  delayDays?: number;
  /** Multiplicador do custo da atividade (> 0; 1,1 = +10%). */
  costFactor?: number;
}

/** Cenário "e se": nunca altera o plano real, só é comparado com ele. */
export interface Scenario {
  id: string;
  name: string;
  /** Multiplicador do custo de todas as atividades (> 0), aplicado junto com o de cada atividade. */
  costFactor?: number;
  changes: ScenarioChange[];
}

const okFactor = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 10;

/** Valida a estrutura de um cenário (sem olhar a EAP); lança PmoError. */
export function validateScenario(sc: Scenario): void {
  if (typeof sc.id !== "string" || sc.id === "") throw new PmoError("Cenário sem id.");
  if (typeof sc.name !== "string" || sc.name.trim() === "" || sc.name.length > 100) throw new PmoError("O cenário precisa de um nome (até 100 caracteres).");
  if (sc.costFactor !== undefined && !okFactor(sc.costFactor)) throw new PmoError("O fator de custo deve ser maior que 0 e no máximo 10.");
  if (!Array.isArray(sc.changes) || sc.changes.length > MAX_SCENARIO_CHANGES) throw new PmoError(`No máximo ${MAX_SCENARIO_CHANGES} alterações por cenário.`);
  const seen = new Set<string>();
  for (const c of sc.changes) {
    if (typeof c.activityId !== "string" || c.activityId === "") throw new PmoError("Alteração sem atividade.");
    if (seen.has(c.activityId)) throw new PmoError(`Atividade repetida no cenário: ${c.activityId}.`);
    seen.add(c.activityId);
    if (c.durationDelta !== undefined && !(Number.isInteger(c.durationDelta) && Math.abs(c.durationDelta) <= 3650)) throw new PmoError("A variação de duração deve ser um inteiro de dias úteis.");
    if (c.delayDays !== undefined && !(Number.isInteger(c.delayDays) && c.delayDays >= 0 && c.delayDays <= 3650)) throw new PmoError("O atraso deve ser um inteiro de dias úteis, zero ou mais.");
    if (c.costFactor !== undefined && !okFactor(c.costFactor)) throw new PmoError("O fator de custo da atividade deve ser maior que 0 e no máximo 10.");
  }
}

/** Aplica o cenário a uma cópia da EAP. Atividade inexistente ou resumo, ou duração negativa → PmoError. */
export function applyScenario(inputs: readonly WbsNodeInput[], sc: Scenario): WbsNodeInput[] {
  validateScenario(sc);
  const parents = new Set(inputs.map((n) => n.parentId).filter((p): p is string => p !== null));
  const leafIds = new Set(inputs.filter((n) => !parents.has(n.id)).map((n) => n.id));
  const byAct = new Map(sc.changes.map((c) => [c.activityId, c]));
  for (const id of byAct.keys()) if (!leafIds.has(id)) throw new PmoError(`O cenário aponta para atividade inexistente ou resumo: ${id}.`);

  return inputs.map((n) => {
    const next: WbsNodeInput = { ...n, predecessors: n.predecessors?.map((p) => ({ ...p })) };
    if (!leafIds.has(n.id)) return next;
    const c = byAct.get(n.id);
    if (c?.durationDelta) {
      const d = (n.duration ?? 0) + c.durationDelta;
      if (d < 0) throw new PmoError(`A duração de "${n.name}" ficaria negativa (${d}).`);
      next.duration = d;
    }
    if (c?.delayDays) {
      for (const p of next.predecessors ?? []) p.lag = (p.lag ?? 0) + c.delayDays;
      if (!next.predecessors?.length || next.startNoEarlierThan !== undefined) next.startNoEarlierThan = (next.startNoEarlierThan ?? 0) + c.delayDays;
    }
    const factor = (sc.costFactor ?? 1) * (c?.costFactor ?? 1);
    if (factor !== 1 && n.plannedCost !== undefined) next.plannedCost = fromCents(Math.round(toCents(n.plannedCost) * factor));
    return next;
  });
}

export interface ScenarioComparison {
  durationBefore: number;
  durationAfter: number;
  /** Positivo = atraso. */
  durationDelta: number;
  costBefore: number;
  costAfter: number;
  costDelta: number;
  criticalPathBefore: string[];
  criticalPathAfter: string[];
  newlyCritical: string[];
  /** Atividades cujo término muda (dias úteis; positivo = atrasa). */
  finishShifts: { id: string; name: string; deltaDays: number }[];
}

/** Compara o cenário com o plano atual: prazo, custo, caminho crítico e atividades afetadas. */
export function compareScenario(inputs: readonly WbsNodeInput[], sc: Scenario): ScenarioComparison {
  const before = planWbs(inputs);
  const after = planWbs(applyScenario(inputs, sc));
  const was = new Set(before.cpm.criticalPath);
  const shifts = after.leaves.flatMap((l) => {
    const b = before.byId.get(l.id);
    const d = b ? l.finish - b.finish : 0;
    return d === 0 ? [] : [{ id: l.id, name: l.name, deltaDays: d }];
  });
  return {
    durationBefore: before.projectDuration,
    durationAfter: after.projectDuration,
    durationDelta: after.projectDuration - before.projectDuration,
    costBefore: before.totalPlannedCost,
    costAfter: after.totalPlannedCost,
    costDelta: fromCents(toCents(after.totalPlannedCost) - toCents(before.totalPlannedCost)),
    criticalPathBefore: before.cpm.criticalPath,
    criticalPathAfter: after.cpm.criticalPath,
    newlyCritical: after.cpm.criticalPath.filter((id) => !was.has(id)),
    finishShifts: shifts,
  };
}

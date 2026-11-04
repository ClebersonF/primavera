import { parseIsoDate } from "../dates";
import { PmoError } from "../errors";
import { fromCents, toCents } from "../money";
import type { WbsPlan } from "../wbs/wbs";

export interface BaselineItem {
  readonly id: string;
  readonly start: number;
  readonly finish: number;
  readonly duration: number;
  readonly plannedCost: number;
}

export interface Baseline {
  readonly name: string;
  /** Data de criação (YYYY-MM-DD). */
  readonly createdAt: string;
  readonly projectDuration: number;
  readonly totalCost: number;
  readonly items: readonly BaselineItem[];
}

/** Congela o plano atual (atividades-folha) como linha de base. O resultado é imutável. */
export function createBaseline(name: string, createdAt: string, plan: WbsPlan): Baseline {
  if (name.trim() === "") throw new PmoError("A baseline precisa de um nome");
  parseIsoDate(createdAt);
  const items = plan.leaves.map((l) =>
    Object.freeze({
      id: l.id,
      start: l.start,
      finish: l.finish,
      duration: l.duration,
      plannedCost: l.plannedCost,
    }),
  );
  return Object.freeze({
    name,
    createdAt,
    projectDuration: plan.projectDuration,
    totalCost: plan.totalPlannedCost,
    items: Object.freeze(items),
  });
}

export type VarianceStatus = "no_prazo" | "atrasada" | "adiantada" | "nova";

export interface ItemVariance {
  id: string;
  /** Atual − baseline, em dias úteis. Positivo = atraso. */
  startVariance: number;
  finishVariance: number;
  durationVariance: number;
  /** Atual − baseline, em BRL. Positivo = acima do orçado. */
  costVariance: number;
  status: VarianceStatus;
}

export interface BaselineComparison {
  items: ItemVariance[];
  /** Atividades que estavam na baseline e não existem mais no plano. */
  removed: string[];
  projectDurationVariance: number;
  costVariance: number;
}

export function compareToBaseline(baseline: Baseline, plan: WbsPlan): BaselineComparison {
  const base = new Map(baseline.items.map((i) => [i.id, i]));
  const items: ItemVariance[] = plan.leaves.map((l) => {
    const b = base.get(l.id);
    if (!b) {
      return {
        id: l.id,
        startVariance: 0,
        finishVariance: 0,
        durationVariance: 0,
        costVariance: l.plannedCost,
        status: "nova" as const,
      };
    }
    const finishVariance = l.finish - b.finish;
    return {
      id: l.id,
      startVariance: l.start - b.start,
      finishVariance,
      durationVariance: l.duration - b.duration,
      costVariance: fromCents(toCents(l.plannedCost) - toCents(b.plannedCost)),
      status: finishVariance > 0 ? "atrasada" : finishVariance < 0 ? "adiantada" : "no_prazo",
    };
  });
  const current = new Set(plan.leaves.map((l) => l.id));
  return {
    items,
    removed: baseline.items.filter((i) => !current.has(i.id)).map((i) => i.id),
    projectDurationVariance: plan.projectDuration - baseline.projectDuration,
    costVariance: fromCents(toCents(plan.totalPlannedCost) - toCents(baseline.totalCost)),
  };
}

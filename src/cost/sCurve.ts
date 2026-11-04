import { PmoError } from "../errors";
import { fromCents, nonNegativeCents } from "../money";
import type { WbsPlan } from "../wbs/wbs";

/** Custo a distribuir no intervalo [start, finish) em dias úteis. Duração zero = custo no dia `start`. */
export interface CostSpread {
  id: string;
  start: number;
  finish: number;
  cost: number;
}

export interface SCurvePoint {
  /** Período, a partir de 0. */
  period: number;
  /** Primeiro dia do período e o dia seguinte ao último (exclusivo). */
  fromDay: number;
  toDay: number;
  /** Custo no período. */
  amount: number;
  /** Custo acumulado até o fim do período (curva S). */
  cumulative: number;
}

/** Usa as atividades-folha da EAP como base da distribuição. */
export function spreadFromPlan(plan: WbsPlan): CostSpread[] {
  return plan.leaves.map((l) => ({ id: l.id, start: l.start, finish: l.finish, cost: l.plannedCost }));
}

/**
 * Curva S planejada: o custo de cada atividade é espalhado uniformemente pelos seus
 * dias úteis (em centavos, sem perda: o acumulado final iguala o custo total) e agrupado
 * em períodos de `bucketDays` dias úteis (5 = semana).
 */
export function plannedSCurve(items: readonly CostSpread[], bucketDays = 5): SCurvePoint[] {
  if (!Number.isInteger(bucketDays) || bucketDays < 1) {
    throw new PmoError(`bucketDays deve ser inteiro >= 1 (recebido: ${bucketDays})`);
  }
  let horizon = 0;
  for (const it of items) {
    if (!Number.isInteger(it.start) || !Number.isInteger(it.finish) || it.start < 0 || it.finish < it.start) {
      throw new PmoError(`Intervalo inválido na atividade ${it.id}: [${it.start}, ${it.finish})`);
    }
    horizon = Math.max(horizon, it.finish > it.start ? it.finish : it.start + 1);
  }
  if (items.length === 0 || horizon === 0) return [];

  const daily = new Array<number>(horizon).fill(0);
  for (const it of items) {
    const cents = nonNegativeCents(it.cost, `Custo da atividade ${it.id}`);
    if (cents === 0) continue;
    const dur = it.finish - it.start;
    if (dur === 0) {
      daily[it.start]! += cents;
      continue;
    }
    const base = Math.floor(cents / dur);
    const rem = cents % dur;
    for (let i = 0; i < dur; i++) daily[it.start + i]! += base + (i < rem ? 1 : 0);
  }

  const points: SCurvePoint[] = [];
  let cumulative = 0;
  for (let from = 0, period = 0; from < horizon; from += bucketDays, period++) {
    const to = Math.min(from + bucketDays, horizon);
    let sum = 0;
    for (let d = from; d < to; d++) sum += daily[d]!;
    cumulative += sum;
    points.push({ period, fromDay: from, toDay: to, amount: fromCents(sum), cumulative: fromCents(cumulative) });
  }
  return points;
}

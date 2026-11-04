import { PmoError } from "../errors";
import { DEFAULT_CALENDAR, workDayDates, type WorkCalendar } from "../cpm/calendar";
import type { ResourceAssignment } from "./histogram";

export const ALLOCATION_CURVES = ["linear", "inicio", "fim", "sino"] as const;
export type AllocationCurve = (typeof ALLOCATION_CURVES)[number];
export const CURVE_LABEL: Record<AllocationCurve, string> = { linear: "Uniforme", inicio: "Concentrada no início", fim: "Concentrada no fim", sino: "Sino (pico no meio)" };

/** Pesos diários de uma curva de alocação para `n` dias, com média 1 (o total de dias-pessoa é preservado). */
export function curveWeights(curve: AllocationCurve, n: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new PmoError("Curva: quantidade de dias inválida.");
  if (n === 0) return [];
  let raw: number[];
  switch (curve) {
    case "linear":
      return new Array<number>(n).fill(1);
    case "inicio":
      raw = Array.from({ length: n }, (_, i) => n - i);
      break;
    case "fim":
      raw = Array.from({ length: n }, (_, i) => i + 1);
      break;
    case "sino":
      raw = Array.from({ length: n }, (_, i) => 0.25 + Math.sin(((i + 0.5) / n) * Math.PI));
      break;
    default:
      throw new PmoError(`Curva desconhecida: ${String(curve)}`);
  }
  const mean = raw.reduce((a, b) => a + b, 0) / n;
  return raw.map((w) => Math.round((w / mean) * 1e6) / 1e6);
}

export interface ProfiledAssignment {
  resource: string;
  units: number;
  start: number;
  finish: number;
  curve?: AllocationCurve;
}

/**
 * Expande atribuições em trechos diários: aplica a curva (unidades médias × peso do dia) e zera os dias de folga
 * do recurso (datas em `daysOff`). Trechos vizinhos com a mesma carga são fundidos. Sem curva nem folgas, devolve as atribuições como estão.
 */
export function expandAssignments(
  items: readonly ProfiledAssignment[],
  opts: { startDate: string; calendar?: WorkCalendar; daysOff?: Readonly<Record<string, readonly string[]>> } ,
): ResourceAssignment[] {
  const out: ResourceAssignment[] = [];
  const needsDates = items.some((i) => (i.curve && i.curve !== "linear") || (opts.daysOff?.[i.resource]?.length ?? 0) > 0);
  const horizon = Math.max(0, ...items.map((i) => i.finish));
  const dates = needsDates && horizon > 0 ? workDayDates(opts.startDate, horizon, opts.calendar ?? DEFAULT_CALENDAR) : [];
  for (const it of items) {
    const off = new Set(opts.daysOff?.[it.resource] ?? []);
    const curve = it.curve ?? "linear";
    if (it.finish <= it.start) continue;
    if (curve === "linear" && off.size === 0) {
      out.push({ resource: it.resource, start: it.start, finish: it.finish, units: it.units });
      continue;
    }
    const weights = curveWeights(curve, it.finish - it.start);
    let runStart = it.start;
    let runUnits = -1;
    for (let d = it.start; d <= it.finish; d++) {
      const u = d < it.finish ? (off.has(dates[d]!) ? 0 : Math.round(it.units * weights[d - it.start]! * 1e4) / 1e4) : -2;
      if (u !== runUnits) {
        if (runUnits > 0 && d > runStart) out.push({ resource: it.resource, start: runStart, finish: d, units: runUnits });
        runStart = d;
        runUnits = u;
      }
    }
  }
  return out;
}

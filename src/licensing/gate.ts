import { DEFAULT_CALENDAR, toCalendarDates, type WorkCalendar } from "../cpm/calendar";
import { scheduleCpm } from "../cpm/engine";
import { parseIsoDate } from "../dates";
import { GRAPROHAB_STEPS, buildGraprohabProcess, type GraprohabStepId } from "./graprohab";
import type { LicensingState } from "../planning/planning";

export interface GateDate {
  /** YYYY-MM-DD */
  date: string;
  /** "emitida" = certidão já emitida; "prevista" = projetada pelo fluxo a partir da data de início. */
  source: "emitida" | "prevista";
}

const ok = (d: string) => {
  try {
    parseIsoDate(d);
    return true;
  } catch {
    return false;
  }
};

/**
 * Data em que o GRAPROHAB libera a obra: a da certidão, se emitida; senão a prevista pelo fluxo (etapas e prazos
 * digitados, com Comunique-se se marcado) a partir da data de início. Sem uma nem outra, devolve null.
 */
export function graprohabGate(l: Pick<LicensingState, "start" | "withComunique" | "days" | "issuedOn"> | undefined, calendar: WorkCalendar = DEFAULT_CALENDAR): GateDate | null {
  if (!l) return null;
  if (l.issuedOn && ok(l.issuedOn)) return { date: l.issuedOn, source: "emitida" };
  if (!l.start || !ok(l.start)) return null;
  const days: Partial<Record<GraprohabStepId, number>> = {};
  const known = new Set<string>(GRAPROHAB_STEPS.map((s) => s.id));
  for (const [k, v] of Object.entries(l.days ?? {})) {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (known.has(k) && Number.isInteger(n) && n >= 0) days[k as GraprohabStepId] = n;
  }
  const cpm = scheduleCpm(buildGraprohabProcess({ comuniqueSe: l.withComunique, days }));
  const dated = toCalendarDates(cpm, l.start, calendar);
  const last = dated.at(-1);
  return last ? { date: last.finishDate, source: "prevista" } : null;
}

/**
 * Atividades marcadas com `gate: "graprohab"` não começam antes da data de liberação do GRAPROHAB (viram "não iniciar antes de",
 * respeitando uma data mais tardia já definida). Devolve também o que foi aplicado, para avisar o usuário.
 */
export function applyLicensingGates<T extends { id: string; gate?: string; notBefore?: string }>(
  activities: readonly T[],
  licensing: Parameters<typeof graprohabGate>[0],
  calendar: WorkCalendar = DEFAULT_CALENDAR,
): { activities: T[]; applied: { id: string; gate: GateDate }[] } {
  const gate = activities.some((a) => a.gate === "graprohab") ? graprohabGate(licensing, calendar) : null;
  if (!gate) return { activities: [...activities], applied: [] };
  const applied: { id: string; gate: GateDate }[] = [];
  const out = activities.map((a) => {
    if (a.gate !== "graprohab") return a;
    applied.push({ id: a.id, gate });
    return a.notBefore && a.notBefore > gate.date ? a : { ...a, notBefore: gate.date };
  });
  return { activities: out, applied };
}

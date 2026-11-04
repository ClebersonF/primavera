import { CpmError, type CpmResult } from "./types";

/** Calendário de trabalho. `workWeekdays`: 0 = domingo … 6 = sábado. `holidays`: "YYYY-MM-DD". */
export interface WorkCalendar {
  workWeekdays: number[];
  holidays: string[];
}

export const DEFAULT_CALENDAR: WorkCalendar = { workWeekdays: [1, 2, 3, 4, 5], holidays: [] };

const DAY_MS = 86_400_000;

function parseIso(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new CpmError(`Data inválida (use YYYY-MM-DD): ${date}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (toIso(t) !== date) throw new CpmError(`Data inexistente: ${date}`);
  return t;
}

function toIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function assertCalendar(cal: WorkCalendar): void {
  if (cal.workWeekdays.length === 0) {
    throw new CpmError("O calendário precisa de ao menos um dia útil por semana");
  }
  for (const d of cal.workWeekdays) {
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new CpmError(`Dia da semana inválido: ${d}`);
  }
  for (const h of cal.holidays) parseIso(h); // feriado mal formatado seria ignorado em silêncio
}

export function isWorkDay(date: string, cal: WorkCalendar = DEFAULT_CALENDAR): boolean {
  assertCalendar(cal);
  const t = parseIso(date);
  return cal.workWeekdays.includes(new Date(t).getUTCDay()) && !cal.holidays.includes(date);
}

/** Quantidade de dias úteis em [from, to). Zero se `to` não vier depois de `from`. */
export function workDaysBetween(from: string, to: string, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  assertCalendar(cal);
  const start = parseIso(from);
  const end = parseIso(to);
  if (end <= start) return 0;
  if ((end - start) / DAY_MS > 36_500) throw new CpmError("Intervalo maior que 100 anos");
  const holidays = new Set(cal.holidays);
  const week = new Set(cal.workWeekdays);
  let count = 0;
  for (let t = start; t < end; t += DAY_MS) {
    if (week.has(new Date(t).getUTCDay()) && !holidays.has(toIso(t))) count++;
  }
  return count;
}

/** Lista as `count` primeiras datas úteis a partir de `projectStart` (inclusive). */
function workDays(projectStart: string, count: number, cal: WorkCalendar): string[] {
  assertCalendar(cal);
  const holidays = new Set(cal.holidays);
  const week = new Set(cal.workWeekdays);
  const out: string[] = [];
  let t = parseIso(projectStart);
  while (out.length < count) {
    const iso = toIso(t);
    if (week.has(new Date(t).getUTCDay()) && !holidays.has(iso)) out.push(iso);
    t += DAY_MS;
  }
  return out;
}

/** Data do `offset`-ésimo dia útil (0 = primeiro dia útil em ou depois de `projectStart`). */
export function workDayAt(
  projectStart: string,
  offset: number,
  cal: WorkCalendar = DEFAULT_CALENDAR,
): string {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new CpmError(`Offset deve ser inteiro >= 0 (recebido: ${offset})`);
  }
  return workDays(projectStart, offset + 1, cal)[offset]!;
}

export interface DatedActivity {
  id: string;
  startDate: string;
  /** Último dia de trabalho. Em marcos (duração 0), igual a `startDate`. */
  finishDate: string;
}

/** Converte offsets em dias úteis para datas de calendário (sábados, domingos e feriados pulados). */
export function toCalendarDates(
  result: CpmResult,
  projectStart: string,
  cal: WorkCalendar = DEFAULT_CALENDAR,
): DatedActivity[] {
  const days = workDays(projectStart, result.projectDuration + 1, cal);
  return result.activities.map((a) => ({
    id: a.id,
    startDate: days[a.earlyStart]!,
    finishDate: a.duration > 0 ? days[a.earlyFinish - 1]! : days[a.earlyStart]!,
  }));
}

import { PmoError } from "./errors";

/** Soma `days` dias corridos a uma data "YYYY-MM-DD". */
export function addDaysIso(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new PmoError(`Número de dias deve ser inteiro (recebido: ${days})`);
  return new Date(parseIsoDate(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Valida "YYYY-MM-DD" (inclusive datas inexistentes como 2026-02-30) e devolve o instante UTC em ms. */
export function parseIsoDate(date: string): number {
  const m = typeof date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) throw new PmoError(`Data inválida (use YYYY-MM-DD): ${String(date)}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(t).toISOString().slice(0, 10) !== date) throw new PmoError(`Data inexistente: ${date}`);
  return t;
}

const BR_TZ = "America/Sao_Paulo";
const brDay = new Intl.DateTimeFormat("en-CA", { timeZone: BR_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Data civil (YYYY-MM-DD) de um instante ISO no fuso de Brasília.
 * - "YYYY-MM-DD" passa como está.
 * - Meia-noite UTC exata ("…T00:00:00Z") é tratada como data sem hora (valor de seletor de data).
 * - Data-hora sem fuso (formato do Odoo, "YYYY-MM-DD HH:MM:SS") é lida como UTC.
 */
export function toLocalDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return (parseIsoDate(iso), iso);
  if (/^\d{4}-\d{2}-\d{2}[T ]00:00(:00(\.0+)?)?(Z|\+00:00)?$/.test(iso)) return (parseIsoDate(iso.slice(0, 10)), iso.slice(0, 10));
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const t = Date.parse(hasZone ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) throw new PmoError(`Data inválida: ${String(iso)}`);
  return brDay.format(new Date(t));
}

/** Hoje (data civil) no fuso de Brasília. */
export function todayLocal(now: Date = new Date()): string {
  return brDay.format(now);
}

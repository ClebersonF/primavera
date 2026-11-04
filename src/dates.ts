import { PmoError } from "./errors";

/** Valida "YYYY-MM-DD" (inclusive datas inexistentes como 2026-02-30) e devolve o instante UTC em ms. */
export function parseIsoDate(date: string): number {
  const m = typeof date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) throw new PmoError(`Data inválida (use YYYY-MM-DD): ${String(date)}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(t).toISOString().slice(0, 10) !== date) throw new PmoError(`Data inexistente: ${date}`);
  return t;
}

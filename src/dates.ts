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

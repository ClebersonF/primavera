import { PmoError } from "./errors";

/**
 * Dinheiro em BRL é somado em centavos inteiros para evitar erro de ponto
 * flutuante (0,1 + 0,2 !== 0,3).
 */
export function toCents(value: number, what = "valor"): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PmoError(`${what} deve ser um número finito (recebido: ${String(value)})`);
  }
  // `toPrecision(15)` remove o ruído binário antes de arredondar: 1,005 × 100 = 100,49999999999999.
  const cents = Math.round(Number((value * 100).toPrecision(15)));
  if (!Number.isSafeInteger(cents)) {
    throw new PmoError(`${what} fora do intervalo suportado (recebido: ${value})`);
  }
  return cents;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Como `toCents`, mas exige valor >= 0. */
export function nonNegativeCents(value: number, what: string): number {
  const c = toCents(value, what);
  if (c < 0) throw new PmoError(`${what} não pode ser negativo (recebido: ${value})`);
  return c;
}

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

/**
 * Lê um número digitado no padrão brasileiro. Aceita "5000000", "5.000.000", "5.000.000,00", "1234,5", "11.2" e "R$ 1.500,00".
 * Regra do ponto: com vírgula, ponto é separador de milhar; sem vírgula, pontos seguidos de grupos de 3 dígitos são
 * milhar ("1.234", "5.000.000") e um ponto isolado é decimal ("11.2"). Vazio ou texto inválido → NaN (nunca zero).
 */
export function parseBrNumber(text: string): number {
  const t = text.replace(/[R$%\s ]/g, "");
  if (t === "" || !/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return NaN;
  if ((t.match(/,/g) ?? []).length > 1) return NaN;
  let normal: string;
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "");
  else if ((t.match(/\./g) ?? []).length > 1) return NaN;
  else normal = t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

/** Formata no padrão brasileiro com casas fixas: 5000000 → "5.000.000,00". Montado à mão para não depender do locale do ambiente. */
export function formatBrNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "";
  const fixed = Math.abs(value).toFixed(decimals);
  const [int = "0", frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const zero = Number(fixed) === 0;
  return `${value < 0 && !zero ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

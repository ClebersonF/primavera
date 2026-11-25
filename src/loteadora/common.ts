import { PmoError } from "../errors";

/** Utilidades comuns do módulo Loteadora 360º (Sol Maior). Datas sempre YYYY-MM-DD, em UTC. */
export const DAY_MS = 86_400_000;

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function assertDate(v: unknown, label: string): string {
  if (!isIsoDate(v)) throw new PmoError(`${label}: data inválida (use AAAA-MM-DD).`);
  return v;
}

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Dias corridos de `from` até `to` (negativo se `to` vem antes). */
export const daysBetween = (from: string, to: string): number => Math.round((toMs(to) - toMs(from)) / DAY_MS);

export const addDays = (d: string, n: number): string => new Date(toMs(d) + n * DAY_MS).toISOString().slice(0, 10);

/** Soma anos mantendo dia e mês (29/02 vira 28/02 em ano não bissexto). */
export function addYears(d: string, years: number): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${String(y + years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= max ? t : null;
};

export const optText = (v: unknown, max: number): string | undefined => (v === undefined || v === null || v === "" ? undefined : (text(v, max) ?? undefined));

export const nonNeg = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Níveis da matriz de alertas do documento (6.1), do mais calmo ao mais grave. */
export const NIVEIS = ["verde", "amarelo", "vermelho", "critico"] as const;
export type Nivel = (typeof NIVEIS)[number];
export const NIVEL_LABEL: Record<Nivel, string> = { verde: "Verde · normal", amarelo: "Amarelo · atenção", vermelho: "Vermelho · urgente", critico: "Crítico · máximo" };
export const nivelRank = (n: Nivel) => NIVEIS.indexOf(n);
export const pior = (a: Nivel, b: Nivel): Nivel => (nivelRank(a) >= nivelRank(b) ? a : b);

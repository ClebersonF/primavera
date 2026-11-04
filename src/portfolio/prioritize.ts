import { PmoError } from "../errors";

export type PortfolioNature = "emergency" | "corrective" | "improvement" | "investment";

export interface PortfolioItem {
  id: string;
  name: string;
  nature?: PortfolioNature;
  /** Orçamento em BRL. */
  budget: number;
  /** Índice de desempenho de prazo (EVM); null se desconhecido. */
  spi: number | null;
  /** Dias corridos até o prazo; negativo = vencido; null = sem prazo. */
  daysToDeadline: number | null;
}

export interface PriorityWeights {
  nature: number;
  schedule: number;
  deadline: number;
  budget: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { nature: 0.3, schedule: 0.3, deadline: 0.25, budget: 0.15 };

/** Urgência por natureza (0..1). Convenção editável, não regra normativa. */
export const NATURE_URGENCY: Record<PortfolioNature, number> = {
  emergency: 1,
  corrective: 0.7,
  improvement: 0.5,
  investment: 0.4,
};

export type PriorityBand = "alta" | "media" | "baixa";

export interface PrioritizedItem extends PortfolioItem {
  /** 0..100 */
  score: number;
  band: PriorityBand;
  rank: number;
  /** Cada fator em 0..1, antes do peso. */
  factors: PriorityWeights;
  /** Fatores sem dado (usaram valor neutro 0,5). */
  missing: Array<keyof PriorityWeights>;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Ranking multicritério transparente: natureza, desvio de prazo, proximidade do prazo e porte do orçamento. */
export function prioritizePortfolio(
  items: readonly PortfolioItem[],
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): PrioritizedItem[] {
  const w = Object.values(weights);
  if (w.some((x) => !(x >= 0)) || w.reduce((a, b) => a + b, 0) <= 0) {
    throw new PmoError("Priorização: pesos devem ser ≥ 0 e somar mais que zero.");
  }
  const total = w.reduce((a, b) => a + b, 0);
  const maxBudget = Math.max(0, ...items.map((i) => i.budget));

  const scored = items.map((i) => {
    if (!(i.budget >= 0)) throw new PmoError(`Priorização: orçamento inválido em "${i.id}".`);
    const missing: Array<keyof PriorityWeights> = [];
    const nature = i.nature ? NATURE_URGENCY[i.nature] : (missing.push("nature"), 0.5);
    // SPI 1,0 = sem pressão; SPI ≤ 0,5 = pressão máxima.
    const schedule = i.spi === null ? (missing.push("schedule"), 0.5) : clamp01((1 - i.spi) / 0.5);
    // Vencido = 1; 90+ dias = 0.
    const deadline = i.daysToDeadline === null ? (missing.push("deadline"), 0.5) : clamp01(1 - i.daysToDeadline / 90);
    const budget = maxBudget > 0 ? i.budget / maxBudget : 0;
    const factors = { nature, schedule, deadline, budget };
    const score = r1(
      (100 * (weights.nature * nature + weights.schedule * schedule + weights.deadline * deadline + weights.budget * budget)) / total,
    );
    const band: PriorityBand = score >= 66 ? "alta" : score >= 33 ? "media" : "baixa";
    return { ...i, score, band, rank: 0, factors, missing };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.map((s, idx) => ({ ...s, rank: idx + 1 }));
}

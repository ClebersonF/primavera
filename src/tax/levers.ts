import { PmoError } from "../errors";
import { formatBrNumber } from "../money";
import { compareRegimes, DEFAULT_REGIME_PARAMS, SIMPLES_LIMIT, fatorRGap, realBreakEvenMargin, type RegimeComparison, type RegimeId, type RegimeInput, type RegimeParams } from "./regimes";

/**
 * Alavancas de economia: a mesma comparação de regimes refeita com UMA premissa alterada por vez.
 * Tudo aqui é cálculo determinístico; a análise por IA só interpreta estes números, nunca os produz.
 */

export type LeverId = "atual" | "fator_r" | "margem_menor" | "margem_maior" | "so_pf" | "so_pj" | "com_simples" | "regime_pleno";

export interface LeverScenario {
  id: LeverId;
  title: string;
  /** O que foi mudado em relação à situação informada. */
  change: string;
  comparison: RegimeComparison;
  /** Regime de menor carga total entre os disponíveis neste cenário. */
  best: RegimeId | null;
  bestTotal: number | null;
  /** bestTotal do cenário − bestTotal da situação atual (negativo = economia). */
  deltaVsCurrent: number | null;
}

export interface RegimeLevers {
  current: LeverScenario;
  scenarios: LeverScenario[];
  /** Diferença entre o melhor e o segundo melhor regime disponível na situação atual (quanto custa errar a escolha). */
  gapToSecond: number | null;
  secondBest: RegimeId | null;
  /** Margem de lucro em que Presumido e Real empatam no IRPJ/CSLL. */
  breakEvenMargin: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function best(c: RegimeComparison): { id: RegimeId | null; total: number | null } {
  const s = c.scenarios.find((x) => x.id === c.lowestTotal);
  return { id: s?.id ?? null, total: s ? s.total : null };
}

export function regimeLevers(input: RegimeInput, params: RegimeParams = DEFAULT_REGIME_PARAMS): RegimeLevers {
  const base = compareRegimes(input, params);
  const b0 = best(base);
  const make = (id: LeverId, title: string, change: string, i: RegimeInput): LeverScenario => {
    const comparison = id === "atual" ? base : compareRegimes(i, params);
    const b = best(comparison);
    return {
      id, title, change, comparison, best: b.id, bestTotal: b.total,
      deltaVsCurrent: b.total !== null && b0.total !== null ? r2(b.total - b0.total) : null,
    };
  };
  const current = make("atual", "Situação informada", "Nenhuma mudança.", input);
  const out: LeverScenario[] = [];

  const gap = fatorRGap(input);
  if (!gap.reached && gap.missing > 0) {
    out.push(make("fator_r", "Pró-labore até o Fator R de 28%", `Pró-labore anual sobe R$ ${formatBrNumber(gap.missing)} para a folha mais pró-labore chegar a 28% da receita. O IRPF do sócio sobre o valor a mais não está na conta.`, { ...input, proLabore: input.proLabore + gap.missing }));
  }
  const m = input.realProfitMargin;
  out.push(make("margem_menor", "Lucro tributável 10 pontos menor", `Margem do Lucro Real de ${formatBrNumber(m * 100, 1)}% para ${formatBrNumber((m - 0.1) * 100, 1)}%.`, { ...input, realProfitMargin: Math.max(-1, m - 0.1) }));
  out.push(make("margem_maior", "Lucro tributável 10 pontos maior", `Margem do Lucro Real de ${formatBrNumber(m * 100, 1)}% para ${formatBrNumber((m + 0.1) * 100, 1)}%.`, { ...input, realProfitMargin: Math.min(1, m + 0.1) }));
  if (input.b2bShare > 0) out.push(make("so_pf", "Só clientes sem crédito (pessoa física)", "Nenhum cliente recupera a CBS/IBS: ela vira custo integral.", { ...input, b2bShare: 0 }));
  if (input.b2bShare < 1) out.push(make("so_pj", "Só clientes empresa com crédito", "Todos os clientes recuperam a CBS/IBS destacada.", { ...input, b2bShare: 1 }));
  // Acima do limite de receita o Simples continua fora mesmo com a opção feita: o cenário não diria nada.
  if (!input.simplesAvailable && input.revenue <= SIMPLES_LIMIT) out.push(make("com_simples", "Com o Simples Nacional disponível", "Considera o Simples ao alcance (ex.: após a próxima janela de opção).", { ...input, simplesAvailable: true }));
  if (input.year !== 2033) out.push(make("regime_pleno", "Regime pleno (2033, estimativa)", "Mesmos números no cenário de 2033, com ISS, PIS e COFINS extintos.", { ...input, year: 2033 }));

  const disponiveis = base.scenarios.filter((s) => s.available).sort((a, b) => a.total - b.total);
  const second = disponiveis[1] ?? null;
  return {
    current,
    scenarios: out,
    secondBest: second?.id ?? null,
    gapToSecond: second && disponiveis[0] ? r2(second.total - disponiveis[0].total) : null,
    breakEvenMargin: realBreakEvenMargin(input.revenue),
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Análise por IA: formato da resposta e conferência dos números citados.                            */

export interface TaxAiAnalysis {
  resumo: string;
  recomendacao: { regime: string; justificativa: string };
  economias: { titulo: string; detalhe: string }[];
  riscos: string[];
  perguntasContador: string[];
  proximosPassos: { quando: string; acao: string }[];
}

const txt = (v: unknown, max = 1200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max = 8): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** Lê a resposta da IA (JSON, às vezes cercado de texto ou de ```json). Campo ausente fica vazio; nada é inventado. */
export function parseTaxAiAnalysis(raw: string): TaxAiAnalysis {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new PmoError("A IA não devolveu a análise no formato esperado.");
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new PmoError("A IA devolveu uma análise ilegível. Tente de novo.");
  }
  const rec = (o.recomendacao ?? {}) as Record<string, unknown>;
  const out: TaxAiAnalysis = {
    resumo: txt(o.resumo),
    recomendacao: { regime: txt(rec.regime, 80), justificativa: txt(rec.justificativa) },
    economias: list(o.economias).map((e) => ({ titulo: txt((e as Record<string, unknown>)?.titulo, 160), detalhe: txt((e as Record<string, unknown>)?.detalhe) })).filter((e) => e.titulo || e.detalhe),
    riscos: list(o.riscos).map((r) => txt(r, 400)).filter(Boolean),
    perguntasContador: list(o.perguntasContador).map((r) => txt(r, 400)).filter(Boolean),
    proximosPassos: list(o.proximosPassos).map((p) => ({ quando: txt((p as Record<string, unknown>)?.quando, 60), acao: txt((p as Record<string, unknown>)?.acao, 400) })).filter((p) => p.acao),
  };
  if (!out.resumo && !out.recomendacao.justificativa && out.economias.length === 0) throw new PmoError("A IA devolveu uma análise vazia. Tente de novo.");
  return out;
}

/** Todos os números de um objeto (recursivo), para conferir o que a IA cita. */
export function collectNumbers(v: unknown, out: number[] = [], depth = 0): number[] {
  if (depth > 8) return out;
  if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectNumbers(x, out, depth + 1);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectNumbers(x, out, depth + 1);
  return out;
}

const parseBr = (s: string): number => Number(s.replace(/\./g, "").replace(",", "."));

/**
 * Valores em reais citados no texto que NÃO estão nos números calculados (nem como soma ou diferença de dois deles).
 * Tolerância de R$ 1 por arredondamento. Também aceita "mil"/"milhão" ("R$ 156 mil" ~ 156.360 com tolerância de 1%).
 */
export function unverifiedAmounts(text: string, known: number[]): string[] {
  const vals = [...new Set(known.filter((n) => Math.abs(n) >= 1).map((n) => Math.round(Math.abs(n) * 100) / 100))];
  const derived = new Set<number>(vals);
  for (let i = 0; i < vals.length && i < 300; i++) for (let j = i + 1; j < vals.length && j < 300; j++) {
    derived.add(Math.round((vals[i]! + vals[j]!) * 100) / 100);
    derived.add(Math.round(Math.abs(vals[i]! - vals[j]!) * 100) / 100);
  }
  const pool = [...derived];
  const out: string[] = [];
  const re = /R\$\s?(-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|-?\d+(?:,\d{1,2})?)(\s?(milh(?:ão|ões)|mi\b|mil\b))?/gi;
  for (const m of text.matchAll(re)) {
    let v = Math.abs(parseBr(m[1]!));
    const mult = m[3]?.toLowerCase();
    let tol = 1;
    if (mult === "mil") { v *= 1_000; tol = Math.max(1, v * 0.01); }
    else if (mult) { v *= 1_000_000; tol = Math.max(1, v * 0.01); }
    if (!Number.isFinite(v) || v < 1) continue;
    if (!pool.some((k) => Math.abs(k - v) <= tol)) out.push(m[0].trim());
  }
  return [...new Set(out)];
}

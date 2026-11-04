import { PmoError } from "../errors";
import { fromCents, nonNegativeCents } from "../money";

export interface ScenarioProject {
  id: string;
  name: string;
  budget: number;
  /** Pontuação de prioridade 0..100 (da estratégia escolhida). */
  score: number;
  /** Posição no ranking (1 = mais prioritário). */
  rank: number;
  hectares?: number;
  beneficiaries?: number;
  tco2e?: number;
  /** Índice de impacto 0..1; ausente = não avaliado. */
  impact?: number | null;
}

export interface ScenarioRules {
  /** Teto de orçamento (BRL); ausente = sem teto. */
  budgetCap?: number;
  /** Projetos que entram sempre (consomem o teto primeiro). */
  pinned?: readonly string[];
  /** Projetos fora do cenário. */
  excluded?: readonly string[];
}

export interface ScenarioTotals {
  projects: number;
  budget: number;
  hectares: number;
  beneficiaries: number;
  tco2e: number;
  /** Média da pontuação dos projetos escolhidos; null sem projetos. */
  avgScore: number | null;
}

export interface ScenarioResult {
  selected: ScenarioProject[];
  /** Projetos que ficaram de fora, com o motivo. */
  deferred: { project: ScenarioProject; reason: "excluido" | "sem_orcamento" }[];
  totals: ScenarioTotals;
  /** Totais de todos os projetos (sem teto nem exclusões), para comparar. */
  baseline: ScenarioTotals;
  /** Orçamento que sobra do teto; null sem teto. */
  remaining: number | null;
  /** Fixados que sozinhos já estouram o teto. */
  pinnedOverCap: boolean;
}

function totals(list: readonly ScenarioProject[]): ScenarioTotals {
  const sum = (f: (p: ScenarioProject) => number) => list.reduce((t, p) => t + f(p), 0);
  return {
    projects: list.length,
    budget: fromCents(list.reduce((t, p) => t + nonNegativeCents(p.budget, `Orçamento de ${p.id}`), 0)),
    hectares: sum((p) => p.hectares ?? 0),
    beneficiaries: sum((p) => p.beneficiaries ?? 0),
    tco2e: sum((p) => p.tco2e ?? 0),
    avgScore: list.length ? Math.round((sum((p) => p.score) / list.length) * 10) / 10 : null,
  };
}

/**
 * Cenário "e se" do portfólio: com um teto de orçamento, os fixados entram primeiro e os demais seguem a ordem
 * do ranking, pulando os que não cabem (um projeto menor mais abaixo pode caber). Não altera nenhum projeto.
 */
export function simulatePortfolio(projects: readonly ScenarioProject[], rules: ScenarioRules = {}): ScenarioResult {
  const ids = new Set(projects.map((p) => p.id));
  if (ids.size !== projects.length) throw new PmoError("Cenário: ids de projeto duplicados.");
  if (rules.budgetCap !== undefined && !(Number.isFinite(rules.budgetCap) && rules.budgetCap >= 0)) throw new PmoError("O teto de orçamento deve ser um número maior ou igual a zero.");
  const excluded = new Set(rules.excluded ?? []);
  const pinned = new Set((rules.pinned ?? []).filter((id) => !excluded.has(id)));
  const ordered = [...projects].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const capCents = rules.budgetCap === undefined ? Infinity : Math.round(rules.budgetCap * 100);

  const selected: ScenarioProject[] = [];
  const deferred: ScenarioResult["deferred"] = [];
  let used = 0;
  const take = (p: ScenarioProject) => {
    selected.push(p);
    used += nonNegativeCents(p.budget, `Orçamento de ${p.id}`);
  };
  for (const p of ordered) if (pinned.has(p.id)) take(p);
  const pinnedOverCap = used > capCents;
  for (const p of ordered) {
    if (pinned.has(p.id)) continue;
    if (excluded.has(p.id)) {
      deferred.push({ project: p, reason: "excluido" });
      continue;
    }
    const cost = nonNegativeCents(p.budget, `Orçamento de ${p.id}`);
    if (used + cost <= capCents) take(p);
    else deferred.push({ project: p, reason: "sem_orcamento" });
  }
  selected.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return { selected, deferred, totals: totals(selected), baseline: totals(projects), remaining: capCents === Infinity ? null : fromCents(capCents - used), pinnedOverCap };
}

import { PmoError } from "../errors";

export interface LevelItem {
  id: string;
  resource: string;
  /** Dias úteis desde o início; fim exclusivo. */
  start: number;
  finish: number;
  /** Folga total em dias úteis (null = desconhecida: trata como crítica). */
  float: number | null;
}

export interface LevelSuggestion {
  id: string;
  resource: string;
  /** Dias úteis a adiar o início para sair do conflito. */
  delayDays: number;
  /** true se o adiamento cabe na folga da atividade (não atrasa a entrega). */
  withinFloat: boolean;
}

/**
 * Nivelamento simples e explicável: por recurso, atividades mais críticas (menor folga) mantêm a
 * data; as demais são adiadas, uma a uma, até o primeiro intervalo livre para a capacidade do
 * recurso. É uma sugestão, não altera o plano. Atividades de duração 0 são ignoradas.
 */
export function levelResources(items: readonly LevelItem[], capacity = 1): LevelSuggestion[] {
  if (!Number.isInteger(capacity) || capacity < 1) throw new PmoError("A capacidade deve ser um inteiro ≥ 1.");
  const byResource = new Map<string, LevelItem[]>();
  for (const it of items) {
    if (!Number.isInteger(it.start) || !Number.isInteger(it.finish) || it.finish < it.start) throw new PmoError(`Intervalo inválido na atividade ${it.id}.`);
    if (it.finish === it.start) continue;
    byResource.set(it.resource, [...(byResource.get(it.resource) ?? []), it]);
  }
  const out: LevelSuggestion[] = [];
  for (const [resource, list] of byResource) {
    const order = [...list].sort((a, b) => (a.float ?? 0) - (b.float ?? 0) || a.start - b.start || a.id.localeCompare(b.id));
    const placed: { start: number; finish: number }[] = [];
    const fits = (s: number, f: number) => {
      for (let d = s; d < f; d++) if (placed.filter((p) => p.start <= d && d < p.finish).length >= capacity) return false;
      return true;
    };
    for (const it of order) {
      const dur = it.finish - it.start;
      let s = it.start;
      while (!fits(s, s + dur)) s++;
      placed.push({ start: s, finish: s + dur });
      if (s > it.start) out.push({ id: it.id, resource, delayDays: s - it.start, withinFloat: it.float !== null && s - it.start <= it.float });
    }
  }
  return out.sort((a, b) => a.resource.localeCompare(b.resource) || a.id.localeCompare(b.id));
}

export interface ResourceCostLine {
  resource: string;
  /** Soma de dias úteis alocados (ponderada pelas unidades). */
  days: number;
  /** Diária cadastrada, se houver. */
  rate: number | null;
  /** days × rate; null sem diária. */
  cost: number | null;
}

/** Custo de mão de obra por recurso. Diária ausente → custo null (não assume zero). */
export function resourceCosts(
  assignments: readonly { resource: string; start: number; finish: number; units?: number }[],
  rates: Readonly<Record<string, number>>,
): ResourceCostLine[] {
  const days = new Map<string, number>();
  for (const a of assignments) {
    const units = a.units ?? 1;
    if (!(units > 0) || !Number.isFinite(units)) throw new PmoError("Unidades de alocação inválidas.");
    days.set(a.resource, (days.get(a.resource) ?? 0) + Math.max(a.finish - a.start, 0) * units);
  }
  return [...days].map(([resource, d]) => {
    const rate = Object.hasOwn(rates, resource) ? rates[resource]! : null;
    return { resource, days: d, rate, cost: rate === null ? null : Math.round(d * rate * 100) / 100 };
  }).sort((a, b) => a.resource.localeCompare(b.resource));
}

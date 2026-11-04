import { PmoError } from "../errors";

export interface ResourceAssignment {
  resource: string;
  /** Dias úteis desde o início; fim exclusivo. */
  start: number;
  finish: number;
  /** Fração de uma pessoa alocada (1 = dedicação integral). Padrão 1. */
  units?: number;
}

export interface HistogramBucket {
  period: number;
  fromDay: number;
  toDay: number;
}

export interface ResourceLoad {
  resource: string;
  /** Média de pessoas alocadas por balde. */
  load: number[];
  capacity: number;
  peak: number;
  /** Índices dos baldes acima da capacidade. */
  overallocated: number[];
}

export interface Histogram {
  buckets: HistogramBucket[];
  resources: ResourceLoad[];
  total: number[];
  hasOverallocation: boolean;
}

export interface HistogramOptions {
  bucketDays?: number;
  /** Capacidade padrão por recurso (pessoas). Padrão 1. */
  defaultCapacity?: number;
  capacities?: Readonly<Record<string, number>>;
  /** Mínimo de dias a cobrir; por padrão, o término da última alocação. */
  horizon?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Histograma de recursos por semana útil, com detecção de superalocação. */
export function resourceHistogram(assignments: readonly ResourceAssignment[], opts: HistogramOptions = {}): Histogram {
  const bucketDays = opts.bucketDays ?? 5;
  const defaultCap = opts.defaultCapacity ?? 1;
  if (!Number.isInteger(bucketDays) || bucketDays < 1) throw new PmoError("Histograma: bucketDays deve ser inteiro ≥ 1.");
  if (!(defaultCap > 0)) throw new PmoError("Histograma: capacidade padrão deve ser > 0.");

  let end = opts.horizon ?? 0;
  for (const a of assignments) {
    const units = a.units ?? 1;
    if (!a.resource.trim()) throw new PmoError("Histograma: recurso sem nome.");
    if (!(units > 0)) throw new PmoError(`Histograma: unidades inválidas para "${a.resource}".`);
    if (!(a.start >= 0) || a.finish < a.start) throw new PmoError(`Histograma: intervalo inválido para "${a.resource}".`);
    end = Math.max(end, a.finish);
  }
  const nBuckets = Math.max(1, Math.ceil(end / bucketDays));
  const days = nBuckets * bucketDays;

  const perDay = new Map<string, number[]>();
  for (const a of assignments) {
    const arr = perDay.get(a.resource) ?? new Array<number>(days).fill(0);
    for (let d = a.start; d < a.finish; d++) arr[d]! += a.units ?? 1;
    perDay.set(a.resource, arr);
  }

  const buckets: HistogramBucket[] = Array.from({ length: nBuckets }, (_, p) => ({
    period: p,
    fromDay: p * bucketDays,
    toDay: Math.min((p + 1) * bucketDays, Math.max(end, 1)),
  }));
  const avg = (arr: number[], p: number) => {
    let s = 0;
    for (let d = p * bucketDays; d < (p + 1) * bucketDays; d++) s += arr[d]!;
    return r2(s / bucketDays);
  };

  const resources: ResourceLoad[] = [...perDay.keys()].sort((a, b) => a.localeCompare(b, "pt-BR")).map((resource) => {
    const arr = perDay.get(resource)!;
    const capacity = opts.capacities?.[resource] ?? defaultCap;
    const load = buckets.map((_, p) => avg(arr, p));
    // Pico medido por dia: uma sobreposição de 1 dia não some na média semanal.
    const peak = r2(Math.max(0, ...arr));
    const overallocated = buckets.map((_, p) => p).filter((p) => {
      for (let d = p * bucketDays; d < (p + 1) * bucketDays; d++) if (arr[d]! > capacity + 1e-9) return true;
      return false;
    });
    return { resource, load, capacity, peak, overallocated };
  });

  return {
    buckets,
    resources,
    total: buckets.map((_, p) => r2(resources.reduce((s, r) => s + r.load[p]!, 0))),
    hasOverallocation: resources.some((r) => r.overallocated.length > 0),
  };
}

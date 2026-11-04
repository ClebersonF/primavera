import {
  CpmCycleError,
  CpmError,
  type CpmActivity,
  type CpmResult,
  type LinkType,
  type ScheduledActivity,
} from "./types";

const LINK_TYPES: ReadonlySet<string> = new Set<LinkType>(["FS", "SS", "FF", "SF"]);

interface Link {
  from: string; // predecessora
  to: string; // sucessora
  type: LinkType;
  lag: number;
}

interface Node {
  id: string;
  duration: number;
  snet: number;
  mand: number | null;
  es: number;
  ef: number;
  ls: number;
  lf: number;
}

function assertInt(value: unknown, what: string, min?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CpmError(`${what} deve ser um número inteiro (recebido: ${String(value)})`);
  }
  if (min !== undefined && value < min) {
    throw new CpmError(`${what} deve ser >= ${min} (recebido: ${value})`);
  }
}

/** Menor início permitido da sucessora `s` imposto pelo vínculo (passagem à frente). */
function minStart(link: Link, p: Node, sDuration: number): number {
  switch (link.type) {
    case "FS":
      return p.ef + link.lag;
    case "SS":
      return p.es + link.lag;
    case "FF":
      return p.ef + link.lag - sDuration;
    case "SF":
      return p.es + link.lag - sDuration;
  }
}

/** Maior término permitido da predecessora `p` imposto pelo vínculo (passagem atrás). */
function maxFinish(link: Link, s: Node, pDuration: number): number {
  switch (link.type) {
    case "FS":
      return s.ls - link.lag;
    case "SS":
      return s.ls - link.lag + pDuration;
    case "FF":
      return s.lf - link.lag;
    case "SF":
      return s.lf - link.lag + pDuration;
  }
}

/** Folga do vínculo: quanto a sucessora pode atrasar em relação ao que o vínculo exige. */
function linkSlack(link: Link, p: Node, s: Node): number {
  switch (link.type) {
    case "FS":
      return s.es - (p.ef + link.lag);
    case "SS":
      return s.es - (p.es + link.lag);
    case "FF":
      return s.ef - (p.ef + link.lag);
    case "SF":
      return s.ef - (p.es + link.lag);
  }
}

/**
 * Calcula o cronograma pelo método do caminho crítico (CPM), com vínculos
 * FS/SS/FF/SF, defasagens (lag/lead) e restrição "não iniciar antes de".
 *
 * Lança `CpmError` para dados inválidos e `CpmCycleError` para dependência circular.
 */
export function scheduleCpm(input: readonly CpmActivity[]): CpmResult {
  const nodes = new Map<string, Node>();

  for (const a of input) {
    if (typeof a.id !== "string" || a.id === "") {
      throw new CpmError("Toda atividade precisa de um id não vazio");
    }
    if (nodes.has(a.id)) throw new CpmError(`Id de atividade duplicado: ${a.id}`);
    assertInt(a.duration, `Duração da atividade ${a.id}`, 0);
    const snet = a.startNoEarlierThan ?? 0;
    assertInt(snet, `startNoEarlierThan da atividade ${a.id}`, 0);
    if (a.mandatoryStart !== undefined) assertInt(a.mandatoryStart, `mandatoryStart da atividade ${a.id}`, 0);
    nodes.set(a.id, { id: a.id, duration: a.duration, snet, mand: a.mandatoryStart ?? null, es: 0, ef: 0, ls: 0, lf: 0 });
  }

  const links: Link[] = [];
  const incoming = new Map<string, Link[]>();
  const outgoing = new Map<string, Link[]>();
  for (const id of nodes.keys()) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }

  for (const a of input) {
    for (const pred of a.predecessors ?? []) {
      if (!nodes.has(pred.id)) {
        throw new CpmError(`Atividade ${a.id} depende de ${pred.id}, que não existe`);
      }
      if (pred.id === a.id) {
        throw new CpmCycleError([a.id]);
      }
      const lag = pred.lag ?? 0;
      assertInt(lag, `Lag do vínculo ${pred.id} → ${a.id}`);
      const type = pred.type ?? "FS";
      if (!LINK_TYPES.has(type)) {
        throw new CpmError(`Tipo de vínculo inválido em ${pred.id} → ${a.id}: ${String(type)} (use FS, SS, FF ou SF)`);
      }
      const link: Link = { from: pred.id, to: a.id, type, lag };
      links.push(link);
      incoming.get(a.id)!.push(link);
      outgoing.get(pred.id)!.push(link);
    }
  }

  // Ordenação topológica (Kahn) contando vínculos, não predecessoras únicas.
  const pending = new Map<string, number>();
  for (const [id, ins] of incoming) pending.set(id, ins.length);
  const queue: string[] = [];
  for (const [id, n] of pending) if (n === 0) queue.push(id);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    order.push(id);
    for (const l of outgoing.get(id)!) {
      const left = pending.get(l.to)! - 1;
      pending.set(l.to, left);
      if (left === 0) queue.push(l.to);
    }
  }
  if (order.length !== nodes.size) {
    const involved = [...pending].filter(([, n]) => n > 0).map(([id]) => id);
    throw new CpmCycleError(involved);
  }

  // Passagem à frente.
  let projectDuration = 0;
  for (const id of order) {
    const n = nodes.get(id)!;
    let es = Math.max(0, n.snet);
    if (n.mand !== null) es = n.mand;
    else {
      for (const l of incoming.get(id)!) {
        es = Math.max(es, minStart(l, nodes.get(l.from)!, n.duration));
      }
    }
    n.es = es;
    n.ef = es + n.duration;
    projectDuration = Math.max(projectDuration, n.ef);
  }

  // Passagem atrás.
  for (let i = order.length - 1; i >= 0; i--) {
    const n = nodes.get(order[i]!)!;
    let lf = projectDuration;
    for (const l of outgoing.get(n.id)!) {
      lf = Math.min(lf, maxFinish(l, nodes.get(l.to)!, n.duration));
    }
    if (n.mand !== null) lf = n.ef; // fixa: o início mais tarde é o próprio início obrigatório
    n.lf = lf;
    n.ls = lf - n.duration;
  }

  const activities: ScheduledActivity[] = input.map((a) => {
    const n = nodes.get(a.id)!;
    const outs = outgoing.get(n.id)!;
    let freeFloat = outs.length === 0 ? projectDuration - n.ef : Infinity;
    for (const l of outs) {
      freeFloat = Math.min(freeFloat, linkSlack(l, n, nodes.get(l.to)!));
    }
    const totalFloat = n.ls - n.es;
    return {
      id: n.id,
      duration: n.duration,
      earlyStart: n.es,
      earlyFinish: n.ef,
      lateStart: n.ls,
      lateFinish: n.lf,
      totalFloat,
      // Folga livre nunca excede a total (vínculos SF/SS podem sugerir o contrário).
      freeFloat: Math.max(0, Math.min(freeFloat, totalFloat)),
      critical: totalFloat <= 0,
    };
  });

  const criticalPath = activities
    .filter((a) => a.critical)
    .sort((a, b) => a.earlyStart - b.earlyStart || a.earlyFinish - b.earlyFinish || a.id.localeCompare(b.id))
    .map((a) => a.id);

  return { projectDuration, activities, criticalPath };
}

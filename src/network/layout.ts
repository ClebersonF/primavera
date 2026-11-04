import { PmoError } from "../errors";

export interface NetworkNodeInput {
  id: string;
  name: string;
  critical?: boolean;
  predecessors?: readonly { id: string; type?: string; lag?: number }[];
}

export interface NetworkNode {
  id: string;
  name: string;
  critical: boolean;
  /** Coluna: maior caminho (em vínculos) desde uma atividade sem predecessora. */
  level: number;
  /** Linha dentro da coluna. */
  row: number;
}

export interface NetworkEdge {
  from: string;
  to: string;
  type: string;
  lag: number;
  /** Vínculo entre duas atividades críticas. */
  critical: boolean;
}

export interface NetworkLayout {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  levels: number;
  rows: number;
}

/** Diagrama de rede em camadas: colunas pelo maior caminho, linhas na ordem de entrada. Predecessoras inexistentes são ignoradas. */
export function layoutNetwork(items: readonly NetworkNodeInput[]): NetworkLayout {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (byId.size !== items.length) throw new PmoError("Diagrama de rede: ids duplicados.");
  const edges: NetworkEdge[] = [];
  for (const it of items) {
    const seen = new Set<string>();
    for (const p of it.predecessors ?? []) {
      if (!byId.has(p.id) || p.id === it.id || seen.has(p.id)) continue;
      seen.add(p.id);
      edges.push({ from: p.id, to: it.id, type: p.type ?? "FS", lag: p.lag ?? 0, critical: Boolean(byId.get(p.id)!.critical && it.critical) });
    }
  }
  const incoming = new Map<string, string[]>(items.map((i) => [i.id, []]));
  for (const e of edges) incoming.get(e.to)!.push(e.from);

  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) throw new PmoError("Diagrama de rede: há um ciclo entre as atividades.");
    visiting.add(id);
    const d = Math.max(-1, ...incoming.get(id)!.map(depth)) + 1;
    visiting.delete(id);
    level.set(id, d);
    return d;
  };
  for (const it of items) depth(it.id);

  const perLevel = new Map<number, number>();
  const nodes: NetworkNode[] = items.map((it) => {
    const l = level.get(it.id)!;
    const row = perLevel.get(l) ?? 0;
    perLevel.set(l, row + 1);
    return { id: it.id, name: it.name, critical: Boolean(it.critical), level: l, row };
  });
  return { nodes, edges, levels: items.length === 0 ? 0 : Math.max(...level.values()) + 1, rows: Math.max(0, ...perLevel.values()) };
}

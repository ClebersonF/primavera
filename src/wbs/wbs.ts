import { scheduleCpm, type CpmActivity, type CpmResult, type Predecessor } from "../cpm";
import { PmoError } from "../errors";
import { fromCents, nonNegativeCents } from "../money";

/** Nó de entrada da EAP. Folhas são atividades; nós com filhos são resumos (valores derivados). */
export interface WbsNodeInput {
  id: string;
  parentId: string | null;
  name: string;
  /** Somente em folhas. Dias úteis inteiros. */
  duration?: number;
  /** Somente em folhas; devem apontar para folhas. */
  predecessors?: Predecessor[];
  startNoEarlierThan?: number;
  /** Somente em folhas. Início obrigatório (offset em dias úteis); ver `CpmActivity.mandatoryStart`. */
  mandatoryStart?: number;
  /** Somente em folhas. Custo planejado em BRL. */
  plannedCost?: number;
  /** Somente em folhas. Progresso físico, 0..100. */
  percentComplete?: number;
}

export interface WbsNode {
  id: string;
  parentId: string | null;
  name: string;
  /** Código hierárquico: "1", "1.2", "1.2.3" (ordem de entrada entre irmãos). */
  code: string;
  level: number;
  isLeaf: boolean;
  childIds: string[];
  /** Início/fim em dias úteis (fim exclusivo); resumos = min/max dos descendentes. */
  start: number;
  finish: number;
  duration: number;
  /** BRL; resumos = soma das folhas. */
  plannedCost: number;
  /** 0..100; resumos ponderados pela duração das folhas. */
  percentComplete: number;
  critical: boolean;
  /** Folga total; só existe nas folhas. */
  totalFloat: number | null;
}

export interface WbsPlan {
  /** Pré-ordem (pai antes dos filhos), seguindo a ordem de entrada. */
  nodes: WbsNode[];
  leaves: WbsNode[];
  byId: Map<string, WbsNode>;
  cpm: CpmResult;
  projectDuration: number;
  totalPlannedCost: number;
  percentComplete: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Valida a EAP, calcula o CPM nas folhas e faz o rollup nos resumos. */
export function planWbs(inputs: readonly WbsNodeInput[]): WbsPlan {
  const inputById = new Map<string, WbsNodeInput>();
  for (const n of inputs) {
    if (typeof n.id !== "string" || n.id === "") throw new PmoError("Todo nó da EAP precisa de id não vazio");
    if (inputById.has(n.id)) throw new PmoError(`Id de nó duplicado na EAP: ${n.id}`);
    inputById.set(n.id, n);
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of inputs) children.set(n.id, []);
  for (const n of inputs) {
    if (n.parentId === null) {
      roots.push(n.id);
    } else {
      if (!inputById.has(n.parentId)) throw new PmoError(`Nó ${n.id} aponta para pai inexistente: ${n.parentId}`);
      if (n.parentId === n.id) throw new PmoError(`Nó ${n.id} não pode ser pai de si mesmo`);
      children.get(n.parentId)!.push(n.id);
    }
  }

  // Ciclos na hierarquia: todo nó precisa alcançar uma raiz.
  for (const n of inputs) {
    const seen = new Set<string>([n.id]);
    let cur = n;
    while (cur.parentId !== null) {
      if (seen.has(cur.parentId)) throw new PmoError(`Ciclo na hierarquia da EAP envolvendo ${cur.parentId}`);
      seen.add(cur.parentId);
      cur = inputById.get(cur.parentId)!;
    }
  }

  const isLeaf = (id: string) => children.get(id)!.length === 0;

  // Validação por tipo de nó.
  for (const n of inputs) {
    if (isLeaf(n.id)) {
      if (n.duration === undefined) throw new PmoError(`A atividade ${n.id} precisa de duração`);
      if (n.percentComplete !== undefined) {
        if (!Number.isFinite(n.percentComplete) || n.percentComplete < 0 || n.percentComplete > 100) {
          throw new PmoError(`percentComplete da atividade ${n.id} deve estar entre 0 e 100`);
        }
      }
      nonNegativeCents(n.plannedCost ?? 0, `Custo planejado da atividade ${n.id}`);
      for (const p of n.predecessors ?? []) {
        const target = inputById.get(p.id);
        if (target && !isLeaf(p.id)) {
          throw new PmoError(`Atividade ${n.id} não pode depender do resumo ${p.id}; use uma atividade`);
        }
      }
    } else {
      const bad =
        n.duration !== undefined ||
        (n.predecessors?.length ?? 0) > 0 ||
        n.startNoEarlierThan !== undefined ||
        n.mandatoryStart !== undefined ||
        n.plannedCost !== undefined ||
        n.percentComplete !== undefined;
      if (bad) {
        throw new PmoError(`O resumo ${n.id} tem filhos; duração, vínculos, custo e progresso são derivados`);
      }
    }
  }

  const leafInputs = inputs.filter((n) => isLeaf(n.id));
  const cpmInput: CpmActivity[] = leafInputs.map((n) => ({
    id: n.id,
    duration: n.duration!,
    predecessors: n.predecessors,
    startNoEarlierThan: n.startNoEarlierThan,
    mandatoryStart: n.mandatoryStart,
  }));
  const cpm = scheduleCpm(cpmInput);
  const sched = new Map(cpm.activities.map((a) => [a.id, a]));

  const nodes: WbsNode[] = [];
  const byId = new Map<string, WbsNode>();

  /** Constrói em pós-ordem lógica, mas insere em pré-ordem; devolve as folhas do nó. */
  const build = (id: string, code: string, level: number): WbsNode[] => {
    const input = inputById.get(id)!;
    const kids = children.get(id)!;
    const node: WbsNode = {
      id,
      parentId: input.parentId,
      name: input.name,
      code,
      level,
      isLeaf: kids.length === 0,
      childIds: [...kids],
      start: 0,
      finish: 0,
      duration: 0,
      plannedCost: 0,
      percentComplete: 0,
      critical: false,
      totalFloat: null,
    };
    nodes.push(node);
    byId.set(id, node);

    if (node.isLeaf) {
      const s = sched.get(id)!;
      node.start = s.earlyStart;
      node.finish = s.earlyFinish;
      node.duration = s.duration;
      node.plannedCost = fromCents(nonNegativeCents(input.plannedCost ?? 0, "plannedCost"));
      node.percentComplete = input.percentComplete ?? 0;
      node.critical = s.critical;
      node.totalFloat = s.totalFloat;
      return [node];
    }

    const leaves: WbsNode[] = [];
    kids.forEach((kid, i) => leaves.push(...build(kid, `${code}.${i + 1}`, level + 1)));
    node.start = Math.min(...leaves.map((l) => l.start));
    node.finish = Math.max(...leaves.map((l) => l.finish));
    node.duration = node.finish - node.start;
    node.plannedCost = fromCents(leaves.reduce((acc, l) => acc + Math.round(l.plannedCost * 100), 0));
    node.percentComplete = weightedPercent(leaves);
    node.critical = leaves.some((l) => l.critical);
    return leaves;
  };

  const allLeaves: WbsNode[] = [];
  roots.forEach((r, i) => allLeaves.push(...build(r, String(i + 1), 0)));

  return {
    nodes,
    leaves: nodes.filter((n) => n.isLeaf),
    byId,
    cpm,
    projectDuration: cpm.projectDuration,
    totalPlannedCost: fromCents(allLeaves.reduce((acc, l) => acc + Math.round(l.plannedCost * 100), 0)),
    percentComplete: weightedPercent(allLeaves),
  };
}

/** Média do progresso ponderada pela duração; sem duração, média simples. */
function weightedPercent(leaves: readonly WbsNode[]): number {
  if (leaves.length === 0) return 0;
  const totalWeight = leaves.reduce((acc, l) => acc + l.duration, 0);
  if (totalWeight === 0) return round2(leaves.reduce((acc, l) => acc + l.percentComplete, 0) / leaves.length);
  return round2(leaves.reduce((acc, l) => acc + l.duration * l.percentComplete, 0) / totalWeight);
}

import type { WbsNodeInput } from "../src/wbs/wbs";

/**
 * Obra de exemplo.
 *  A 0–5 → B 5–15 → C 15–19 (crítico) e D 15–17 (folga 2). Duração do projeto: 19.
 *  Custo total: 4500,50. Progresso ponderado: (5·100 + 10·50) / 21 = 47,62.
 */
export const sampleWbs = (): WbsNodeInput[] => [
  { id: "1", parentId: null, name: "Obra" },
  { id: "A", parentId: "1", name: "Fundação", duration: 5, plannedCost: 1000, percentComplete: 100 },
  { id: "B", parentId: "1", name: "Estrutura", duration: 10, plannedCost: 2500.5, percentComplete: 50, predecessors: [{ id: "A" }] },
  { id: "S", parentId: "1", name: "Acabamento" },
  { id: "C", parentId: "S", name: "Pintura", duration: 4, plannedCost: 800, predecessors: [{ id: "B" }] },
  { id: "D", parentId: "S", name: "Limpeza", duration: 2, plannedCost: 200, predecessors: [{ id: "B" }] },
];

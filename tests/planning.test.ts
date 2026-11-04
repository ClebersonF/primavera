import { describe, expect, it } from "vitest";
import {
  EMPTY_PLANNING,
  MAX_BASELINES,
  nextChangeId,
  normalizePlanning,
  PmoError,
  withBaseline,
  withChange,
  withChangeStatus,
  withCost,
  type Baseline,
} from "../src";

const baseline = (name = "B1"): Baseline => ({
  name,
  createdAt: "2026-11-04",
  projectDuration: 10,
  totalCost: 100,
  items: [{ id: "a", start: 0, finish: 10, duration: 10, plannedCost: 100 }],
});

describe("normalizePlanning", () => {
  it("aceita lixo sem lançar e devolve o vazio", () => {
    for (const v of [undefined, null, 5, "x", [], { baselines: "x", costs: 3, changes: {} }]) {
      const p = normalizePlanning(v);
      expect(p.baselines).toEqual([]);
      expect(p.changes).toEqual([]);
      expect(p.costs).toEqual({});
    }
  });
  it("descarta itens inválidos e mantém os válidos", () => {
    const p = normalizePlanning({
      rev: 3,
      baselines: [baseline(), { name: "", items: [] }, { ...baseline("C"), items: [{ id: 1 }] }],
      costs: { a: { actual: 10, committed: -1, etc: "x" }, b: { actual: NaN }, __proto__: { actual: 1 }, c: 5 },
      changes: [
        { id: "CR-001", title: "t", status: "aprovada", durationDeltas: [{ activityId: "a", delta: 2 }] },
        { id: "CR-001", title: "dup", status: "rascunho" },
        { id: "CR-002", title: "t", status: "inexistente" },
        { id: "CR-003", title: "t", status: "rascunho", costDeltas: "x" },
      ],
    });
    expect(p.rev).toBe(3);
    expect(p.baselines.map((b) => b.name)).toEqual(["B1"]);
    expect(p.costs).toEqual({ a: { actual: 10 } });
    expect(p.changes.map((c) => c.id)).toEqual(["CR-001"]);
  });
  it("rev inválida vira 0; limita o número de baselines", () => {
    expect(normalizePlanning({ rev: -2 }).rev).toBe(0);
    expect(normalizePlanning({ rev: 1.5 }).rev).toBe(0);
    const many = Array.from({ length: MAX_BASELINES + 5 }, (_, i) => baseline(`B${i}`));
    expect(normalizePlanning({ baselines: many }).baselines).toHaveLength(MAX_BASELINES);
  });
});

describe("operações", () => {
  it("são imutáveis e incrementam rev", () => {
    const p1 = withBaseline(EMPTY_PLANNING, baseline());
    expect(EMPTY_PLANNING.baselines).toHaveLength(0);
    expect(p1.rev).toBe(1);
    const p2 = withCost(p1, "a", { actual: 50 });
    expect(p2.costs).toEqual({ a: { actual: 50 } });
    expect(p1.costs).toEqual({});
    expect(p2.rev).toBe(2);
  });
  it("withCost apaga campo com undefined e remove entrada vazia; valida", () => {
    const p = withCost(withCost(EMPTY_PLANNING, "a", { actual: 5, etc: 3 }), "a", { actual: undefined });
    expect(p.costs).toEqual({ a: { etc: 3 } });
    expect(withCost(p, "a", { etc: undefined }).costs).toEqual({});
    expect(() => withCost(p, "a", { actual: -1 })).toThrow(PmoError);
    expect(() => withCost(p, "a", { actual: NaN })).toThrow(PmoError);
    expect(() => withCost(p, "__proto__", { actual: 1 })).toThrow(PmoError);
  });
  it("baselines: limite e validação", () => {
    let p = EMPTY_PLANNING;
    for (let i = 0; i < MAX_BASELINES; i++) p = withBaseline(p, baseline(`B${i}`));
    expect(() => withBaseline(p, baseline("x"))).toThrow(PmoError);
    expect(() => withBaseline(EMPTY_PLANNING, { ...baseline(), name: " " })).toThrow(PmoError);
  });
  it("pedidos: nascem em rascunho, ids únicos, fluxo de aprovação", () => {
    const cr = { id: "CR-001", title: "t", status: "rascunho" as const, durationDeltas: [{ activityId: "a", delta: 3 }] };
    let p = withChange(EMPTY_PLANNING, cr);
    expect(() => withChange(p, cr)).toThrow(PmoError);
    expect(() => withChange(EMPTY_PLANNING, { ...cr, status: "aprovada" })).toThrow(PmoError);
    p = withChangeStatus(p, "CR-001", "em_aprovacao");
    p = withChangeStatus(p, "CR-001", "aprovada");
    expect(p.changes[0]!.status).toBe("aprovada");
    expect(() => withChangeStatus(p, "CR-001", "rascunho")).toThrow(PmoError);
    expect(() => withChangeStatus(p, "CR-999", "aprovada")).toThrow(PmoError);
  });
  it("nextChangeId segue o maior sufixo", () => {
    expect(nextChangeId(EMPTY_PLANNING)).toBe("CR-001");
    expect(nextChangeId({ changes: [{ id: "CR-007", title: "", status: "rascunho" }, { id: "x", title: "", status: "rascunho" }] })).toBe("CR-008");
  });
});

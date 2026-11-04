import { describe, expect, it } from "vitest";
import { compareToBaseline, createBaseline, PmoError, planWbs, type WbsNodeInput } from "../src";
import { sampleWbs } from "./fixtures";

describe("planWbs", () => {
  it("calcula códigos, rollup de prazo, custo e progresso", () => {
    const plan = planWbs(sampleWbs());
    expect(plan.nodes.map((n) => n.id)).toEqual(["1", "A", "B", "S", "C", "D"]);
    expect(plan.nodes.map((n) => n.code)).toEqual(["1", "1.1", "1.2", "1.3", "1.3.1", "1.3.2"]);
    expect(plan.projectDuration).toBe(19);
    expect(plan.totalPlannedCost).toBe(4500.5);
    expect(plan.percentComplete).toBe(47.62);

    const s = plan.byId.get("S")!;
    expect([s.start, s.finish, s.duration, s.plannedCost, s.percentComplete]).toEqual([15, 19, 4, 1000, 0]);
    const root = plan.byId.get("1")!;
    expect([root.start, root.finish, root.duration]).toEqual([0, 19, 19]);
    expect(plan.leaves.map((l) => l.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("propaga criticidade e expõe folga só nas folhas", () => {
    const plan = planWbs(sampleWbs());
    expect(plan.byId.get("D")!.critical).toBe(false);
    expect(plan.byId.get("D")!.totalFloat).toBe(2);
    expect(plan.byId.get("S")!.critical).toBe(true);
    expect(plan.byId.get("S")!.totalFloat).toBeNull();
    expect(plan.cpm.criticalPath).toEqual(["A", "B", "C"]);
  });

  it("numera várias raízes e aceita EAP vazia", () => {
    const plan = planWbs([
      { id: "x", parentId: null, name: "X", duration: 1 },
      { id: "y", parentId: null, name: "Y", duration: 2 },
    ]);
    expect(plan.nodes.map((n) => n.code)).toEqual(["1", "2"]);
    expect(planWbs([]).projectDuration).toBe(0);
  });

  it("soma custos em centavos sem erro de ponto flutuante", () => {
    const plan = planWbs([
      { id: "r", parentId: null, name: "R" },
      { id: "a", parentId: "r", name: "A", duration: 1, plannedCost: 0.1 },
      { id: "b", parentId: "r", name: "B", duration: 1, plannedCost: 0.2 },
    ]);
    expect(plan.totalPlannedCost).toBe(0.3);
    expect(plan.byId.get("r")!.plannedCost).toBe(0.3);
  });

  it("usa média simples do progresso quando todas as folhas têm duração zero", () => {
    const plan = planWbs([
      { id: "r", parentId: null, name: "R" },
      { id: "m1", parentId: "r", name: "M1", duration: 0, percentComplete: 100 },
      { id: "m2", parentId: "r", name: "M2", duration: 0, percentComplete: 0 },
    ]);
    expect(plan.byId.get("r")!.percentComplete).toBe(50);
  });

  it("rejeita EAPs inválidas", () => {
    const tweak = (fn: (n: WbsNodeInput[]) => void) => {
      const n = sampleWbs();
      fn(n);
      return n;
    };
    expect(() => planWbs(tweak((n) => n.push({ id: "A", parentId: "1", name: "dup", duration: 1 })))).toThrowError(/duplicado/);
    expect(() => planWbs(tweak((n) => n.push({ id: "Z", parentId: "nope", name: "Z", duration: 1 })))).toThrowError(/pai inexistente/);
    expect(() => planWbs(tweak((n) => (n[3]!.duration = 3)))).toThrowError(/resumo S/);
    expect(() => planWbs(tweak((n) => (n[1]!.duration = undefined)))).toThrowError(/precisa de duração/);
    expect(() => planWbs(tweak((n) => (n[1]!.percentComplete = 120)))).toThrowError(PmoError);
    expect(() => planWbs(tweak((n) => (n[1]!.plannedCost = -1)))).toThrowError(PmoError);
    expect(() => planWbs(tweak((n) => (n[4]!.predecessors = [{ id: "S" }])))).toThrowError(/resumo S/);
    expect(() => planWbs(tweak((n) => (n[4]!.predecessors = [{ id: "ghost" }])))).toThrowError(/não existe/);
    expect(() =>
      planWbs([
        { id: "x", parentId: "y", name: "X", duration: 1 },
        { id: "y", parentId: "x", name: "Y" },
      ]),
    ).toThrowError(/Ciclo/);
    expect(() => planWbs([{ id: "x", parentId: "x", name: "X", duration: 1 }])).toThrowError(PmoError);
  });
});

describe("baseline", () => {
  it("é imutável", () => {
    const b = createBaseline("Base 1", "2026-11-04", planWbs(sampleWbs()));
    expect(b.items).toHaveLength(4);
    expect(b.projectDuration).toBe(19);
    expect(b.totalCost).toBe(4500.5);
    expect(Object.isFrozen(b)).toBe(true);
    expect(() => {
      (b as { name: string }).name = "x";
    }).toThrow();
    expect(() => {
      (b.items[0] as { start: number }).start = 9;
    }).toThrow();
  });

  it("compara atraso, custo, atividades novas e removidas", () => {
    const base = createBaseline("Base 1", "2026-11-04", planWbs(sampleWbs()));
    const changed = sampleWbs();
    changed[2]!.duration = 12; // B +2 dias
    changed[2]!.plannedCost = 2600.5; // B +100
    changed.push({ id: "E", parentId: "1", name: "Paisagismo", duration: 1, plannedCost: 300, predecessors: [{ id: "A" }] });
    const cmp = compareToBaseline(base, planWbs(changed.filter((n) => n.id !== "D")));

    const by = Object.fromEntries(cmp.items.map((i) => [i.id, i]));
    expect(by.A!.status).toBe("no_prazo");
    expect(by.B).toMatchObject({ finishVariance: 2, durationVariance: 2, costVariance: 100, status: "atrasada" });
    expect(by.C).toMatchObject({ startVariance: 2, finishVariance: 2, status: "atrasada" });
    expect(by.E).toMatchObject({ status: "nova", costVariance: 300 });
    expect(cmp.removed).toEqual(["D"]);
    expect(cmp.projectDurationVariance).toBe(2);
    // +100 (B) +300 (E) −200 (D removida)
    expect(cmp.costVariance).toBe(200);
  });

  it("marca atividades adiantadas e valida os argumentos", () => {
    const base = createBaseline("Base 1", "2026-11-04", planWbs(sampleWbs()));
    const faster = sampleWbs();
    faster[1]!.duration = 3;
    const cmp = compareToBaseline(base, planWbs(faster));
    expect(cmp.items.find((i) => i.id === "A")!.status).toBe("adiantada");
    expect(cmp.projectDurationVariance).toBe(-2);
    expect(() => createBaseline(" ", "2026-11-04", planWbs(sampleWbs()))).toThrowError(PmoError);
    expect(() => createBaseline("x", "04/11/2026", planWbs(sampleWbs()))).toThrowError(PmoError);
  });
});

import { describe, expect, it } from "vitest";
import { PmoError, curveWeights, expandAssignments, resourceCosts, resourceHistogram } from "../src";

describe("curvas de alocação", () => {
  it("média 1 em qualquer curva (preserva dias-pessoa) e formato esperado", () => {
    for (const c of ["linear", "inicio", "fim", "sino"] as const) {
      const w = curveWeights(c, 7);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(7, 4);
    }
    const ini = curveWeights("inicio", 4);
    expect(ini[0]!).toBeGreaterThan(ini[3]!);
    const fim = curveWeights("fim", 4);
    expect(fim[3]!).toBeGreaterThan(fim[0]!);
    const sino = curveWeights("sino", 9);
    expect(sino[4]!).toBeGreaterThan(sino[0]!);
    expect(sino[4]!).toBeGreaterThan(sino[8]!);
    expect(curveWeights("linear", 0)).toEqual([]);
    expect(() => curveWeights("x" as any, 3)).toThrow(PmoError);
  });
});

describe("expandir atribuições", () => {
  const base = { startDate: "2026-11-02" }; // segunda
  it("sem curva nem folga, não muda nada", () => {
    expect(expandAssignments([{ resource: "A", units: 2, start: 0, finish: 5 }], base)).toEqual([{ resource: "A", units: 2, start: 0, finish: 5 }]);
  });
  it("curva no início: carga cai ao longo dos dias, mesmo total", () => {
    const seg = expandAssignments([{ resource: "A", units: 1, start: 0, finish: 4, curve: "inicio" }], base);
    expect(seg.length).toBeGreaterThan(1);
    expect(seg[0]!.units).toBeGreaterThan(seg.at(-1)!.units!);
    const total = seg.reduce((t, s) => t + (s.finish - s.start) * (s.units ?? 1), 0);
    expect(total).toBeCloseTo(4, 3);
  });
  it("dias de folga do recurso zeram a carga e reduzem os dias-pessoa; funde trechos iguais", () => {
    const seg = expandAssignments([{ resource: "A", units: 1, start: 0, finish: 5 }], { ...base, daysOff: { A: ["2026-11-04"] } }); // quarta = dia 2
    expect(seg).toEqual([{ resource: "A", start: 0, finish: 2, units: 1 }, { resource: "A", start: 3, finish: 5, units: 1 }]);
    const costs = resourceCosts(seg, { A: 100 });
    expect(costs[0]).toMatchObject({ days: 4, cost: 400 });
  });
  it("alimenta o histograma: a folga tira a superalocação do dia", () => {
    const items = [{ resource: "A", units: 1, start: 0, finish: 5 }, { resource: "A", units: 1, start: 2, finish: 3 }];
    expect(resourceHistogram(expandAssignments(items, base)).hasOverallocation).toBe(true);
    expect(resourceHistogram(expandAssignments(items, { ...base, daysOff: { A: ["2026-11-04"] } })).hasOverallocation).toBe(false);
  });
  it("atribuição de duração zero é ignorada", () => {
    expect(expandAssignments([{ resource: "A", units: 1, start: 3, finish: 3, curve: "fim" }], base)).toEqual([]);
  });
});

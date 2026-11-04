import { describe, expect, it } from "vitest";
import { buildCostSheet, plannedSCurve, planWbs, PmoError, spreadFromPlan } from "../src";
import { sampleWbs } from "./fixtures";

const codes = [
  { id: "1", parentId: null, name: "Obra" },
  { id: "1.1", parentId: "1", name: "Civil" },
  { id: "1.2", parentId: "1", name: "Elétrica" },
  { id: "2", parentId: null, name: "Projetos" },
];

describe("buildCostSheet", () => {
  it("faz rollup de orçado, comprometido, realizado e previsão", () => {
    const sheet = buildCostSheet(codes, [
      { id: "L1", codeId: "1.1", budget: 1000, committed: 800, actual: 300 },
      { id: "L2", codeId: "1.1", budget: 500, committed: 700, actual: 100 },
      { id: "L3", codeId: "1.2", budget: 400, actual: 100, etc: 250 },
      { id: "L4", codeId: "2", budget: 200, actual: 250 },
    ]);
    expect(sheet.rows.map((r) => r.codeId)).toEqual(["1", "1.1", "1.2", "2"]);
    expect(sheet.rows.map((r) => r.level)).toEqual([0, 1, 1, 0]);

    const civil = sheet.rows[1]!;
    expect(civil).toMatchObject({ budget: 1500, committed: 1500, actual: 400, forecast: 1700, variance: -200 });
    expect(sheet.rows[2]).toMatchObject({ budget: 400, actual: 100, forecast: 350, variance: 50 });
    expect(sheet.rows[0]).toMatchObject({ budget: 1900, committed: 1500, actual: 500, forecast: 2050, variance: -150 });
    expect(sheet.rows[3]).toMatchObject({ budget: 200, actual: 250, forecast: 250, variance: -50 });
    expect(sheet.totals).toEqual({ budget: 2100, committed: 1500, actual: 750, forecast: 2300, variance: -200 });
  });

  it("aceita linhas em códigos que também têm filhos e soma sem erro de ponto flutuante", () => {
    const sheet = buildCostSheet(codes, [
      { id: "a", codeId: "1", budget: 0.1 },
      { id: "b", codeId: "1.1", budget: 0.2 },
    ]);
    expect(sheet.rows[0]!.budget).toBe(0.3);
    expect(sheet.totals.budget).toBe(0.3);
  });

  it("rejeita dados inválidos", () => {
    expect(() => buildCostSheet(codes, [{ id: "x", codeId: "9", budget: 1 }])).toThrowError(/inexistente/);
    expect(() => buildCostSheet(codes, [{ id: "x", codeId: "1", budget: -1 }])).toThrowError(PmoError);
    expect(() => buildCostSheet(codes, [{ id: "x", codeId: "1", budget: 1, etc: -5 }])).toThrowError(PmoError);
    expect(() => buildCostSheet([...codes, { id: "1", parentId: null, name: "dup" }], [])).toThrowError(/duplicado/);
    expect(() =>
      buildCostSheet(
        [
          { id: "a", parentId: "b", name: "A" },
          { id: "b", parentId: "a", name: "B" },
        ],
        [],
      ),
    ).toThrowError(/Ciclo/);
  });
});

describe("plannedSCurve", () => {
  const items = [
    { id: "A", start: 0, finish: 3, cost: 100 },
    { id: "B", start: 3, finish: 5, cost: 50 },
  ];

  it("distribui em centavos e acumula por período", () => {
    const week = plannedSCurve(items, 5);
    expect(week).toEqual([{ period: 0, fromDay: 0, toDay: 5, amount: 150, cumulative: 150 }]);

    const pts = plannedSCurve(items, 2);
    expect(pts.map((p) => p.amount)).toEqual([66.67, 58.33, 25]);
    expect(pts.map((p) => p.cumulative)).toEqual([66.67, 125, 150]);
    expect(pts.map((p) => [p.fromDay, p.toDay])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ]);
  });

  it("coloca o custo de marcos no dia de início", () => {
    const pts = plannedSCurve(
      [
        { id: "A", start: 0, finish: 2, cost: 20 },
        { id: "M", start: 2, finish: 2, cost: 5 },
      ],
      1,
    );
    expect(pts.map((p) => p.amount)).toEqual([10, 10, 5]);
    expect(pts.map((p) => p.cumulative)).toEqual([10, 20, 25]);
  });

  it("o acumulado final iguala o custo total (sem perda de centavos)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 100; round++) {
      const list = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => {
        const start = Math.floor(rand() * 20);
        return { id: `T${i}`, start, finish: start + Math.floor(rand() * 9), cost: Math.round(rand() * 1_000_000) / 100 };
      });
      const totalCents = list.reduce((acc, it) => acc + Math.round(it.cost * 100), 0);
      const pts = plannedSCurve(list, 1 + Math.floor(rand() * 6));
      expect(pts.at(-1)!.cumulative).toBe(totalCents / 100);
      for (let i = 1; i < pts.length; i++) expect(pts[i]!.cumulative).toBeGreaterThanOrEqual(pts[i - 1]!.cumulative);
    }
  });

  it("usa a EAP como base", () => {
    const pts = plannedSCurve(spreadFromPlan(planWbs(sampleWbs())), 5);
    expect(pts.at(-1)!.cumulative).toBe(4500.5);
    expect(pts).toHaveLength(4); // 19 dias em semanas de 5
  });

  it("trata casos vazios e rejeita entradas inválidas", () => {
    expect(plannedSCurve([])).toEqual([]);
    expect(() => plannedSCurve(items, 0)).toThrowError(PmoError);
    expect(() => plannedSCurve([{ id: "x", start: 3, finish: 2, cost: 1 }])).toThrowError(PmoError);
    expect(() => plannedSCurve([{ id: "x", start: 0, finish: 2, cost: -1 }])).toThrowError(PmoError);
  });
});

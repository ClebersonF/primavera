import { describe, expect, it } from "vitest";
import { deadlineChecks, EMPTY_PLANNING, normalizePlanning, primaryBaselineOf, withActivityPlan, withPrimaryBaseline, withBaseline, describePlanningChange, PmoError } from "../src";

const bl = (name: string) => ({ name, createdAt: "2026-01-01", projectDuration: 1, totalCost: 0, items: [] });

describe("Terminar até", () => {
  it("sobra, limite e atraso em dias úteis", () => {
    const r = deadlineChecks([
      { id: "a", finishDate: "2026-03-02", deadline: "2026-03-06" }, // seg → sex
      { id: "b", finishDate: "2026-03-06", deadline: "2026-03-06" },
      { id: "c", finishDate: "2026-03-10", deadline: "2026-03-06" }, // ter, 2 úteis depois
      { id: "d", finishDate: "2026-03-10" },
    ]);
    expect(r.map((x) => [x.id, x.slackDays, x.violated])).toEqual([["a", 4, false], ["b", 0, false], ["c", -2, true]]);
  });
  it("usa o término real quando existe", () => {
    const [c] = deadlineChecks([{ id: "a", finishDate: "2026-03-20", actualFinish: "2026-03-05", deadline: "2026-03-06" }]);
    expect(c).toMatchObject({ basis: "real", violated: false });
  });
  it("valida, grava e apaga o prazo; recusa data inválida", () => {
    const p = withActivityPlan(EMPTY_PLANNING, "x", { deadline: "2026-03-06" });
    expect(p.activityPlans.x?.deadline).toBe("2026-03-06");
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).activityPlans.x?.deadline).toBe("2026-03-06");
    expect(withActivityPlan(p, "x", { deadline: undefined }).activityPlans.x).toBeUndefined();
    expect(() => withActivityPlan(EMPTY_PLANNING, "x", { deadline: "2026-13-40" })).toThrow(PmoError);
  });
});

describe("Linha de base primária", () => {
  const two = withBaseline(withBaseline(EMPTY_PLANNING, bl("A")), bl("B"));
  it("padrão é a mais recente; escolha vale e é normalizada", () => {
    expect(primaryBaselineOf(two)?.name).toBe("B");
    const p = withPrimaryBaseline(two, 0);
    expect(primaryBaselineOf(p)?.name).toBe("A");
    expect(p.rev).toBe(two.rev + 1);
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).primaryBaseline).toBe(0);
    expect(normalizePlanning({ ...JSON.parse(JSON.stringify(p)), primaryBaseline: 9 }).primaryBaseline).toBeUndefined();
    expect(withPrimaryBaseline(p, undefined).primaryBaseline).toBeUndefined();
  });
  it("sem mudança devolve o mesmo objeto; índice inválido é recusado; histórico descreve", () => {
    expect(withPrimaryBaseline(two, undefined)).toBe(two);
    expect(() => withPrimaryBaseline(two, 5)).toThrow(PmoError);
    expect(describePlanningChange(two, withPrimaryBaseline(two, 0)).join()).toContain("primária: A");
  });
});

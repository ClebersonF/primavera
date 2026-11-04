import { describe, expect, it } from "vitest";
import {
  calendarOf,
  EMPTY_PLANNING,
  mergeActivityPlans,
  normalizePlanning,
  PmoError,
  planWbs,
  withActivityPlan,
  withHolidays,
  workToWbsInputs,
  type WorkLike,
} from "../src";

const work = (): WorkLike => ({
  id: "w",
  title: "Obra",
  kickoffAt: "2026-11-02T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  budgetBRL: 1000,
  activities: [
    { id: "a1", title: "A", status: "todo", durationDays: 5 },
    { id: "a2", title: "B", status: "todo", durationDays: 5 },
    { id: "a3", title: "C", status: "doing", durationDays: 5 },
  ],
});

describe("withActivityPlan / normalizePlanning", () => {
  it("grava, mescla e remove campos", () => {
    let p = withActivityPlan(EMPTY_PLANNING, "a2", { durationDays: 3, group: " Civil " });
    expect(p.activityPlans.a2).toEqual({ durationDays: 3, group: "Civil" });
    expect(p.rev).toBe(1);
    p = withActivityPlan(p, "a2", { group: "" , durationDays: undefined });
    expect(p.activityPlans.a2).toBeUndefined();
  });
  it("rejeita dados inválidos e auto-predecessora", () => {
    expect(() => withActivityPlan(EMPTY_PLANNING, "a1", { durationDays: -1 })).toThrow(PmoError);
    expect(() => withActivityPlan(EMPTY_PLANNING, "a1", { percentComplete: 101 })).toThrow(PmoError);
    expect(() => withActivityPlan(EMPTY_PLANNING, "a1", { notBefore: "2026-13-40" })).toThrow(PmoError);
    expect(() => withActivityPlan(EMPTY_PLANNING, "a1", { predecessors: [{ id: "a1" }] })).toThrow(PmoError);
    expect(() => withActivityPlan(EMPTY_PLANNING, "__proto__", { durationDays: 1 })).toThrow(PmoError);
  });
  it("normaliza lixo vindo do Odoo", () => {
    const n = normalizePlanning({
      activityPlans: { a1: { durationDays: "x" }, a2: { durationDays: 2, predecessors: [{ id: "a1", type: "SS", lag: 1 }] }, __proto__: { durationDays: 1 } },
      holidays: ["2026-11-20", "2026-11-20", "lixo", 5],
    });
    expect(Object.keys(n.activityPlans)).toEqual(["a2"]);
    expect(n.holidays).toEqual(["2026-11-20"]);
    expect(normalizePlanning(undefined).activityPlans).toEqual({});
  });
  it("feriados", () => {
    const p = withHolidays(EMPTY_PLANNING, ["2026-11-20", "2026-11-04", "2026-11-04"]);
    expect(p.holidays).toEqual(["2026-11-04", "2026-11-20"]);
    expect(() => withHolidays(p, ["x"])).toThrow(PmoError);
    expect(calendarOf(p).holidays).toEqual(p.holidays);
  });
});

describe("adaptador com cronograma por atividade", () => {
  const plan = (w: WorkLike, p = EMPTY_PLANNING) => {
    const cal = calendarOf(p);
    const merged = { ...w, activities: mergeActivityPlans(w.activities, p.activityPlans) };
    return planWbs(workToWbsInputs(merged, cal).inputs);
  };
  it("SS com defasagem, % manual e não-iniciar-antes-de entram no CPM", () => {
    const w = work();
    let p = withActivityPlan(EMPTY_PLANNING, "a2", { predecessors: [{ id: "a1", type: "SS", lag: 2 }] });
    p = withActivityPlan(p, "a3", { predecessors: [], percentComplete: 40, notBefore: "2026-11-16" });
    const r = plan(w, p);
    const by = Object.fromEntries(r.leaves.map((l) => [l.id, l]));
    expect(by.a2!.start).toBe(2);
    expect(by.a3!.start).toBe(10);
    expect(by.a3!.percentComplete).toBe(40);
  });
  it("predecessora inexistente é ignorada com premissa", () => {
    const w = work();
    const p = withActivityPlan(EMPTY_PLANNING, "a2", { predecessors: [{ id: "zzz" }] });
    const merged = { ...w, activities: mergeActivityPlans(w.activities, p.activityPlans) };
    const { assumptions } = workToWbsInputs(merged, calendarOf(p));
    expect(assumptions.some((a) => a.includes("zzz"))).toBe(true);
  });
});

describe("sem mudança", () => {
  it("withActivityPlan devolve o mesmo objeto quando nada muda", () => {
    const p = withActivityPlan(EMPTY_PLANNING, "a1", { durationDays: 3 });
    expect(withActivityPlan(p, "a1", { durationDays: 3 })).toBe(p);
    expect(withActivityPlan(EMPTY_PLANNING, "a1", { durationDays: undefined })).toBe(EMPTY_PLANNING);
  });
});

import { nextRiskId, riskLevel, riskMatrix, riskScore, withoutRisk, withRisk, type Risk } from "../src";

describe("riscos", () => {
  const r = (over: Partial<Risk> = {}): Risk => ({ id: "R-001", title: "Chuva", probability: 4, impact: 3, status: "aberto", ...over });
  it("cria, atualiza, remove e numera", () => {
    let p = withRisk(EMPTY_PLANNING, r());
    expect(nextRiskId(p)).toBe("R-002");
    expect(withRisk(p, r())).toBe(p);
    p = withRisk(p, r({ impact: 5, owner: " Ana " }));
    expect(p.risks).toHaveLength(1);
    expect(p.risks[0]).toMatchObject({ impact: 5, owner: "Ana" });
    expect(withoutRisk(p, "R-001").risks).toEqual([]);
    expect(withoutRisk(p, "zzz")).toBe(p);
  });
  it("rejeita níveis fora de 1..5 e status inválido", () => {
    expect(() => withRisk(EMPTY_PLANNING, r({ probability: 6 }))).toThrow(PmoError);
    expect(() => withRisk(EMPTY_PLANNING, r({ impact: 2.5 }))).toThrow(PmoError);
    expect(() => withRisk(EMPTY_PLANNING, r({ title: "  " }))).toThrow(PmoError);
    expect(() => withRisk(EMPTY_PLANNING, r({ status: "x" as never }))).toThrow(PmoError);
  });
  it("normaliza risco inválido/duplicado vindo de fora", () => {
    const n = normalizePlanning({ risks: [r(), r({ title: "dup" }), { id: "R-9" }, r({ id: "__proto__" })] });
    expect(n.risks.map((x) => x.id)).toEqual(["R-001"]);
  });
  it("exposição, nível e matriz ignoram encerrados", () => {
    expect(riskScore(r())).toBe(12);
    expect([riskLevel(1), riskLevel(5), riskLevel(10), riskLevel(15)]).toEqual(["baixo", "medio", "alto", "critico"]);
    const m = riskMatrix([r(), r({ id: "R-002", status: "encerrado" })]);
    expect(m).toHaveLength(25);
    expect(m.find((c) => c.probability === 4 && c.impact === 3)!.ids).toEqual(["R-001"]);
    expect(m.flatMap((c) => c.ids)).toEqual(["R-001"]);
  });
});

import { describePlanningChange, MAX_HISTORY, recordHistory } from "../src";

describe("histórico", () => {
  it("descreve mudanças e registra autor", () => {
    let p = withActivityPlan(EMPTY_PLANNING, "a1", { durationDays: 3 });
    p = withRisk(p, { id: "R-001", title: "x", probability: 1, impact: 1, status: "aberto" });
    const d = describePlanningChange(EMPTY_PLANNING, p);
    expect(d).toHaveLength(2);
    const h = recordHistory(EMPTY_PLANNING, p, " Ana ", "2026-11-04T10:00:00.000Z");
    expect(h.history.map((x) => x.by)).toEqual(["Ana", "Ana"]);
    expect(recordHistory(p, p, "Ana", "2026-11-04T10:00:00.000Z")).toBe(p);
  });
  it("limita o tamanho e normaliza entradas inválidas", () => {
    let p = EMPTY_PLANNING;
    for (let i = 0; i < MAX_HISTORY + 20; i++) p = recordHistory(p, withHolidays(p, [`2026-01-${String((i % 28) + 1).padStart(2, "0")}`, ...(i % 2 ? ["2027-01-01"] : [])]), "a", "2026-11-04T10:00:00.000Z");
    expect(p.history.length).toBeLessThanOrEqual(MAX_HISTORY);
    const n = normalizePlanning({ history: [{ at: "x", by: "a", summary: "s" }, { at: "2026-11-04T10:00:00Z", by: "a", summary: "ok" }, 5] });
    expect(n.history).toHaveLength(1);
  });
});

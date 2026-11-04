import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, PmoError, describePlanningChange, effectiveAssignments, groupByCode, nextCodeTypeId, normalizePlanning, withActivityPlan, withCodeType, withResourceCapacity, withoutCodeType } from "../src";

const t1 = { id: "T-1", name: "Fase do ciclo", values: ["Diagnóstico", "Plantio", "Monitoramento"] };

describe("atribuições de recursos", () => {
  it("grava, normaliza (arredonda unidades) e rejeita inválidas", () => {
    const p = withActivityPlan(EMPTY_PLANNING, "a1", { assignments: [{ resource: " Ana ", units: 0.5 }, { resource: "Engenheiro", units: 1.234 }] });
    expect(p.activityPlans.a1!.assignments).toEqual([{ resource: "Ana", units: 0.5 }, { resource: "Engenheiro", units: 1.23 }]);
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).activityPlans.a1).toEqual(p.activityPlans.a1);
    for (const bad of [[{ resource: "A", units: 0 }], [{ resource: "A", units: 21 }], [{ resource: "", units: 1 }], [{ resource: "A", units: 1 }, { resource: "A", units: 1 }], Array.from({ length: 11 }, (_, i) => ({ resource: `r${i}`, units: 1 }))]) {
      expect(() => withActivityPlan(EMPTY_PLANNING, "a1", { assignments: bad as any })).toThrow(PmoError);
    }
    expect(withActivityPlan(p, "a1", { assignments: undefined }).activityPlans.a1).toBeUndefined();
  });
  it("atribuições efetivas: planejadas ou o responsável do cadastro", () => {
    expect(effectiveAssignments(undefined, " Bia ")).toEqual([{ resource: "Bia", units: 1 }]);
    expect(effectiveAssignments(undefined, undefined)).toEqual([]);
    expect(effectiveAssignments({ assignments: [{ resource: "Ana", units: 2 }] }, "Bia")).toEqual([{ resource: "Ana", units: 2 }]);
  });
});

describe("capacidade de recursos", () => {
  it("define, remove, é idempotente, valida e descreve", () => {
    const a = withResourceCapacity(EMPTY_PLANNING, "Equipe de plantio", 3);
    expect(a.resourceCapacity).toEqual({ "Equipe de plantio": 3 });
    expect(withResourceCapacity(a, "Equipe de plantio", 3)).toBe(a);
    expect(describePlanningChange(EMPTY_PLANNING, a)).toContain("Capacidade de recursos alterada");
    expect(withResourceCapacity(a, "Equipe de plantio", undefined).resourceCapacity).toEqual({});
    expect(() => withResourceCapacity(a, "x", 0)).toThrow(PmoError);
    expect(() => withResourceCapacity(a, "x", 101)).toThrow(PmoError);
    expect(normalizePlanning({ resourceCapacity: { ok: 2, zero: 0, txt: "3" } }).resourceCapacity).toEqual({ ok: 2 });
  });
});

describe("códigos de atividade personalizados", () => {
  it("cria tipo, numera, valida valor ao atribuir e agrupa", () => {
    let p = withCodeType(EMPTY_PLANNING, { ...t1, values: [" Diagnóstico ", "Plantio", "Plantio", "", "Monitoramento"] });
    expect(p.codeTypes[0]!.values).toEqual(["Diagnóstico", "Plantio", "Monitoramento"]);
    expect(nextCodeTypeId(p)).toBe("T-2");
    expect(withCodeType(p, p.codeTypes[0]!)).toBe(p);
    p = withActivityPlan(p, "a1", { codes: { "T-1": "Plantio" } });
    p = withActivityPlan(p, "a2", { codes: { "T-1": "Plantio" } });
    expect(() => withActivityPlan(p, "a3", { codes: { "T-1": "Inventado" } })).toThrow(PmoError);
    expect(() => withActivityPlan(p, "a3", { codes: { "T-9": "x" } })).toThrow(PmoError);
    const g = groupByCode(["a1", "a2", "a3"], p.activityPlans, "T-1");
    expect([...g.entries()]).toEqual([["Plantio", ["a1", "a2"]], ["", ["a3"]]]);
    expect(describePlanningChange(EMPTY_PLANNING, p)).toContain("Código de atividade criado: Fase do ciclo");
  });
  it("tirar um valor ou o tipo limpa as atividades que o usavam", () => {
    let p = withCodeType(EMPTY_PLANNING, t1);
    p = withActivityPlan(p, "a1", { codes: { "T-1": "Plantio" }, durationDays: 3 });
    p = withActivityPlan(p, "a2", { codes: { "T-1": "Diagnóstico" } });
    const semPlantio = withCodeType(p, { ...t1, values: ["Diagnóstico", "Monitoramento"] });
    expect(semPlantio.activityPlans.a1).toEqual({ durationDays: 3 });
    expect(semPlantio.activityPlans.a2!.codes).toEqual({ "T-1": "Diagnóstico" });
    const semTipo = withoutCodeType(p, "T-1");
    expect(semTipo.codeTypes).toEqual([]);
    expect(semTipo.activityPlans.a2).toBeUndefined();
    expect(semTipo.activityPlans.a1).toEqual({ durationDays: 3 });
    expect(withoutCodeType(p, "T-9")).toBe(p);
  });
  it("normalização descarta códigos órfãos e tipos inválidos", () => {
    const n = normalizePlanning({ codeTypes: [t1, t1, { id: "T-2", name: "", values: [] }], activityPlans: { a1: { codes: { "T-1": "Plantio", "T-1x": "?", } }, a2: { codes: { "T-1": "Outro" } } } });
    expect(n.codeTypes).toHaveLength(1);
    expect(n.activityPlans.a1!.codes).toEqual({ "T-1": "Plantio" });
    expect(n.activityPlans.a2).toBeUndefined();
  });
  it("limites", () => {
    expect(() => withCodeType(EMPTY_PLANNING, { id: "T-1", name: "  ", values: [] })).toThrow(PmoError);
    expect(() => withCodeType(EMPTY_PLANNING, { id: "T-1", name: "n", values: Array.from({ length: 51 }, (_, i) => `v${i}`) })).toThrow(PmoError);
  });
});

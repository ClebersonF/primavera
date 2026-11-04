import { describe, expect, it } from "vitest";
import { applyScenario, compareScenario, EMPTY_PLANNING, nextScenarioId, normalizePlanning, PmoError, withoutScenario, withScenario, type Scenario, type WbsNodeInput } from "../src";

const inputs = (): WbsNodeInput[] => [
  { id: "r", parentId: null, name: "Obra" },
  { id: "a", parentId: "r", name: "A", duration: 5, plannedCost: 1000 },
  { id: "b", parentId: "r", name: "B", duration: 5, plannedCost: 2000, predecessors: [{ id: "a" }] },
  { id: "c", parentId: "r", name: "C", duration: 2, plannedCost: 500 },
];
const sc = (over: Partial<Scenario> = {}): Scenario => ({ id: "CEN-001", name: "Teste", changes: [], ...over });

describe("cenários", () => {
  it("duração e atraso na crítica deslocam o prazo; o plano original fica intacto", () => {
    const base = inputs();
    const cmp = compareScenario(base, sc({ changes: [{ activityId: "a", durationDelta: 3 }, { activityId: "b", delayDays: 2 }] }));
    expect(cmp.durationBefore).toBe(10);
    expect(cmp.durationAfter).toBe(15);
    expect(cmp.durationDelta).toBe(5);
    expect(cmp.finishShifts.map((s) => s.id)).toEqual(["a", "b"]);
    expect(base[1]!.duration).toBe(5);
    expect(base[2]!.predecessors![0]!.lag).toBeUndefined();
  });
  it("atraso em atividade sem predecessora usa 'não iniciar antes de'; folga absorve", () => {
    const cmp = compareScenario(inputs(), sc({ changes: [{ activityId: "c", delayDays: 3 }] }));
    expect(cmp.durationDelta).toBe(0);
    expect(cmp.finishShifts).toEqual([{ id: "c", name: "C", deltaDays: 3 }]);
  });
  it("custo: fator global × fator da atividade, em centavos", () => {
    const cmp = compareScenario(inputs(), sc({ costFactor: 1.1, changes: [{ activityId: "a", costFactor: 2 }] }));
    expect(cmp.costBefore).toBe(3500);
    expect(cmp.costAfter).toBe(2200 + 2200 + 550);
  });
  it("rejeita atividade inexistente, resumo, duração negativa e valores inválidos", () => {
    expect(() => applyScenario(inputs(), sc({ changes: [{ activityId: "zzz", delayDays: 1 }] }))).toThrow(PmoError);
    expect(() => applyScenario(inputs(), sc({ changes: [{ activityId: "r", delayDays: 1 }] }))).toThrow(PmoError);
    expect(() => applyScenario(inputs(), sc({ changes: [{ activityId: "a", durationDelta: -9 }] }))).toThrow(PmoError);
    expect(() => applyScenario(inputs(), sc({ costFactor: 0 }))).toThrow(PmoError);
    expect(() => applyScenario(inputs(), sc({ changes: [{ activityId: "a", delayDays: -1 }] }))).toThrow(PmoError);
    expect(() => applyScenario(inputs(), sc({ changes: [{ activityId: "a" }, { activityId: "a" }] }))).toThrow(PmoError);
  });
  it("persistência: grava, dedupe, remove e normaliza", () => {
    let p = withScenario(EMPTY_PLANNING, sc({ name: " Chuva " }));
    expect(p.scenarios[0]!.name).toBe("Chuva");
    expect(nextScenarioId(p)).toBe("CEN-002");
    expect(withScenario(p, sc({ name: "Chuva" }))).toBe(p);
    expect(() => withScenario(p, sc({ name: "" }))).toThrow(PmoError);
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).scenarios).toEqual(p.scenarios);
    expect(normalizePlanning({ scenarios: [{ id: "x", name: "", changes: [] }, sc(), sc({ name: "dup" })] }).scenarios).toHaveLength(1);
    expect(withoutScenario(p, "CEN-001").scenarios).toEqual([]);
    expect(withoutScenario(p, "nada")).toBe(p);
  });
});

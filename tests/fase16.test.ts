import { describe, expect, it } from "vitest";
import { EMPTY_LICENSING, EMPTY_PLANNING, applyLicensingGates, graprohabGate, withActivityPlan } from "../src";

describe("marco liberado pelo GRAPROHAB", () => {
  it("usa a certidão emitida; sem ela, projeta pelo fluxo; sem nada, null", () => {
    expect(graprohabGate(undefined)).toBeNull();
    expect(graprohabGate(EMPTY_LICENSING)).toBeNull();
    expect(graprohabGate({ ...EMPTY_LICENSING, issuedOn: "2027-01-15" })).toEqual({ date: "2027-01-15", source: "emitida" });
    // 5+5+30+10+5 = 55 dias úteis a partir de 04/01/2027 (segunda): termina em 22/03/2027
    const g = graprohabGate({ ...EMPTY_LICENSING, start: "2027-01-04" });
    expect(g?.source).toBe("prevista");
    expect(g!.date > "2027-03-10" && g!.date < "2027-03-31").toBe(true);
    const c = graprohabGate({ ...EMPTY_LICENSING, start: "2027-01-04", withComunique: true });
    expect(c!.date > g!.date).toBe(true);
    // prazo digitado vale; texto inválido é ignorado
    const d = graprohabGate({ ...EMPTY_LICENSING, start: "2027-01-04", days: { analise: "60", protocolo: "abc" } });
    expect(d!.date > g!.date).toBe(true);
  });
  it("só atividades marcadas ganham 'não iniciar antes de', respeitando data mais tardia", () => {
    const acts = [{ id: "a" }, { id: "g", gate: "graprohab" as const }, { id: "h", gate: "graprohab" as const, notBefore: "2030-01-01" }];
    const r = applyLicensingGates(acts, { ...EMPTY_LICENSING, issuedOn: "2027-02-01" });
    expect(r.activities[0]).toEqual({ id: "a" });
    expect(r.activities[1]!.notBefore).toBe("2027-02-01");
    expect(r.activities[2]!.notBefore).toBe("2030-01-01");
    expect(r.applied).toHaveLength(2);
    expect(applyLicensingGates(acts, EMPTY_LICENSING).applied).toEqual([]);
  });
  it("o plano da atividade aceita gate e recusa outro valor", () => {
    expect(withActivityPlan(EMPTY_PLANNING, "g", { gate: "graprohab" }).activityPlans.g?.gate).toBe("graprohab");
    expect(() => withActivityPlan(EMPTY_PLANNING, "g", { gate: "x" as any })).toThrow();
  });
});

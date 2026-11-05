import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, EMPTY_PLANNING, NO_PROGRAM, PmoError, describePlanningChange, evaluateThresholds, nextIssueId, normalizePlanning, overdueIssues, rollupPrograms, validateThresholds, withIssue, withProgram, withoutIssue } from "../src";

const q = (id: string, extra = {}) => ({ id, title: "Assoreamento da nascente", status: "aberta" as const, priority: 2 as const, ...extra });

describe("questões (issues)", () => {
  it("cria, atualiza, remove, numera e não bumpa rev em no-op", () => {
    const a = withIssue(EMPTY_PLANNING, q("Q-1", { dueDate: "2026-11-01", owner: " Ana " }));
    expect(a.issues[0]).toEqual(q("Q-1", { dueDate: "2026-11-01", owner: "Ana" }));
    expect(a.rev).toBe(1);
    expect(withIssue(a, a.issues[0]!)).toBe(a);
    expect(nextIssueId(a)).toBe("Q-2");
    const b = withIssue(a, { ...a.issues[0]!, status: "resolvida", resolution: "Barreira instalada" });
    expect(describePlanningChange(a, b)).toContain("Questão Q-1 atualizada (aberta → resolvida)");
    expect(withoutIssue(b, "Q-1").issues).toEqual([]);
    expect(withoutIssue(b, "Q-9")).toBe(b);
  });
  it("valida entrada e normaliza JSON salvo", () => {
    expect(() => withIssue(EMPTY_PLANNING, q("Q-1", { priority: 4 }))).toThrow(PmoError);
    expect(() => withIssue(EMPTY_PLANNING, q("Q-1", { dueDate: "01/11/2026" }))).toThrow(PmoError);
    expect(() => withIssue(EMPTY_PLANNING, q("Q-1", { title: "  " }))).toThrow(PmoError);
    const p = withIssue(EMPTY_PLANNING, q("Q-1"));
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).issues).toEqual(p.issues);
    expect(normalizePlanning({ issues: [q("Q-1"), q("Q-1"), { id: "x" }] }).issues).toHaveLength(1);
    expect(normalizePlanning({}).issues).toEqual([]);
  });
  it("vencidas: só não resolvidas com prazo anterior a hoje", () => {
    const list = [q("Q-1", { dueDate: "2026-10-01" }), q("Q-2", { dueDate: "2026-10-01", status: "resolvida" }), q("Q-3", { dueDate: "2026-11-04" }), q("Q-4")];
    expect(overdueIssues(list, "2026-11-04").map((x) => x.id)).toEqual(["Q-1"]);
  });
});

describe("programa", () => {
  it("define, limpa, é idempotente e persiste", () => {
    const a = withProgram(EMPTY_PLANNING, " Restauração do Rio Pardo ");
    expect(a.program).toBe("Restauração do Rio Pardo");
    expect(withProgram(a, "Restauração do Rio Pardo")).toBe(a);
    expect(describePlanningChange(EMPTY_PLANNING, a)).toContain("Programa: Restauração do Rio Pardo");
    expect(normalizePlanning(JSON.parse(JSON.stringify(a))).program).toBe(a.program);
    const c = withProgram(a, "");
    expect(c.program).toBeUndefined();
    expect("program" in c).toBe(false);
    expect(() => withProgram(a, "x".repeat(121))).toThrow(PmoError);
    expect(withProgram(EMPTY_PLANNING, undefined)).toBe(EMPTY_PLANNING);
  });
});

describe("limiares", () => {
  const ok = { spi: 1, cpi: 1, daysToDeadline: 90, severeRisks: 0, overdueIssues: 0 };
  it("sem desvio, sem alerta", () => expect(evaluateThresholds(ok)).toEqual([]));
  it("atenção e crítico, com críticos primeiro", () => {
    const al = evaluateThresholds({ ...ok, spi: 0.9, cpi: 0.7, daysToDeadline: -5, severeRisks: 1, overdueIssues: 3, deadlineViolations: 2 });
    expect(al[0]!.severity).toBe("critico");
    expect(al.map((a) => `${a.code}:${a.severity}`).sort()).toEqual(["cpi:critico", "prazo:critico", "questoes:critico", "restricoes:critico", "riscos:atencao", "spi:atencao"]);
    expect(al.map((a) => a.severity)).toEqual([...al.map((a) => a.severity)].sort((x, y) => Number(y === "critico") - Number(x === "critico")));
  });
  it("prazo próximo = atenção; sem dados não alerta", () => {
    expect(evaluateThresholds({ ...ok, daysToDeadline: 10 })[0]).toMatchObject({ code: "prazo", severity: "atencao" });
    expect(evaluateThresholds({ spi: null, cpi: null, daysToDeadline: null, severeRisks: 0, overdueIssues: 0 })).toEqual([]);
  });
  it("valida limiares", () => {
    expect(() => validateThresholds({ ...DEFAULT_THRESHOLDS, spiCritical: 1.2 })).toThrow(PmoError);
    expect(() => evaluateThresholds(ok, { ...DEFAULT_THRESHOLDS, deadlineWarnDays: -1 })).toThrow(PmoError);
    expect(() => validateThresholds({ ...DEFAULT_THRESHOLDS, severeRisksCritical: 0 })).toThrow(PmoError);
  });
});

describe("consolidação por programa", () => {
  it("soma, SPI ponderado por valor, impacto médio dos avaliados e ordem", () => {
    const r = rollupPrograms([
      { program: "Rio Pardo", budget: 100, pv: 50, ev: 40, impact: 0.8, hectares: 10, beneficiaries: 100, tco2e: 5, criticalAlerts: 1 },
      { program: "Rio Pardo", budget: 300, pv: 150, ev: 150, impact: null },
      { program: "Amazônia", budget: 10, pv: 0, ev: 0, impact: 0.4 },
      { budget: 5, pv: 5, ev: 5 },
    ]);
    expect(r.map((x) => x.program)).toEqual(["Amazônia", "Rio Pardo", NO_PROGRAM]);
    const rp = r[1]!;
    expect(rp).toMatchObject({ projects: 2, budget: 400, pv: 200, ev: 190, spi: 0.95, impact: 0.8, assessed: 1, hectares: 10, beneficiaries: 100, tco2e: 5, criticalAlerts: 1 });
    expect(r[0]!.spi).toBeNull();
    expect(r[2]!.impact).toBeNull();
    expect(rollupPrograms([])).toEqual([]);
  });
});

import { evaluateThresholds as evalLic } from "../src";
describe("alerta de licenciamento pendente", () => {
  it("avisa só quando sinalizado", () => {
    const base = { spi: 1, cpi: 1, daysToDeadline: 400, severeRisks: 0, overdueIssues: 0 };
    expect(evalLic(base).some((a) => a.code === "licenciamento")).toBe(false);
    const a = evalLic({ ...base, licensingPending: true }).find((x) => x.code === "licenciamento");
    expect(a?.severity).toBe("atencao");
  });
});

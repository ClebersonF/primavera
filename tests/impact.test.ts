import { describe, expect, it } from "vitest";
import { DEFAULT_PRIORITY_WEIGHTS, EMPTY_PLANNING, IMPACT_DIMENSIONS, PRIORITY_PRESETS, PmoError, describePlanningChange, impactIndex, normalizePlanning, prioritizePortfolio, withImpact } from "../src";

const sc = (n: number) => ({ ecological: n, climate: n, water: n, social: n });
const item = (id: string, impact: number | null | undefined, extra = {}) => ({ id, name: id, nature: "improvement" as const, budget: 1000, spi: 1, daysToDeadline: 60, impact, ...extra });

describe("impacto socioambiental", () => {
  it("índice 0..1 e validação", () => {
    expect(impactIndex({ scores: sc(5) })).toBe(1);
    expect(impactIndex({ scores: { ecological: 5, climate: 0, water: 0, social: 0 } })).toBe(0.25);
    expect(impactIndex(undefined)).toBeNull();
    expect(() => withImpact(EMPTY_PLANNING, { scores: { ...sc(1), social: 6 } })).toThrow(PmoError);
    expect(() => withImpact(EMPTY_PLANNING, { scores: { ...sc(1), water: 1.5 } })).toThrow(PmoError);
    expect(() => withImpact(EMPTY_PLANNING, { scores: sc(1), hectares: -1 })).toThrow(PmoError);
  });
  it("grava, normaliza, não duplica rev em no-op e descreve no histórico", () => {
    const p = withImpact(EMPTY_PLANNING, { scores: sc(4), hectares: 12.5, beneficiaries: 300, tco2e: 80, notes: " restauração " });
    expect(p.impact).toEqual({ scores: sc(4), hectares: 12.5, beneficiaries: 300, tco2e: 80, notes: "restauração" });
    expect(withImpact(p, { ...p.impact! })).toBe(p);
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).impact).toEqual(p.impact);
    expect(normalizePlanning({ impact: { scores: { ecological: 9 } } }).impact).toBeUndefined();
    expect(describePlanningChange(EMPTY_PLANNING, p)).toContain("Impacto socioambiental atualizado");
    expect(IMPACT_DIMENSIONS).toHaveLength(4);
  });
  it("padrão ignora o impacto; preset CALM o promove e aponta o que falta", () => {
    const items = [item("baixo", 0.1), item("alto", 0.9), item("semdado", null)];
    const padrao = prioritizePortfolio(items, DEFAULT_PRIORITY_WEIGHTS);
    expect(new Set(padrao.map((x) => x.score)).size).toBe(1); // tudo igual: impacto não pesa
    expect(padrao.every((x) => !x.missing.includes("impact"))).toBe(true);
    const calm = prioritizePortfolio(items, PRIORITY_PRESETS.impacto.weights);
    expect(calm.map((x) => x.id)).toEqual(["alto", "semdado", "baixo"]);
    expect(calm.find((x) => x.id === "semdado")!.missing).toContain("impact");
  });
  it("pesos antigos (sem impacto) continuam válidos", () => {
    const r = prioritizePortfolio([item("a", undefined)], { nature: 1, schedule: 1, deadline: 1, budget: 1 });
    expect(Number.isFinite(r[0]!.score)).toBe(true);
    expect(() => prioritizePortfolio([item("a", 0.5)], { nature: 0, schedule: 0, deadline: 0, budget: 0, impact: 0 })).toThrow(PmoError);
  });
});

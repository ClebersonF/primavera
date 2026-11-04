import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, levelResources, normalizePlanning, PmoError, resourceCosts, withResourceRate } from "../src";

describe("levelResources", () => {
  it("adia a atividade com mais folga e informa se cabe na folga", () => {
    const s = levelResources([
      { id: "a", resource: "Ana", start: 0, finish: 5, float: 0 },
      { id: "b", resource: "Ana", start: 2, finish: 6, float: 10 },
    ]);
    expect(s).toEqual([{ id: "b", resource: "Ana", delayDays: 3, withinFloat: true }]);
  });
  it("sinaliza adiamento além da folga", () => {
    const s = levelResources([
      { id: "a", resource: "Ana", start: 0, finish: 5, float: 0 },
      { id: "b", resource: "Ana", start: 0, finish: 5, float: 2 },
    ]);
    expect(s[0]).toMatchObject({ id: "b", delayDays: 5, withinFloat: false });
  });
  it("respeita capacidade 2, outros recursos e marcos", () => {
    const items = [
      { id: "a", resource: "X", start: 0, finish: 5, float: 0 },
      { id: "b", resource: "X", start: 0, finish: 5, float: 0 },
      { id: "m", resource: "X", start: 2, finish: 2, float: 0 },
      { id: "c", resource: "Y", start: 0, finish: 5, float: 0 },
    ];
    expect(levelResources(items, 2)).toEqual([]);
    expect(levelResources(items, 1)).toHaveLength(1);
    expect(() => levelResources(items, 0)).toThrow(PmoError);
  });
});

describe("resourceCosts / withResourceRate", () => {
  it("multiplica dias por diária e não assume zero sem diária", () => {
    const c = resourceCosts([{ resource: "Ana", start: 0, finish: 4 }, { resource: "Ana", start: 4, finish: 6, units: 0.5 }, { resource: "Bia", start: 0, finish: 3 }], { Ana: 300 });
    expect(c).toEqual([
      { resource: "Ana", days: 5, rate: 300, cost: 1500 },
      { resource: "Bia", days: 3, rate: null, cost: null },
    ]);
  });
  it("valida e normaliza diárias", () => {
    let p = withResourceRate(EMPTY_PLANNING, " Ana ", 250);
    expect(p.resourceRates).toEqual({ Ana: 250 });
    expect(withResourceRate(p, "Ana", 250)).toBe(p);
    expect(withResourceRate(p, "Ana", undefined).resourceRates).toEqual({});
    expect(() => withResourceRate(p, "Ana", -1)).toThrow(PmoError);
    expect(() => withResourceRate(p, "__proto__", 1)).toThrow(PmoError);
    expect(normalizePlanning({ resourceRates: { A: 1, B: -2, C: "x", __proto__: 3 } }).resourceRates).toEqual({ A: 1 });
  });
});

import { cleanLicensing, EMPTY_LICENSING, withLicensing, describePlanningChange } from "../src";

describe("licenciamento persistido", () => {
  const lic = { ...EMPTY_LICENSING, start: "2026-11-10", present: ["a", "a", "b"], days: { analise: "20" }, areas: { Planta: { total: "1000" } } };
  it("grava, deduplica e registra no histórico", () => {
    const p = withLicensing(EMPTY_PLANNING, lic);
    expect(p.licensing?.present).toEqual(["a", "b"]);
    expect(withLicensing(p, p.licensing!)).toBe(p);
    expect(describePlanningChange(EMPTY_PLANNING, p)).toEqual(["Licenciamento GRAPROHAB atualizado"]);
    expect(withLicensing(EMPTY_PLANNING, EMPTY_LICENSING)).toBe(EMPTY_PLANNING);
  });
  it("rejeita lixo e sobrevive à normalização", () => {
    expect(() => withLicensing(EMPTY_PLANNING, { ...lic, start: "2026-02-30" })).toThrow(PmoError);
    expect(() => withLicensing(EMPTY_PLANNING, { ...lic, river: "x".repeat(50) })).toThrow(PmoError);
    expect(cleanLicensing({ ...lic, days: { __proto__: "1", x: 5 } })).toBeNull();
    const p = withLicensing(EMPTY_PLANNING, lic);
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).licensing).toEqual(p.licensing);
    expect(normalizePlanning({ licensing: { start: 5 } }).licensing).toBeUndefined();
  });
});

import { assessWorkCbs, cleanTax, EMPTY_TAX, nextPurchaseId, withTax } from "../src";

describe("CBS da obra", () => {
  const st = { engineeringShare: 0.6, purchases: [{ id: "NF-001", category: "cloud" as const, cbsDestacada: 100, supplierIsRegularPJ: true }, { id: "NF-002", category: "folha_clt" as const, cbsDestacada: 50, supplierIsRegularPJ: true }] };
  it("apura débito, crédito elegível e saldo", () => {
    const { assessment, blendedRate } = assessWorkCbs(10000, st);
    expect(assessment.debit).toBeCloseTo(6000 * 0.0791 + 4000 * 0.113, 2);
    expect(assessment.credit).toBe(100);
    expect(blendedRate).toBeGreaterThan(0.09);
    expect(assessWorkCbs(0).assessment.position).toBe("zero");
  });
  it("grava, valida e numera", () => {
    const p = withTax(EMPTY_PLANNING, st);
    expect(withTax(p, st)).toBe(p);
    expect(withTax(EMPTY_PLANNING, EMPTY_TAX)).toBe(EMPTY_PLANNING);
    expect(nextPurchaseId(st)).toBe("NF-003");
    expect(() => withTax(p, { ...st, engineeringShare: 1.2 })).toThrow(PmoError);
    expect(() => withTax(p, { ...st, purchases: [st.purchases[0]!, st.purchases[0]!] })).toThrow(PmoError);
    expect(cleanTax({ ...st, purchases: [{ ...st.purchases[0], category: "xx" }] })).toBeNull();
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).tax).toEqual(p.tax);
    expect(normalizePlanning({ tax: { engineeringShare: "x" } }).tax).toBeUndefined();
  });
});

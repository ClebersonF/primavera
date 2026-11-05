import { describe, expect, it } from "vitest";
import { PmoError, evaluateFeasibility, irrMonthly, type FeasibilityInput } from "../src";

// Premissas e custos da planilha de viabilidade da Nova Marina.
const direct = (n: string, a: number, phase: "projeto" | "obra" = "obra") => ({ name: n, amount: a, phase });
const NOVA: FeasibilityInput = {
  grossArea: 276224.84,
  cessionRate: 0.5392,
  avgLotSize: 431,
  pricePerSqm: 1000,
  landCost: 8286745.2,
  directCosts: [
    direct("Projetos e licenciamento", 763706.437632, "projeto"),
    direct("Terraplenagem", 1527412.875264),
    direct("Pavimentação", 3563963.375616),
    direct("Drenagem pluvial", 1272844.06272),
    direct("Água", 3029368.8692736),
    direct("Energia elétrica", 1081917.453312),
    direct("Guias e sarjetas", 649150.4719872),
    direct("Paisagismo", 1514684.4346368),
    direct("Sinalização", 636422.03136),
    direct("Imprevistos", 670152.3990220801),
  ],
  indirectCosts: [
    { name: "Comissão", rateOfVgv: 0.05 },
    { name: "Marketing", rateOfVgv: 0.02 },
    { name: "Administrativas", amount: 1820167.0096896002 },
    { name: "Taxas e impostos", amount: 763706.437632 },
  ],
  profitTaxRate: 0.2,
  months: { project: 60, works: 48, sales: 12 },
  annualDiscountRate: 0.12,
};

describe("viabilidade de loteamento", () => {
  it("reproduz os totais da planilha", () => {
    const r = evaluateFeasibility(NOVA);
    expect(r.netArea).toBeCloseTo(127284.41, 1);
    expect(r.lots).toBeCloseTo(295.32, 1);
    expect(r.vgv).toBeCloseTo(127284406.27, 0);
    expect(r.directTotal).toBeCloseTo(14709622.41, 0);
    expect(r.indirectTotal).toBeCloseTo(11493781.89, 0);
    expect(r.costTotal).toBeCloseTo(34490149.5, 0);
    expect(r.grossProfit).toBeCloseTo(92794256.77, 0);
    expect(r.grossMargin).toBeCloseTo(0.729, 3);
    expect(r.profitTax).toBeCloseTo(18558851.35, 0);
    expect(r.netProfit).toBeCloseTo(74235405.42, 0);
    expect(r.breakEvenLots).toBeCloseTo(80.02, 1);
  });
  it("monta o fluxo mensal: terreno no mês 0, vendas no fim e caixa fecha com o lucro líquido", () => {
    const r = evaluateFeasibility(NOVA);
    expect(r.cashFlow).toHaveLength(120);
    expect(r.cashFlow[0]!.out).toBeGreaterThanOrEqual(8286745.2);
    expect(r.cashFlow.slice(0, 108).every((m) => m.in === 0)).toBe(true);
    expect(r.cashFlow[119]!.cumulative).toBeCloseTo(r.netProfit, 0);
    expect(r.peakExposure).toBeGreaterThan(20_000_000);
    expect(r.paybackMonth).toBeGreaterThanOrEqual(108);
    expect(r.irrAnnual).not.toBeNull();
    expect(r.npv).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes("Cedências"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("Margem bruta"))).toBe(true);
  });
  it("antecipar as vendas melhora a TIR e reduz a exposição", () => {
    const seq = evaluateFeasibility(NOVA);
    const early = evaluateFeasibility({ ...NOVA, salesStartMonth: 60 });
    expect(early.irrAnnual!).toBeGreaterThan(seq.irrAnnual!);
    expect(early.cashFlow).toHaveLength(108);
    expect(early.peakExposure).toBeLessThanOrEqual(seq.peakExposure);
  });
  it("TIR: fluxo simples e sem troca de sinal", () => {
    expect(irrMonthly([-100, 110])!).toBeCloseTo(0.1, 5);
    expect(irrMonthly([100, 110])).toBeNull();
  });
  it("valida entradas", () => {
    expect(() => evaluateFeasibility({ ...NOVA, cessionRate: 1 })).toThrow(PmoError);
    expect(() => evaluateFeasibility({ ...NOVA, grossArea: 0 })).toThrow(PmoError);
    expect(() => evaluateFeasibility({ ...NOVA, months: { project: 1, works: 1, sales: 0 } })).toThrow(PmoError);
    expect(() => evaluateFeasibility({ ...NOVA, indirectCosts: [{ name: "x", amount: 1, rateOfVgv: 0.1 }] })).toThrow(PmoError);
    expect(() => evaluateFeasibility({ ...NOVA, directCosts: [{ name: "x", amount: -1, phase: "obra" }] })).toThrow(PmoError);
  });
});

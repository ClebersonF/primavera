import { describe, expect, it } from "vitest";
import { PmoError, collectNumbers, compareRegimes, parseTaxAiAnalysis, regimeLevers, unverifiedAmounts, type RegimeInput } from "../src";

// Caso da tela do usuário: R$ 5 mi de receita, só pró-labore, 20% de lucro, 100% B2B, ISS 2%, 2027, sem Simples.
const caso: RegimeInput = { revenue: 5_000_000, payrollClt: 0, proLabore: 1_340_000, creditablePurchases: 250_000, realProfitMargin: 0.2, b2bShare: 1, issRate: 0.02, year: 2027, simplesAvailable: false };

describe("alavancas de economia", () => {
  it("situação atual: Simples fora (acima de R$ 4,8 mi) e melhor regime entre Presumido e Real", () => {
    const l = regimeLevers(caso);
    const c = l.current.comparison;
    expect(c.scenarios.find((s) => s.id === "simples")!.available).toBe(false);
    expect(["presumido", "real"]).toContain(l.current.best);
    expect(l.current.deltaVsCurrent).toBe(0);
    expect(l.gapToSecond).toBeGreaterThan(0);
    expect(l.breakEvenMargin).toBeCloseTo(0.32, 10);
  });
  it("cada cenário muda uma premissa e recalcula; economia é relativa ao melhor atual", () => {
    const l = regimeLevers(caso);
    const ids = l.scenarios.map((s) => s.id);
    expect(ids).toEqual(["margem_menor", "margem_maior", "so_pf", "com_simples", "regime_pleno"]);
    const menor = l.scenarios.find((s) => s.id === "margem_menor")!;
    const real = (m: number) => compareRegimes({ ...caso, realProfitMargin: m }).scenarios.find((s) => s.id === "real")!.total;
    expect(real(0.1)).toBeLessThan(real(0.2));
    expect(menor.bestTotal).toBeLessThanOrEqual(l.current.bestTotal!);
    expect(menor.deltaVsCurrent).toBe(Math.round((menor.bestTotal! - l.current.bestTotal!) * 100) / 100);
  });
  it("Fator R só aparece quando falta folha e o Simples cabe na receita", () => {
    const pequeno = { ...caso, revenue: 1_200_000, proLabore: 60_000, simplesAvailable: true };
    const fr = regimeLevers(pequeno).scenarios.find((s) => s.id === "fator_r")!;
    expect(fr.change).toContain("R$ 276.000,00");
    const simples = fr.comparison.scenarios.find((s) => s.id === "simples")!;
    expect(simples.lines[0]!.label).toMatch(/Anexo III/);
    expect(regimeLevers(caso).scenarios.some((s) => s.id === "fator_r")).toBe(false);
  });
});

describe("análise por IA — leitura e conferência", () => {
  const ok = JSON.stringify({
    resumo: "Lucro Real é o menor.",
    recomendacao: { regime: "Lucro Real", justificativa: "Margem abaixo de 32%." },
    economias: [{ titulo: "Margem", detalhe: "R$ 100,00 a menos" }, { titulo: "", detalhe: "" }],
    riscos: ["CBS não fixada", 3],
    perguntasContador: ["Qual o anexo?"],
    proximosPassos: [{ quando: "dez/2026", acao: "Confirmar regime" }, { quando: "x" }],
  });
  it("aceita JSON cercado de texto e descarta itens vazios", () => {
    const a = parseTaxAiAnalysis("Segue:\n```json\n" + ok + "\n```");
    expect(a.recomendacao.regime).toBe("Lucro Real");
    expect(a.economias).toHaveLength(1);
    expect(a.riscos).toEqual(["CBS não fixada"]);
    expect(a.proximosPassos).toEqual([{ quando: "dez/2026", acao: "Confirmar regime" }]);
  });
  it("rejeita resposta sem JSON, ilegível ou vazia", () => {
    expect(() => parseTaxAiAnalysis("não sei")).toThrow(PmoError);
    expect(() => parseTaxAiAnalysis("{ruim}")).toThrow(/ilegível/);
    expect(() => parseTaxAiAnalysis("{}")).toThrow(/vazia/);
  });
  it("aponta valor em reais que não vem do cálculo (aceita soma, diferença, arredondamento e 'mil')", () => {
    const known = collectNumbers({ a: 156_360, b: { c: [262_680.4, 0.13] }, d: "x" });
    expect(known).toEqual([156_360, 262_680.4, 0.13]);
    expect(unverifiedAmounts("Total de R$ 156.360,00 e R$ 262.680,40.", known)).toEqual([]);
    expect(unverifiedAmounts("Diferença de R$ 106.320,40.", known)).toEqual([]);
    expect(unverifiedAmounts("Soma de R$ 419.040,40.", known)).toEqual([]);
    expect(unverifiedAmounts("Cerca de R$ 156 mil.", known)).toEqual([]);
    expect(unverifiedAmounts("Economia de R$ 50.000,00 e R$ 156.361.", known)).toEqual(["R$ 50.000,00"]);
    expect(unverifiedAmounts("R$ 2 milhões", known)).toEqual(["R$ 2 milhões"]);
  });
});

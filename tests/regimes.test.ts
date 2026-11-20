import { describe, expect, it } from "vitest";
import { PmoError, compareRegimes, simplesEffectiveRate, simplesWindow, type RegimeInput } from "../src";

const base: RegimeInput = { revenue: 1_200_000, payrollClt: 240_000, proLabore: 120_000, creditablePurchases: 100_000, realProfitMargin: 0.2, b2bShare: 0.8, issRate: 0.02, year: 2027, simplesAvailable: true };
const get = (i: RegimeInput, id: string) => compareRegimes(i).scenarios.find((s) => s.id === id)!;

describe("enquadramento — Simples Nacional", () => {
  it("alíquota efetiva pela tabela: (RBT12 × alíquota − dedução) / RBT12", () => {
    expect(simplesEffectiveRate(180_000, "III")).toBeCloseTo(0.06, 10);
    expect(simplesEffectiveRate(1_200_000, "III")).toBeCloseTo(156_360 / 1_200_000, 10);
    expect(simplesEffectiveRate(1_200_000, "V")).toBeCloseTo(228_900 / 1_200_000, 10);
    expect(simplesEffectiveRate(4_800_000, "III")).toBeCloseTo((4_800_000 * 0.33 - 648_000) / 4_800_000, 10);
  });
  it("Fator R decide o anexo: 28% ou mais → III; abaixo → V", () => {
    expect(compareRegimes(base).fatorR).toBeCloseTo(0.3, 10);
    expect(get(base, "simples").total).toBe(156_360);
    const baixo = { ...base, payrollClt: 0, proLabore: 60_000 };
    expect(get(baixo, "simples").total).toBe(228_900);
    expect(get(baixo, "simples").notes.join(" ")).toMatch(/Anexo V/);
    expect(get({ ...base, payrollClt: 216_000 }, "simples").lines[0]!.label).toMatch(/Anexo III/);
  });
  it("acima de R$ 4,8 milhões fica indisponível; acima do sublimite soma ISS por fora", () => {
    const fora = get({ ...base, revenue: 5_000_000 }, "simples");
    expect(fora.available).toBe(false);
    expect(fora.total).toBe(0);
    const sub = get({ ...base, revenue: 4_000_000, payrollClt: 1_200_000 }, "simples");
    expect(sub.lines).toHaveLength(2);
    expect(sub.lines[1]!.amount).toBe(80_000);
  });
  it("indisponível não entra na escolha do menor", () => {
    const r = compareRegimes({ ...base, simplesAvailable: false });
    expect(r.scenarios[0]!.available).toBe(false);
    expect(r.lowestTotal).not.toBe("simples");
    expect(compareRegimes(base).lowestTotal).toBe("simples");
  });
});

describe("enquadramento — Lucro Presumido e Real", () => {
  it("Presumido 2026: IRPJ com adicional, CSLL, PIS/COFINS 3,65%, ISS e INSS patronal", () => {
    const p = get({ ...base, year: 2026 }, "presumido");
    expect(p.lines.map((l) => l.amount)).toEqual([72_000, 34_560, 43_800, 24_000, 88_320]);
    expect(p.total).toBe(262_680);
    expect(p.passThrough).toBe(0);
  });
  it("Presumido 2027: CBS + IBS de 11,3% com crédito das compras; repasse só da parcela B2B", () => {
    const p = get(base, "presumido");
    expect(p.total).toBe(343_180);
    expect(p.passThrough).toBe(108_480);
    expect(p.netBurden).toBe(234_700);
  });
  it("Real: IRPJ/CSLL sobre o lucro informado; PIS/COFINS 9,25% sobre receita menos compras em 2026", () => {
    expect(get(base, "real").total).toBe(294_220);
    expect(get(base, "real").netBurden).toBe(185_740);
    expect(get({ ...base, year: 2026 }, "real").total).toBe(271_670);
    const prejuizo = get({ ...base, realProfitMargin: -0.1 }, "real");
    expect(prejuizo.lines[0]!.amount).toBe(0);
    expect(prejuizo.lines[1]!.amount).toBe(0);
  });
  it("LC 224/2025: presunção 10% maior só sobre o que passa de R$ 5 milhões", () => {
    const p = get({ ...base, revenue: 6_000_000 }, "presumido");
    // base 1.952.000 → IRPJ 292.800 + 171.200; CSLL 175.680
    expect(p.lines[0]!.amount).toBe(464_000);
    expect(p.lines[1]!.amount).toBe(175_680);
  });
  it("2033: sem ISS, alíquotas plenas estimadas; crédito nunca vira ganho", () => {
    const p = get({ ...base, year: 2033 }, "presumido");
    expect(p.lines.some((l) => l.label.startsWith("ISS"))).toBe(false);
    expect(p.lines.find((l) => l.label.startsWith("CBS e IBS"))!.amount).toBe(334_920);
    const credor = get({ ...base, creditablePurchases: 5_000_000 }, "real");
    expect(credor.lines.find((l) => l.label.startsWith("Crédito"))!.amount).toBe(-135_600);
    expect(credor.notes.join(" ")).toMatch(/saldo credor/);
  });
  it("rejeita entrada inválida", () => {
    expect(() => compareRegimes({ ...base, revenue: 0 })).toThrow(PmoError);
    expect(() => compareRegimes({ ...base, issRate: 0.1 })).toThrow(/ISS/);
    expect(() => compareRegimes({ ...base, b2bShare: 2 })).toThrow(PmoError);
    expect(() => compareRegimes({ ...base, payrollClt: NaN })).toThrow(PmoError);
  });
});

describe("enquadramento — janela de opção pelo Simples", () => {
  const c = { optant: false, openedOn: "2026-07-08", today: "2026-11-20" };
  it("não optante aberta em julho/2026: fora em 2026 e 2027, possível em 2028", () => {
    expect(simplesWindow({ ...c, targetYear: 2026 }).available).toBe(false);
    const w = simplesWindow({ ...c, targetYear: 2027 });
    expect(w.available).toBe(false);
    expect(w.message).toMatch(/setembro de 2027/);
    expect(simplesWindow({ ...c, targetYear: 2028 }).message).toMatch(/setembro de 2027/);
    expect(simplesWindow({ ...c, targetYear: 2033 }).available).toBe(true);
  });
  it("optante, aberta no fim de 2026 ou ainda dentro de setembro: disponível em 2027", () => {
    expect(simplesWindow({ ...c, optant: true, targetYear: 2027 }).available).toBe(true);
    expect(simplesWindow({ ...c, openedOn: "2026-10-15", targetYear: 2027 }).available).toBe(true);
    expect(simplesWindow({ ...c, today: "2026-09-10", targetYear: 2027 }).available).toBe(true);
  });
});

import { fatorRGap, formatCnpj, isValidCnpj, parseCompanyProfile, realBreakEvenMargin } from "../src";
describe("enquadramento — alavancas e CNPJ", () => {
  it("Fator R: quanto falta e quanto o DAS cai ao chegar ao Anexo III", () => {
    const g = fatorRGap({ revenue: 1_200_000, payrollClt: 0, proLabore: 60_000 });
    expect(g).toEqual({ reached: false, needed: 336_000, missing: 276_000, dasSaving: 72_540 });
    expect(fatorRGap({ revenue: 1_200_000, payrollClt: 240_000, proLabore: 120_000 }).reached).toBe(true);
  });
  it("ponto de equilíbrio Presumido × Real: 32% até R$ 5 milhões, maior acima", () => {
    expect(realBreakEvenMargin(1_200_000)).toBeCloseTo(0.32, 10);
    expect(realBreakEvenMargin(6_000_000)).toBeCloseTo(1_952_000 / 6_000_000, 10);
  });
  it("valida dígitos verificadores e formata", () => {
    expect(isValidCnpj("67.905.017/0001-69")).toBe(true);
    expect(isValidCnpj("67.905.017/0001-68")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
    expect(formatCnpj("67905017000169")).toBe("67.905.017/0001-69");
  });
  it("lê o cadastro público sem inventar: opção pelo Simples ausente fica null", () => {
    const p = parseCompanyProfile({ cnpj: "67905017000169", razao_social: "X LTDA", cnae_fiscal: 6202300, cnae_fiscal_descricao: "Software", porte: "DEMAIS", opcao_pelo_simples: null, data_inicio_atividade: "2026-07-08", cnaes_secundarios: [{ codigo: 6204000, descricao: "Consultoria" }, { codigo: 0, descricao: "" }, null] });
    expect(p).toMatchObject({ name: "X LTDA", simplesOptant: null, mei: null, openedOn: "2026-07-08", size: "DEMAIS", mainActivity: { code: "6202300" } });
    expect(p?.secondaryActivities).toEqual([{ code: "6204000", description: "Consultoria" }]);
    expect(parseCompanyProfile({ message: "CNPJ não encontrado" })).toBeNull();
    expect(parseCompanyProfile(null)).toBeNull();
  });
});

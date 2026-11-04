import { describe, expect, it } from "vitest";
import {
  assessCbs,
  cbsOnRevenue,
  creditFor,
  DEFAULT_CBS_CONFIG,
  effectiveRate,
  PmoError,
  splitInvoice,
} from "../src";

describe("alíquotas", () => {
  it("aplica 30% de redução a engenharia e alíquota cheia a software", () => {
    expect(effectiveRate("servico_engenharia")).toBe(0.0791);
    expect(effectiveRate("licenca_software")).toBe(0.113);
  });

  it("aceita parâmetros próprios e rejeita valores inválidos", () => {
    expect(effectiveRate("servico_engenharia", { ...DEFAULT_CBS_CONFIG, standardRate: 0.088 })).toBe(0.0616);
    expect(() => effectiveRate("servico_engenharia", { ...DEFAULT_CBS_CONFIG, standardRate: 1.5 })).toThrowError(PmoError);
    expect(() =>
      effectiveRate("servico_engenharia", { standardRate: 0.1, reduction: { servico_engenharia: -1, licenca_software: 0 } }),
    ).toThrowError(PmoError);
  });
});

describe("cbsOnRevenue", () => {
  it("calcula a CBS por linha e o total", () => {
    const r = cbsOnRevenue([
      { kind: "servico_engenharia", amount: 100_000 },
      { kind: "licenca_software", amount: 50_000 },
    ]);
    expect(r.lines.map((l) => l.cbs)).toEqual([7910, 5650]);
    expect(r.totalBase).toBe(150_000);
    expect(r.totalCbs).toBe(13_560);
  });

  it("rejeita valor negativo", () => {
    expect(() => cbsOnRevenue([{ kind: "licenca_software", amount: -1 }])).toThrowError(PmoError);
  });
});

describe("creditFor", () => {
  const base = { cbsDestacada: 100, supplierIsRegularPJ: true };

  it("concede crédito às categorias do estudo", () => {
    for (const category of ["cloud", "software", "api", "utilidades", "aluguel", "combustivel", "manutencao_frota", "equipamento_campo", "laudos_analises"] as const) {
      expect(creditFor({ ...base, category })).toMatchObject({ allowed: true, credit: 100 });
    }
  });

  it("nega crédito a folha, pró-labore, RPA e uso pessoal", () => {
    for (const category of ["folha_clt", "pro_labore", "rpa_autonomo", "uso_pessoal"] as const) {
      expect(creditFor({ ...base, category })).toMatchObject({ allowed: false, credit: 0 });
    }
  });

  it("nega crédito quando o fornecedor não é PJ regular ou a nota não destaca CBS", () => {
    expect(creditFor({ ...base, category: "aluguel", supplierIsRegularPJ: false }).reason).toMatch(/regime regular/);
    expect(creditFor({ ...base, category: "cloud", cbsDestacada: 0 }).reason).toMatch(/sem CBS destacada/);
  });

  it("exige vínculo comprovado para a categoria 'outro'", () => {
    expect(creditFor({ ...base, category: "outro" }).allowed).toBe(false);
    expect(creditFor({ ...base, category: "outro", linkedToActivity: true })).toMatchObject({ allowed: true, credit: 100 });
  });
});

describe("assessCbs", () => {
  const revenue = [
    { kind: "servico_engenharia", amount: 100_000 },
    { kind: "licenca_software", amount: 50_000 },
  ] as const;

  it("apura débito menos crédito (saldo devedor, como alerta o estudo)", () => {
    const r = assessCbs(revenue, [
      { category: "cloud", cbsDestacada: 2000, supplierIsRegularPJ: true },
      { category: "folha_clt", cbsDestacada: 0, supplierIsRegularPJ: false },
      { category: "aluguel", cbsDestacada: 500, supplierIsRegularPJ: false },
      { category: "combustivel", cbsDestacada: 300, supplierIsRegularPJ: true },
      { category: "outro", cbsDestacada: 100, supplierIsRegularPJ: true },
      { category: "outro", cbsDestacada: 100, supplierIsRegularPJ: true, linkedToActivity: true },
      { category: "uso_pessoal", cbsDestacada: 50, supplierIsRegularPJ: true },
    ]);
    expect(r.debit).toBe(13_560);
    expect(r.credit).toBe(2400);
    expect(r.balance).toBe(11_160);
    expect(r.payable).toBe(11_160);
    expect(r.carryForward).toBe(0);
    expect(r.position).toBe("a_pagar");
    expect(r.purchases.filter((p) => !p.allowed).every((p) => p.reason)).toBe(true);
  });

  it("gera saldo credor quando o crédito supera o débito", () => {
    const r = assessCbs([{ kind: "servico_engenharia", amount: 1000 }], [
      { category: "cloud", cbsDestacada: 500, supplierIsRegularPJ: true },
    ]);
    expect(r.debit).toBe(79.1);
    expect(r.balance).toBe(-420.9);
    expect(r.payable).toBe(0);
    expect(r.carryForward).toBe(420.9);
    expect(r.position).toBe("saldo_credor");
  });

  it("devolve posição zero sem movimento", () => {
    expect(assessCbs([], []).position).toBe("zero");
  });
});

describe("splitInvoice", () => {
  it("separa o contrato em duas linhas com alíquotas diferentes", () => {
    const r = splitInvoice(100_000, 0.6);
    expect(r.lines.map((l) => [l.kind, l.base, l.cbs])).toEqual([
      ["servico_engenharia", 60_000, 4746],
      ["licenca_software", 40_000, 4520],
    ]);
    expect(r.totalCbs).toBe(9266);
    expect(r.blendedRate).toBeCloseTo(0.09266, 8);
  });

  it("não perde centavos e valida os argumentos", () => {
    const r = splitInvoice(100.01, 1 / 3);
    expect(r.lines[0]!.base + r.lines[1]!.base).toBeCloseTo(100.01, 10);
    expect(splitInvoice(0, 0.5).blendedRate).toBe(0);
    expect(() => splitInvoice(100, 1.2)).toThrowError(PmoError);
    expect(() => splitInvoice(-1, 0.5)).toThrowError(PmoError);
  });
});

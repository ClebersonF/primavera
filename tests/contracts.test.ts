import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, PmoError, commitmentsByActivity, consolidateCashFlow, contractsOf, describePlanningChange, evaluateThresholds, nextContractId, nextPaymentId, normalizePlanning, paidByActivity, withChange, withContract, withPayment, withoutContract, withoutPayment } from "../src";

const k = (id = "K-1", extra = {}) => ({ id, name: "Mudas nativas", supplier: " Viveiro Sul ", value: 1000.005, status: "vigente" as const, activityIds: ["a1", "a2", "a1"], ...extra });
const pay = (id: string, extra = {}) => ({ id, contractId: "K-1", date: "2026-10-10", amount: 300, status: "pago" as const, ...extra });

describe("contratos e pagamentos", () => {
  it("cria, normaliza, numera, idempotente", () => {
    const p = withContract(EMPTY_PLANNING, k());
    expect(p.contracts[0]).toMatchObject({ supplier: "Viveiro Sul", value: 1000.01, activityIds: ["a1", "a2"] });
    expect(nextContractId(p)).toBe("K-2");
    expect(withContract(p, p.contracts[0]!)).toBe(p);
    expect(describePlanningChange(EMPTY_PLANNING, p)).toContain("Contrato K-1 criado: Mudas nativas");
    expect(() => withContract(p, k("K-2", { name: " " }))).toThrow(PmoError);
    expect(() => withContract(p, k("K-2", { value: -1 }))).toThrow(PmoError);
    expect(() => withContract(p, k("K-2", { signedOn: "10/10/2026" }))).toThrow(PmoError);
  });
  it("pagamentos exigem contrato; remover contrato leva os pagamentos", () => {
    const base = withContract(EMPTY_PLANNING, k());
    expect(() => withPayment(base, pay("P-1", { contractId: "K-9" }))).toThrow(PmoError);
    expect(() => withPayment(base, pay("P-1", { amount: 0 }))).toThrow(PmoError);
    const p = withPayment(base, pay("P-1"));
    expect(nextPaymentId(p)).toBe("P-2");
    expect(withPayment(p, p.payments[0]!)).toBe(p);
    const q = withPayment(p, { ...p.payments[0]!, status: "previsto" });
    expect(describePlanningChange(p, q)).toContain("Pagamento P-1 atualizado (pago → previsto)");
    expect(withoutPayment(q, "P-1").payments).toEqual([]);
    expect(withoutContract(p, "K-1")).toMatchObject({ contracts: [], payments: [] });
    expect(withoutContract(p, "K-9")).toBe(p);
  });
  it("resumo: ajuste só de ordem aprovada, saldo e estouro", () => {
    let p = withPayment(withPayment(withContract(EMPTY_PLANNING, k("K-1", { value: 1000 })), pay("P-1", { amount: 600 })), pay("P-2", { amount: 300, status: "previsto", date: "2026-12-01" }));
    p = withChange(p, { id: "C-1", title: "Reforço", status: "rascunho", contractDeltas: [{ contractId: "K-1", delta: 200 }] });
    let s = contractsOf(p)[0]!;
    expect(s).toMatchObject({ adjustments: 0, current: 1000, paid: 600, scheduled: 300, balance: 100, overCommitted: false });
    p = { ...p, changes: [{ ...p.changes[0]!, status: "aprovada" }] };
    s = contractsOf(p)[0]!;
    expect(s).toMatchObject({ adjustments: 200, current: 1200, balance: 300 });
    p = withPayment(p, pay("P-3", { amount: 900 }));
    expect(contractsOf(p)[0]!.overCommitted).toBe(true);
    expect(() => withoutContract(p, "K-1")).toThrow(PmoError);
    expect(evaluateThresholds({ spi: 1, cpi: 1, daysToDeadline: 90, severeRisks: 0, overdueIssues: 0, overCommittedContracts: 1 })[0]!.code).toBe("contratos");
  });
  it("compromisso e pago por atividade: repartição sem perder centavos; rascunho não compromete", () => {
    const p = withPayment(withContract(withContract(EMPTY_PLANNING, k("K-1", { value: 100, activityIds: ["a1", "a2", "a3"] })), k("K-2", { value: 50, status: "rascunho", activityIds: ["a1"] })), pay("P-1", { amount: 10 }));
    const sums = contractsOf(p);
    const c = commitmentsByActivity(sums);
    expect([...c.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    expect(c.get("a1")).toBeCloseTo(33.34, 2);
    expect([...paidByActivity(sums).values()].reduce((a, b) => a + b, 0)).toBeCloseTo(10, 2);
  });
  it("normaliza JSON salvo: pagamento órfão e duplicados descartados", () => {
    const p = withPayment(withContract(EMPTY_PLANNING, k()), pay("P-1"));
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).payments).toEqual(p.payments);
    const n = normalizePlanning({ contracts: [k(), k()], payments: [pay("P-1"), pay("P-1"), pay("P-2", { contractId: "K-7" })] });
    expect(n.contracts).toHaveLength(1);
    expect(n.payments).toHaveLength(1);
    expect(normalizePlanning({}).contracts).toEqual([]);
  });
});

describe("fluxo de caixa com pagamentos", () => {
  const proj = (extra = {}) => ({ id: "a", startDate: "2026-10-26", items: [{ id: "1", start: 0, finish: 10, cost: 1000, actual: 999 }], ...extra });
  it("com pagamentos, o realizado vem deles e o estimado é ignorado", () => {
    const f = consolidateCashFlow([proj({ payments: [{ date: "2026-10-30", amount: 200, status: "pago" }, { date: "2026-11-20", amount: 300, status: "previsto" }] })], "2026-11-04");
    expect(f.totalActual).toBe(200);
    expect(f.months[0]).toMatchObject({ actual: 200, actualFromPayments: 200 });
    expect(f.months[1]).toMatchObject({ forecast: 300, actual: 0 });
  });
  it("sem pagamentos, mantém a estimativa", () => {
    const f = consolidateCashFlow([proj()], "2026-11-04");
    expect(f.totalActual).toBe(999);
    expect(f.months.every((m) => m.actualFromPayments === 0)).toBe(true);
  });
  it("projeto com pagamentos e outro sem: cada um com sua fonte; data inválida recusada", () => {
    const f = consolidateCashFlow([proj({ payments: [{ date: "2026-10-30", amount: 50, status: "pago" }] }), proj({ id: "b" })], "2026-11-04");
    expect(f.totalActual).toBe(1049);
    expect(() => consolidateCashFlow([proj({ payments: [{ date: "x", amount: 1, status: "pago" }] })], "2026-11-04")).toThrow(PmoError);
  });
});

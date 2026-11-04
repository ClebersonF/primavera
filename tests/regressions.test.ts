import { describe, expect, it } from "vitest";
import {
  buildCostSheet,
  cbsOnRevenue,
  checkAreaTableConsistency,
  comuniqueSeDeadline,
  CpmError,
  createBaseline,
  isWorkDay,
  planWbs,
  PmoError,
  scheduleCpm,
  transitionChange,
  type RevenueItem,
} from "../src";
import { toCents } from "../src/money";
import { sampleWbs } from "./fixtures";

/** Defeitos achados na revisão independente da Onda 2. */
describe("regressões da revisão", () => {
  it("arredonda centavos pela representação decimal (1,005 → 1,01)", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.285)).toBe(29);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(-1.005)).toBe(-100); // meio para cima, como Math.round
    const sheet = buildCostSheet([{ id: "1", parentId: null, name: "x" }], [{ id: "l", codeId: "1", budget: 1.005 }]);
    expect(sheet.totals.budget).toBe(1.01);
  });

  it("rejeita valores fora do intervalo seguro", () => {
    expect(() => toCents(1e308)).toThrowError(PmoError);
    expect(() => toCents(Number.NaN)).toThrowError(PmoError);
  });

  it("rejeita tipo de vínculo inválido no CPM", () => {
    expect(() =>
      scheduleCpm([
        { id: "A", duration: 2 },
        { id: "B", duration: 1, predecessors: [{ id: "A", type: "XX" as never }] },
      ]),
    ).toThrowError(CpmError);
  });

  it("conta campo ausente do quadro de áreas como 0 também na soma", () => {
    const issues = checkAreaTableConsistency({ p: { total: 100, viario: 10, verdes: 10, institucional: 10 } as never });
    expect(issues).toEqual([{ kind: "soma", source: "p", field: "soma", expected: 100, found: 30 }]);
  });

  it("valida a data da baseline como o calendário", () => {
    expect(() => createBaseline("x", "2026-13-45", planWbs(sampleWbs()))).toThrowError(PmoError);
    expect(() => createBaseline("x", "2026-02-30", planWbs(sampleWbs()))).toThrowError(/inexistente/);
  });

  it("limita o prazo do Comunique-se com erro de domínio", () => {
    expect(() => comuniqueSeDeadline("2026-01-01", 1e10)).toThrowError(PmoError);
    expect(comuniqueSeDeadline("2026-01-01", 36_500)).toBe("2125-12-08");
  });

  it("rejeita tipo de receita inventado (herdado do protótipo)", () => {
    for (const kind of ["toString", "constructor", "x"]) {
      expect(() => cbsOnRevenue([{ kind, amount: 10 } as unknown as RevenueItem])).toThrowError(PmoError);
    }
  });

  it("rejeita status desconhecido em pedido de mudança", () => {
    for (const status of ["constructor", "foo"]) {
      expect(() => transitionChange({ id: "M", title: "t", status } as never, "aprovada")).toThrowError(PmoError);
    }
  });

  it("rejeita feriado mal formatado no calendário", () => {
    expect(() => isWorkDay("2026-12-25", { workWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-5"] })).toThrowError(CpmError);
    expect(isWorkDay("2026-12-25", { workWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] })).toBe(false);
  });
});

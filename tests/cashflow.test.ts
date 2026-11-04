import { describe, expect, it } from "vitest";
import { PmoError, cashFlowByProgram, consolidateCashFlow, workDayDates } from "../src";

// 2026-10-26 é segunda; 5 dias úteis = 26..30/10; 6º dia útil = 2026-11-02.
const proj = (id: string, items: any[], extra = {}) => ({ id, startDate: "2026-10-26", items, ...extra });

describe("fluxo de caixa consolidado", () => {
  it("espalha o previsto por mês sem perder centavos e acumula", () => {
    const f = consolidateCashFlow([proj("a", [{ id: "1", start: 0, finish: 10, cost: 1000.01 }])], "2026-11-04");
    expect(f.months.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(f.months[0]!.planned + f.months[1]!.planned).toBeCloseTo(1000.01, 2);
    expect(f.months[0]!.planned).toBeCloseTo(500.01, 2); // 5 dias úteis em outubro (os 5 primeiros recebem o centavo extra)
    expect(f.totalPlanned).toBe(1000.01);
    expect(f.months[1]!.plannedCumulative).toBe(1000.01);
  });
  it("soma projetos e preenche meses sem movimento", () => {
    const f = consolidateCashFlow([proj("a", [{ id: "1", start: 0, finish: 1, cost: 100 }]), proj("b", [{ id: "1", start: 0, finish: 1, cost: 50 }], { startDate: "2027-01-04" })], "2026-10-30");
    expect(f.months.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(f.months[1]).toMatchObject({ planned: 0, plannedCumulative: 100 });
    expect(f.totalPlanned).toBe(150);
  });
  it("realizado vai até a data de referência e meses futuros são marcados", () => {
    const f = consolidateCashFlow([proj("a", [{ id: "1", start: 0, finish: 10, cost: 1000, actual: 300 }])], "2026-10-28");
    expect(f.totalActual).toBe(300);
    expect(f.months[0]!.actual).toBe(300); // 26..28/10, tudo em outubro
    expect(f.months[0]!.future).toBe(false);
    expect(f.months[1]!.future).toBe(true);
    expect(f.months[1]!.actual).toBe(0);
  });
  it("atividade ainda não iniciada: realizado cai na data de referência", () => {
    const f = consolidateCashFlow([proj("a", [{ id: "1", start: 5, finish: 8, cost: 90, actual: 10 }])], "2026-10-27");
    expect(f.months[0]!.actual).toBe(10);
  });
  it("marco (duração zero) cai no dia de início; sem itens, vazio", () => {
    expect(consolidateCashFlow([proj("a", [{ id: "m", start: 5, finish: 5, cost: 40 }])], "2026-10-26").months.map((m) => [m.month, m.planned])).toEqual([["2026-11", 40]]);
    expect(consolidateCashFlow([], "2026-10-26")).toEqual({ months: [], totalPlanned: 0, totalActual: 0 });
    expect(consolidateCashFlow([proj("a", [])], "2026-10-26").months).toEqual([]);
  });
  it("respeita feriados do calendário", () => {
    const cal = { workWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-10-30"] };
    expect(workDayDates("2026-10-26", 5, cal)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-11-02"]);
    const f = consolidateCashFlow([proj("a", [{ id: "1", start: 0, finish: 5, cost: 500 }], { calendar: cal })], "2026-11-04");
    expect(f.months[0]!.planned).toBe(400);
    expect(f.months[1]!.planned).toBe(100);
  });
  it("valida entradas", () => {
    expect(() => consolidateCashFlow([proj("a", [{ id: "1", start: 3, finish: 2, cost: 1 }])], "2026-10-26")).toThrow(PmoError);
    expect(() => consolidateCashFlow([proj("a", [{ id: "1", start: 0, finish: 2, cost: -1 }])], "2026-10-26")).toThrow(PmoError);
    expect(() => consolidateCashFlow([], "26/10/2026")).toThrow(PmoError);
  });
  it("agrupa por programa", () => {
    const g = cashFlowByProgram([proj("a", [{ id: "1", start: 0, finish: 1, cost: 10 }], { program: "Rio Pardo" }), proj("b", [{ id: "1", start: 0, finish: 1, cost: 5 }]), proj("c", [{ id: "1", start: 0, finish: 1, cost: 7 }], { program: "Rio Pardo" })], "2026-10-26");
    expect(g.map((x) => [x.program, x.flow.totalPlanned])).toEqual([["Rio Pardo", 17], ["Sem programa", 5]]);
  });
});

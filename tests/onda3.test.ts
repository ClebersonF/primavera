import { describe, expect, it } from "vitest";
import { computeEvm, prioritizePortfolio, resourceHistogram, PmoError, toLocalDate, todayLocal } from "../src";

const acts = [
  { id: "a", plannedCost: 100, start: 0, finish: 10, percentComplete: 100 },
  { id: "b", plannedCost: 200, start: 10, finish: 20, percentComplete: 25 },
  { id: "c", plannedCost: 100, start: 20, finish: 30, percentComplete: 0 },
];

describe("EVM", () => {
  it("calcula PV/EV/SPI e deixa índices de custo indisponíveis sem AC", () => {
    const r = computeEvm({ activities: acts, asOfDay: 15 });
    expect(r.bac).toBe(400);
    expect(r.pv).toBe(200); // 100 + 200*0,5
    expect(r.ev).toBe(150); // 100 + 50
    expect(r.sv).toBe(-50);
    expect(r.spi).toBe(0.75);
    expect(r.status).toBe("atrasado");
    expect([r.cpi, r.eac, r.etc, r.vac, r.tcpi, r.cv]).toEqual([null, null, null, null, null, null]);
  });
  it("calcula CPI/EAC/ETC/VAC/TCPI com custo real", () => {
    const r = computeEvm({ activities: acts, asOfDay: 15, actualCost: 200 });
    expect(r.cpi).toBe(0.75);
    expect(r.cv).toBe(-50);
    expect(r.eac).toBe(533.33);
    expect(r.etc).toBe(333.33);
    expect(r.vac).toBe(-133.33);
    expect(r.tcpi).toBe(1.25); // (400-150)/(400-200)
  });
  it("sem base de planejado, SPI é nulo; marcos contam a partir do início", () => {
    expect(computeEvm({ activities: acts, asOfDay: 0 }).status).toBe("adiantado"); // EV 100 com PV 0
    expect(computeEvm({ activities: [{ ...acts[2]! }], asOfDay: 0 }).status).toBe("sem_base");
    const m = computeEvm({ activities: [{ id: "m", plannedCost: 10, start: 5, finish: 5, percentComplete: 0 }], asOfDay: 5 });
    expect(m.pv).toBe(10);
    const ahead = computeEvm({ activities: [{ id: "x", plannedCost: 10, start: 5, finish: 10, percentComplete: 50 }], asOfDay: 2 });
    expect([ahead.pv, ahead.ev, ahead.spi, ahead.status]).toEqual([0, 5, null, "adiantado"]);
  });
  it("valida entradas", () => {
    expect(() => computeEvm({ activities: acts, asOfDay: -1 })).toThrow(PmoError);
    expect(() => computeEvm({ activities: [{ ...acts[0]!, percentComplete: 101 }], asOfDay: 1 })).toThrow(PmoError);
    expect(() => computeEvm({ activities: acts, asOfDay: 1, actualCost: -5 })).toThrow(PmoError);
  });
});

describe("histograma de recursos", () => {
  it("média semanal, pico diário e superalocação", () => {
    const h = resourceHistogram([
      { resource: "Ana", start: 0, finish: 7 },
      { resource: "Ana", start: 6, finish: 8 }, // sobrepõe dias 6 e 7
      { resource: "Bia", start: 0, finish: 5, units: 0.5 },
    ]);
    expect(h.buckets).toHaveLength(2);
    const ana = h.resources.find((r) => r.resource === "Ana")!;
    expect(ana.load).toEqual([1, 0.8]); // dias 5,6,7 = 1+2+1 → 4/5
    expect(ana.peak).toBe(2);
    expect(ana.overallocated).toEqual([1]);
    expect(h.hasOverallocation).toBe(true);
    expect(h.resources.find((r) => r.resource === "Bia")!.load).toEqual([0.5, 0]);
  });
  it("capacidade por recurso e validações", () => {
    const h = resourceHistogram([{ resource: "Eq", start: 0, finish: 5, units: 2 }], { capacities: { Eq: 2 } });
    expect(h.hasOverallocation).toBe(false);
    expect(() => resourceHistogram([{ resource: " ", start: 0, finish: 1 }])).toThrow(PmoError);
    expect(() => resourceHistogram([{ resource: "A", start: 3, finish: 1 }])).toThrow(PmoError);
    expect(() => resourceHistogram([], { bucketDays: 0 })).toThrow(PmoError);
    expect(resourceHistogram([]).buckets).toHaveLength(1);
  });
});

describe("priorização do portfólio", () => {
  const base = { budget: 100, spi: 1, daysToDeadline: 90 };
  it("ordena por score, aplica faixas e marca fatores ausentes", () => {
    const r = prioritizePortfolio([
      { id: "calmo", name: "Calmo", nature: "investment", ...base },
      { id: "urgente", name: "Urgente", nature: "emergency", budget: 100, spi: 0.5, daysToDeadline: -3 },
      { id: "sem-dados", name: "Sem dados", budget: 50, spi: null, daysToDeadline: null },
    ]);
    expect(r.map((x) => x.id)).toEqual(["urgente", "sem-dados", "calmo"]);
    expect(r[0]!.score).toBe(100);
    expect(r[0]!.band).toBe("alta");
    expect(r[0]!.rank).toBe(1);
    expect(r[1]!.missing).toEqual(["nature", "schedule", "deadline"]);
    expect(r[2]!.band).toBe("baixa");
  });
  it("desempata por id e valida pesos", () => {
    const r = prioritizePortfolio([
      { id: "b", name: "B", ...base },
      { id: "a", name: "A", ...base },
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(() => prioritizePortfolio([], { nature: 0, schedule: 0, deadline: 0, budget: 0 })).toThrow(PmoError);
    expect(() => prioritizePortfolio([], { nature: -1, schedule: 1, deadline: 1, budget: 1 })).toThrow(PmoError);
  });
});

describe("regressões da revisão", () => {
  it("EVM: status e CPI usam valores sem arredondar", () => {
    // ev/pv = 0,9496 → arredonda para 0,95, mas é atraso.
    const a = computeEvm({ activities: [{ id: "x", plannedCost: 10000, start: 0, finish: 10, percentComplete: 94.96 }], asOfDay: 10 });
    expect(a.spi).toBe(0.95);
    expect(a.status).toBe("atrasado");
    // CPI real 0,001 arredonda para 0, mas EAC existe.
    const b = computeEvm({ activities: [{ id: "x", plannedCost: 100, start: 0, finish: 10, percentComplete: 1 }], asOfDay: 5, actualCost: 1000 });
    expect(b.cpi).toBe(0);
    expect(b.eac).toBe(100000);
  });
  it("entradas não finitas são rejeitadas", () => {
    expect(() => computeEvm({ activities: [{ id: "x", plannedCost: Infinity, start: 0, finish: 1, percentComplete: 0 }], asOfDay: 1 })).toThrow(PmoError);
    expect(() => computeEvm({ activities: [{ id: "x", plannedCost: 1, start: NaN, finish: 1, percentComplete: 0 }], asOfDay: 1 })).toThrow(PmoError);
    expect(() => resourceHistogram([], { horizon: NaN })).toThrow(PmoError);
    expect(() => resourceHistogram([], { horizon: 1e12 })).toThrow(PmoError);
    expect(() => resourceHistogram([{ resource: "A", start: 0.5, finish: 3.5 }])).toThrow(PmoError);
    expect(() => resourceHistogram([{ resource: "A", start: 0, finish: 3, units: Infinity }])).toThrow(PmoError);
    expect(() => resourceHistogram([], { capacities: { A: NaN } })).toThrow(PmoError);
  });
  it("priorização: valores não finitos viram fator ausente, nunca NaN", () => {
    const r = prioritizePortfolio([
      { id: "n", name: "N", budget: 10, spi: NaN, daysToDeadline: NaN },
      { id: "ok", name: "OK", nature: "emergency", budget: 10, spi: 0.6, daysToDeadline: 5 },
    ]);
    expect(r.every((x) => Number.isFinite(x.score))).toBe(true);
    expect(r[0]!.id).toBe("ok");
    expect(r[1]!.missing).toEqual(["nature", "schedule", "deadline"]);
    expect(() => prioritizePortfolio([{ id: "i", name: "I", budget: Infinity, spi: 1, daysToDeadline: 1 }])).toThrow(PmoError);
    expect(() => prioritizePortfolio([], { nature: Infinity, schedule: 1, deadline: 1, budget: 1 })).toThrow(PmoError);
  });
});

describe("datas no fuso de Brasília", () => {
  it("toLocalDate", () => {
    expect(toLocalDate("2026-11-06")).toBe("2026-11-06");
    expect(toLocalDate("2026-11-02T00:00:00.000Z")).toBe("2026-11-02"); // data de seletor
    expect(toLocalDate("2026-11-07T01:30:00.000Z")).toBe("2026-11-06"); // 22:30 em Brasília
    expect(toLocalDate("2026-11-11T01:00:00Z")).toBe("2026-11-10");
    expect(toLocalDate("2026-11-07 01:30:00")).toBe("2026-11-06"); // Odoo, UTC sem fuso
    expect(() => toLocalDate("bla")).toThrow(PmoError);
    expect(todayLocal(new Date("2026-11-07T01:30:00Z"))).toBe("2026-11-06");
  });
});

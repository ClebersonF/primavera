import { describe, expect, it } from "vitest";
import {
  CpmCycleError,
  CpmError,
  scheduleCpm,
  toCalendarDates,
  workDayAt,
  type CpmActivity,
} from "../src/cpm";

const byId = (r: ReturnType<typeof scheduleCpm>, id: string) => r.activities.find((a) => a.id === id)!;

describe("scheduleCpm — vínculos básicos", () => {
  it("cadeia FS simples: tudo crítico, sem folga", () => {
    const r = scheduleCpm([
      { id: "A", duration: 3 },
      { id: "B", duration: 2, predecessors: [{ id: "A" }] },
      { id: "C", duration: 4, predecessors: [{ id: "B" }] },
    ]);
    expect(r.projectDuration).toBe(9);
    expect([byId(r, "A").earlyStart, byId(r, "B").earlyStart, byId(r, "C").earlyStart]).toEqual([0, 3, 5]);
    expect(r.criticalPath).toEqual(["A", "B", "C"]);
    expect(r.activities.every((a) => a.totalFloat === 0 && a.freeFloat === 0)).toBe(true);
  });

  it("caminhos paralelos: o ramo curto tem folga total e livre", () => {
    const r = scheduleCpm([
      { id: "A", duration: 2 },
      { id: "B", duration: 3, predecessors: [{ id: "A" }] },
      { id: "C", duration: 5, predecessors: [{ id: "A" }] },
      { id: "D", duration: 1, predecessors: [{ id: "B" }, { id: "C" }] },
    ]);
    expect(r.projectDuration).toBe(8);
    expect(r.criticalPath).toEqual(["A", "C", "D"]);
    const b = byId(r, "B");
    expect(b.totalFloat).toBe(2);
    expect(b.freeFloat).toBe(2);
    expect(b.lateStart).toBe(4);
    expect(b.critical).toBe(false);
  });

  it("lag positivo atrasa e lag negativo (antecipação) adianta", () => {
    const lagged = scheduleCpm([
      { id: "A", duration: 3 },
      { id: "B", duration: 2, predecessors: [{ id: "A", lag: 2 }] },
    ]);
    expect(byId(lagged, "B").earlyStart).toBe(5);
    expect(lagged.projectDuration).toBe(7);

    const lead = scheduleCpm([
      { id: "A", duration: 3 },
      { id: "B", duration: 2, predecessors: [{ id: "A", lag: -1 }] },
    ]);
    expect(byId(lead, "B").earlyStart).toBe(2);
    expect(lead.projectDuration).toBe(4);
  });

  it("SS com lag: sucessora começa junto, com folga no fim", () => {
    const r = scheduleCpm([
      { id: "A", duration: 5 },
      { id: "B", duration: 3, predecessors: [{ id: "A", type: "SS", lag: 1 }] },
    ]);
    expect(byId(r, "B").earlyStart).toBe(1);
    expect(byId(r, "B").earlyFinish).toBe(4);
    expect(r.projectDuration).toBe(5);
    expect(byId(r, "B").totalFloat).toBe(1);
    expect(r.criticalPath).toEqual(["A"]);
  });

  it("FF: sucessora termina junto da predecessora", () => {
    const r = scheduleCpm([
      { id: "A", duration: 5 },
      { id: "B", duration: 2, predecessors: [{ id: "A", type: "FF" }] },
    ]);
    expect(byId(r, "B").earlyStart).toBe(3);
    expect(byId(r, "B").earlyFinish).toBe(5);
    expect(r.criticalPath).toEqual(["A", "B"]);
  });

  it("SF: término da sucessora depende do início da predecessora", () => {
    const r = scheduleCpm([
      { id: "A", duration: 4 },
      { id: "B", duration: 2, predecessors: [{ id: "A", type: "SF" }] },
    ]);
    expect(byId(r, "B").earlyStart).toBe(0);
    expect(r.projectDuration).toBe(4);
    expect(byId(r, "B").totalFloat).toBe(2);
    // Folga livre nunca excede a total.
    expect(byId(r, "A").freeFloat).toBeLessThanOrEqual(byId(r, "A").totalFloat);
  });

  it("restrição 'não iniciar antes de' e marcos de duração zero", () => {
    const snet = scheduleCpm([{ id: "A", duration: 2, startNoEarlierThan: 5 }]);
    expect(byId(snet, "A").earlyStart).toBe(5);
    expect(snet.projectDuration).toBe(7);

    const ms = scheduleCpm([
      { id: "A", duration: 3 },
      { id: "M", duration: 0, predecessors: [{ id: "A" }] },
      { id: "B", duration: 2, predecessors: [{ id: "M" }] },
    ]);
    expect(byId(ms, "M").earlyStart).toBe(3);
    expect(byId(ms, "M").earlyFinish).toBe(3);
    expect(byId(ms, "B").earlyStart).toBe(3);
    expect(ms.projectDuration).toBe(5);
  });

  it("projeto vazio e atividade única", () => {
    expect(scheduleCpm([]).projectDuration).toBe(0);
    const one = scheduleCpm([{ id: "X", duration: 4 }]);
    expect(one.criticalPath).toEqual(["X"]);
    expect(one.projectDuration).toBe(4);
  });

  it("preserva a ordem de entrada nas atividades de saída", () => {
    const r = scheduleCpm([
      { id: "C", duration: 1, predecessors: [{ id: "A" }] },
      { id: "A", duration: 1 },
    ]);
    expect(r.activities.map((a) => a.id)).toEqual(["C", "A"]);
  });
});

describe("scheduleCpm — validação", () => {
  it("detecta ciclos e autodependência", () => {
    expect(() =>
      scheduleCpm([
        { id: "A", duration: 1, predecessors: [{ id: "B" }] },
        { id: "B", duration: 1, predecessors: [{ id: "A" }] },
        { id: "C", duration: 1 },
      ]),
    ).toThrowError(CpmCycleError);
    try {
      scheduleCpm([
        { id: "A", duration: 1, predecessors: [{ id: "B" }] },
        { id: "B", duration: 1, predecessors: [{ id: "A" }] },
      ]);
    } catch (e) {
      expect((e as CpmCycleError).involved.sort()).toEqual(["A", "B"]);
    }
    expect(() => scheduleCpm([{ id: "A", duration: 1, predecessors: [{ id: "A" }] }])).toThrowError(
      CpmCycleError,
    );
  });

  it("rejeita dados inválidos", () => {
    expect(() => scheduleCpm([{ id: "A", duration: 1, predecessors: [{ id: "Z" }] }])).toThrowError(CpmError);
    expect(() => scheduleCpm([{ id: "A", duration: 1 }, { id: "A", duration: 2 }])).toThrowError(/duplicado/);
    expect(() => scheduleCpm([{ id: "A", duration: -1 }])).toThrowError(CpmError);
    expect(() => scheduleCpm([{ id: "A", duration: 1.5 }])).toThrowError(CpmError);
    expect(() => scheduleCpm([{ id: "", duration: 1 }])).toThrowError(CpmError);
    expect(() =>
      scheduleCpm([{ id: "A", duration: 1 }, { id: "B", duration: 1, predecessors: [{ id: "A", lag: 0.5 }] }]),
    ).toThrowError(CpmError);
  });
});

/** PRNG determinístico para o teste de propriedades. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("scheduleCpm — propriedades em grafos aleatórios (FS, lag 0)", () => {
  it("duração = caminho mais longo e invariantes de folga valem", () => {
    const rand = mulberry32(42);
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rand() * 14);
      const acts: CpmActivity[] = [];
      for (let i = 0; i < n; i++) {
        const preds = [];
        for (let j = 0; j < i; j++) if (rand() < 0.3) preds.push({ id: `T${j}` });
        acts.push({ id: `T${i}`, duration: Math.floor(rand() * 6), predecessors: preds });
      }
      const r = scheduleCpm(acts);

      // Referência independente: maior caminho por programação dinâmica (ordem já é topológica).
      const finish: number[] = [];
      acts.forEach((a, i) => {
        const start = Math.max(0, ...(a.predecessors ?? []).map((p) => finish[Number(p.id.slice(1))]!));
        finish[i] = start + a.duration;
      });
      expect(r.projectDuration).toBe(Math.max(...finish));

      for (const a of r.activities) {
        expect(a.earlyStart).toBeGreaterThanOrEqual(0);
        expect(a.earlyFinish).toBe(a.earlyStart + a.duration);
        expect(a.lateFinish).toBe(a.lateStart + a.duration);
        expect(a.totalFloat).toBeGreaterThanOrEqual(0);
        expect(a.freeFloat).toBeGreaterThanOrEqual(0);
        expect(a.freeFloat).toBeLessThanOrEqual(a.totalFloat);
        expect(a.lateFinish).toBeLessThanOrEqual(r.projectDuration);
      }
      expect(r.criticalPath.length).toBeGreaterThan(0);
      // Toda cadeia crítica começa em 0 e alguma atividade crítica termina no fim do projeto.
      const crit = r.activities.filter((a) => a.critical);
      expect(crit.some((a) => a.earlyStart === 0)).toBe(true);
      expect(crit.some((a) => a.earlyFinish === r.projectDuration)).toBe(true);
    }
  });
});

describe("calendário de dias úteis", () => {
  it("pula fins de semana e feriados", () => {
    // 2026-11-02 é segunda-feira.
    expect(workDayAt("2026-11-02", 0)).toBe("2026-11-02");
    expect(workDayAt("2026-11-02", 4)).toBe("2026-11-06");
    expect(workDayAt("2026-11-02", 5)).toBe("2026-11-09");
    expect(workDayAt("2026-11-02", 14)).toBe("2026-11-20");
    expect(workDayAt("2026-11-02", 14, { workWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-11-20"] })).toBe(
      "2026-11-23",
    );
  });

  it("início em fim de semana vai para a segunda seguinte", () => {
    expect(workDayAt("2026-11-07", 0)).toBe("2026-11-09");
  });

  it("converte o resultado do CPM em datas", () => {
    const r = scheduleCpm([
      { id: "A", duration: 5 },
      { id: "B", duration: 2, predecessors: [{ id: "A" }] },
      { id: "M", duration: 0, predecessors: [{ id: "B" }] },
    ]);
    const dates = toCalendarDates(r, "2026-11-02");
    expect(dates[0]).toEqual({ id: "A", startDate: "2026-11-02", finishDate: "2026-11-06" });
    expect(dates[1]).toEqual({ id: "B", startDate: "2026-11-09", finishDate: "2026-11-10" });
    expect(dates[2]).toEqual({ id: "M", startDate: "2026-11-11", finishDate: "2026-11-11" });
  });

  it("rejeita datas e calendários inválidos", () => {
    expect(() => workDayAt("02/11/2026", 0)).toThrowError(CpmError);
    expect(() => workDayAt("2026-02-30", 0)).toThrowError(CpmError);
    expect(() => workDayAt("2026-11-02", 0, { workWeekdays: [], holidays: [] })).toThrowError(CpmError);
    expect(() => workDayAt("2026-11-02", -1)).toThrowError(CpmError);
  });
});

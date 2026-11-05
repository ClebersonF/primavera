import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, PmoError, evaluateFeasibility, normalizePlanning, parseActivityCsv, withActivityPlan, type FeasibilityInput } from "../src";

// Gerador pseudoaleatório determinístico (mulberry32), para o teste ser reproduzível.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function junk(r: () => number, depth = 0): unknown {
  const k = Math.floor(r() * 9);
  if (depth > 3 || k < 3) return [null, undefined, true, 1e309, -1, 0, "", "x", "2026-02-30", NaN, "__proto__", 12345678901234][Math.floor(r() * 12)];
  if (k < 5) return Array.from({ length: Math.floor(r() * 4) }, () => junk(r, depth + 1));
  const o: Record<string, unknown> = {};
  const keys = ["rev", "activityPlans", "changes", "contracts", "payments", "issues", "licenses", "licensing", "fieldDefs", "projectFields", "approvalFlow", "resourceOff", "resourceCapacity", "codeTypes", "kind", "program", "holidays", "history", "baselines", "costs", "__proto__", "constructor", "a", "b"];
  for (let i = 0; i < Math.floor(r() * 6); i++) o[keys[Math.floor(r() * keys.length)]!] = junk(r, depth + 1);
  return o;
}

describe("robustez do planejamento", () => {
  it("normalizePlanning nunca quebra com lixo e é idempotente", () => {
    const r = rng(42);
    for (let i = 0; i < 3000; i++) {
      const raw = junk(r);
      let n: ReturnType<typeof normalizePlanning>;
      try {
        n = normalizePlanning(raw);
      } catch (e) {
        // Recusar com erro do domínio é aceitável; qualquer outro erro é bug.
        expect(e).toBeInstanceOf(PmoError);
        continue;
      }
      expect(JSON.parse(JSON.stringify(normalizePlanning(JSON.parse(JSON.stringify(n)))))).toEqual(JSON.parse(JSON.stringify(n)));
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("não permite poluição de protótipo por chaves perigosas", () => {
    const n = normalizePlanning(JSON.parse('{"activityPlans":{"__proto__":{"durationDays":5},"constructor":{"durationDays":3}},"resourceOff":{"__proto__":["2026-01-01"]},"projectFields":{"__proto__":"x"}}'));
    expect(Object.keys(n.activityPlans)).toEqual([]);
    expect(({} as Record<string, unknown>).durationDays).toBeUndefined();
  });
  it("um planejamento grande (500 atividades) continua pequeno o bastante para o campo de notas do Odoo", () => {
    let p = EMPTY_PLANNING;
    for (let i = 0; i < 500; i++) p = withActivityPlan(p, `imp-act-${i}`, { durationDays: 10, percentComplete: 50, group: "Drenagem pluvial", predecessors: i ? [{ id: `imp-act-${i - 1}` }] : [], actualStart: "2026-01-05" });
    const size = JSON.stringify(p).length;
    expect(size).toBeLessThan(150_000);
  });
});

describe("robustez da importação", () => {
  it("CSV aleatório só falha com erro do domínio", () => {
    const r = rng(7);
    const pieces = ["Descrição", "STATUS", ";", ",", "\t", "\n", '"', "Concluída", "0,5", "01/02/2024", "=1+1", "x".repeat(300), "é", "\r\n", "100%", "Etapa"];
    for (let i = 0; i < 2000; i++) {
      const text = Array.from({ length: Math.floor(r() * 40) }, () => pieces[Math.floor(r() * pieces.length)]).join("");
      try {
        parseActivityCsv(text);
      } catch (e) {
        expect(e).toBeInstanceOf(PmoError);
      }
    }
  });
  it("recusa arquivo com mais de 500 linhas", () => {
    const csv = "Descrição\n" + Array.from({ length: 600 }, (_, i) => `A${i}`).join("\n");
    expect(() => parseActivityCsv(csv)).toThrow(PmoError);
  });
});

describe("robustez da viabilidade", () => {
  it("entradas válidas aleatórias: sem NaN e o caixa fecha com o lucro líquido", () => {
    const r = rng(99);
    for (let i = 0; i < 300; i++) {
      const input: FeasibilityInput = {
        grossArea: 1000 + r() * 1e6,
        cessionRate: r() * 0.7,
        avgLotSize: 100 + r() * 900,
        pricePerSqm: 100 + r() * 3000,
        landCost: r() * 2e7,
        directCosts: Array.from({ length: 1 + Math.floor(r() * 8) }, (_, k) => ({ name: `c${k}`, amount: r() * 5e6, phase: r() < 0.3 ? "projeto" : "obra" })),
        indirectCosts: [{ name: "com", rateOfVgv: r() * 0.08 }, { name: "adm", amount: r() * 3e6 }],
        profitTaxRate: r() * 0.3,
        months: { project: Math.floor(r() * 36), works: Math.floor(r() * 48), sales: 1 + Math.floor(r() * 36) },
        salesStartMonth: r() < 0.5 ? undefined : Math.floor(r() * 60),
        annualDiscountRate: r() * 0.3,
      };
      const res = evaluateFeasibility(input);
      for (const v of [res.vgv, res.costTotal, res.netProfit, res.npv, res.peakExposure]) expect(Number.isFinite(v)).toBe(true);
      const last = res.cashFlow.at(-1)!.cumulative;
      expect(Math.abs(last - res.netProfit)).toBeLessThan(Math.max(5, Math.abs(res.netProfit) * 1e-6));
      if (res.irrAnnual !== null) expect(Number.isFinite(res.irrAnnual)).toBe(true);
    }
  });
});

import { withFeasibility } from "../src";
describe("estudo de viabilidade no planejamento", () => {
  const draft = { grossArea: "1000", cession: "50", lotSize: "400", price: "1000", land: "0", taxRate: "20", discount: "12", project: "6", works: "12", sales: "12", salesStart: "", commission: "5", marketing: "2", admin: "0", fees: "0", direct: [{ name: "Obra", amount: "1000", phase: "obra" as const }] };
  it("grava, sobrevive à normalização e é idempotente", () => {
    const p = withFeasibility(EMPTY_PLANNING, draft);
    expect(p.feasibility).toEqual(draft);
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).feasibility).toEqual(draft);
    expect(withFeasibility(p, draft)).toBe(p);
    expect(withFeasibility(p, undefined).feasibility).toBeUndefined();
  });
  it("rejeita rascunho inválido e descarta lixo ao carregar", () => {
    expect(() => withFeasibility(EMPTY_PLANNING, { ...draft, grossArea: "x".repeat(41) })).toThrow(PmoError);
    expect(normalizePlanning({ feasibility: { grossArea: 1 } }).feasibility).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, NO_PROGRAM, PmoError, inProgram, normalizeProgramPath, normalizePlanning, parseSavedView, parseSavedViews, rollupProgramTree, simulatePortfolio, withProgram } from "../src";

const it_ = (program: string | undefined, budget: number, extra = {}) => ({ program, budget, pv: budget / 2, ev: budget / 4, ...extra });

describe("EPS multinível", () => {
  it("normaliza caminhos e limites", () => {
    expect(normalizeProgramPath("  Rio Pardo>  Bacia  Alta ")).toBe("Rio Pardo > Bacia Alta");
    expect(normalizeProgramPath(" > > ")).toBe("");
    expect(normalizeProgramPath("a>b>c>d>e>f")).toBeNull();
    expect(normalizeProgramPath("x".repeat(121))).toBeNull();
    expect(withProgram(EMPTY_PLANNING, "A>B").program).toBe("A > B");
    expect(() => withProgram(EMPTY_PLANNING, "a>b>c>d>e>f")).toThrow(PmoError);
    expect(withProgram(withProgram(EMPTY_PLANNING, "A > B"), "  ").program).toBeUndefined();
    expect(normalizePlanning({ program: "A>B" }).program).toBe("A > B");
  });
  it("cada nó soma os descendentes; ordem em profundidade; sem programa por último; responsáveis", () => {
    const rows = rollupProgramTree([
      it_("Rio Pardo > Alta", 100, { owner: "Ana", hectares: 5 }),
      it_("Rio Pardo > Baixa", 300, { owner: "Bia", hectares: 7 }),
      it_("Rio Pardo", 50, { owner: "Ana" }),
      it_("Amazônia > Acre", 10),
      it_(undefined, 5, { owner: "Caio" }),
    ]);
    expect(rows.map((r) => `${"-".repeat(r.depth)}${r.label}`)).toEqual(["Amazônia", "-Acre", "Rio Pardo", "-Alta", "-Baixa", NO_PROGRAM]);
    const rp = rows.find((r) => r.path === "Rio Pardo")!;
    expect(rp).toMatchObject({ projects: 3, direct: 1, budget: 450, hectares: 12, owners: ["Ana", "Bia"] });
    expect(rows.find((r) => r.path === "Rio Pardo > Alta")).toMatchObject({ projects: 1, direct: 1, depth: 1 });
    expect(rows.at(-1)).toMatchObject({ projects: 1, owners: ["Caio"] });
    expect(rollupProgramTree([])).toEqual([]);
  });
  it("inProgram: o próprio nó e descendentes", () => {
    expect(inProgram("Rio Pardo > Alta", "Rio Pardo")).toBe(true);
    expect(inProgram("Rio Pardo", "Rio Pardo > Alta")).toBe(false);
    expect(inProgram("Rio Pardos", "Rio Pardo")).toBe(false);
    expect(inProgram(undefined, "")).toBe(true);
    expect(inProgram(undefined, "A")).toBe(false);
  });
});

const proj = (id: string, rank: number, budget: number, extra = {}) => ({ id, name: id, rank, budget, score: 100 - rank * 10, ...extra });
describe("cenário de portfólio", () => {
  const ps = [proj("a", 1, 600, { hectares: 10 }), proj("b", 2, 500, { hectares: 8 }), proj("c", 3, 300, { hectares: 4 }), proj("d", 4, 100)];
  it("sem teto, todos entram", () => {
    const r = simulatePortfolio(ps);
    expect(r.selected).toHaveLength(4);
    expect(r.remaining).toBeNull();
    expect(r.totals).toEqual(r.baseline);
  });
  it("com teto, segue o ranking e pula o que não cabe (um menor, mais abaixo, pode caber)", () => {
    const r = simulatePortfolio(ps, { budgetCap: 1000 });
    expect(r.selected.map((p) => p.id)).toEqual(["a", "c", "d"]); // a=600, b não cabe, c=300, d=100
    expect(r.deferred).toEqual([{ project: ps[1], reason: "sem_orcamento" }]);
    expect(r.remaining).toBe(0);
    expect(r.totals).toMatchObject({ projects: 3, budget: 1000, hectares: 14 });
    expect(r.baseline).toMatchObject({ projects: 4, budget: 1500, hectares: 22 });
  });
  it("fixados entram primeiro; excluídos ficam fora; fixado que estoura o teto é avisado", () => {
    const r = simulatePortfolio(ps, { budgetCap: 700, pinned: ["b"], excluded: ["a"] });
    expect(r.selected.map((p) => p.id)).toEqual(["b", "d"]); // b fixado (500); sobram 200: c (300) não cabe, d (100) cabe
    expect(r.deferred.map((d) => [d.project.id, d.reason]).sort()).toEqual([["a", "excluido"], ["c", "sem_orcamento"]]);
    expect(simulatePortfolio(ps, { budgetCap: 400, pinned: ["a"] }).pinnedOverCap).toBe(true);
    expect(simulatePortfolio(ps, { budgetCap: 700, pinned: ["a"], excluded: ["a"] }).selected.some((p) => p.id === "a")).toBe(false);
  });
  it("valida entradas e soma em centavos", () => {
    expect(() => simulatePortfolio(ps, { budgetCap: -1 })).toThrow(PmoError);
    expect(() => simulatePortfolio([ps[0]!, ps[0]!])).toThrow(PmoError);
    expect(() => simulatePortfolio([proj("x", 1, -5)])).toThrow(PmoError);
    expect(simulatePortfolio([proj("x", 1, 0.1), proj("y", 2, 0.2)]).totals.budget).toBe(0.3);
    expect(simulatePortfolio([]).totals.avgScore).toBeNull();
  });
});

describe("visões salvas", () => {
  const ok = { id: "v1", name: " CALM — diretoria ", preset: "impacto", weights: { nature: 0.1, schedule: 0.2, deadline: 0.2, budget: 0.05, impact: 0.45 }, program: "Rio Pardo", sections: ["programas", "tabela", "inexistente"] };
  it("valida e normaliza", () => {
    expect(parseSavedView(ok)).toMatchObject({ name: "CALM — diretoria", sections: ["programas", "tabela"] });
    expect(parseSavedView({ ...ok, weights: { ...ok.weights, impact: 2 } })).toBeNull();
    expect(parseSavedView({ ...ok, weights: { nature: 0, schedule: 0, deadline: 0, budget: 0, impact: 0 } })).toBeNull();
    expect(parseSavedView({ ...ok, preset: "x" })).toBeNull();
    expect(parseSavedView({ ...ok, name: " " })).toBeNull();
    expect(parseSavedView(null)).toBeNull();
  });
  it("lista: descarta inválidas e duplicadas", () => {
    expect(parseSavedViews([ok, ok, { id: "x" }])).toHaveLength(1);
    expect(parseSavedViews("lixo")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_LOTEADORA, aplicarSeedNovaMarina, cleanLoteadora, registrarAvanco, statusSolicitacao, updateLoteadora } from "../src";

describe("seed Nova Marina e trava do Gate 6", () => {
  const t = "2026-11-25T12:00:00Z";
  it("carrega quadro de áreas, 5 ruas, avanço por gate e 3 aprovações sem sobrescrever o que existe", () => {
    const r = aplicarSeedNovaMarina(EMPTY_LOTEADORA, t, "Cleberson");
    expect(r.estado.trechos.map((x) => x.rua)).toEqual(["Rua da Carpa", "Rua da Corvina", "Rua do Jacundá", "Rua da Tilápia", "Rua do Acará"]);
    expect(r.estado.ficha.areaBrutaM2).toBe(276224.84);
    expect(r.estado.vgv).toBe(127283100);
    expect(r.estado.comercial.breakevenLotes).toBe(80);
    expect(r.estado.solicitacoes.map((s) => s.id)).toEqual(["AL-0001", "AL-0002", "AL-0003"]);
    expect(statusSolicitacao(r.estado.solicitacoes[0]!).proxima).toBe("presidencia");
    // passa pela validação do estado gravado
    const gravado = updateLoteadora(undefined, () => r.estado);
    expect(cleanLoteadora(gravado)!.solicitacoes).toHaveLength(3);
    expect(cleanLoteadora(gravado)!.frentes.length).toBeGreaterThan(8);
    const de = aplicarSeedNovaMarina(r.estado, t, "Cleberson");
    expect(de_novo_ok(de)).toBe(true);
    function de_novo_ok(x: typeof de) { return x.incluidos.length === 0 && x.estado.solicitacoes.length === 3; }
  });
  it("Gate 6: base/CBUQ na Rua da Carpa (guias 80%) não avança; na Corvina (tudo 100%) avança", () => {
    const { estado } = aplicarSeedNovaMarina(EMPTY_LOTEADORA, t, "x");
    expect(() => registrarAvanco(estado.frentes, "R-CARPA", "pavimentacao", 60)).toThrow(/Gate 6/);
    const ok = registrarAvanco(estado.frentes, "R-CORVINA", "pavimentacao", 70);
    expect(ok.find((f) => f.trechoId === "R-CORVINA" && f.frente === "pavimentacao")!.percent).toBe(70);
  });
});

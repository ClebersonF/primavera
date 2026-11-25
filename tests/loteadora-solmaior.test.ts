import { describe, expect, it } from "vitest";
import { EMPTY_LOTEADORA, aplicarSeedNovaMarina, cleanLoteadora, gate, marcarChecklist, registrarAvanco, statusSolicitacao, updateLoteadora } from "../src";

describe("seed Nova Marina (planilha) e trava do Gate 6", () => {
  const t = "2026-11-25T12:00:00Z";
  const atividades = [
    { id: "imp-ter-001", nome: "TER-001 — Abertura das vias principais" },
    { id: "imp-pav-003", nome: "PAV-003 — Camada asfáltica (CBUQ)" },
  ];
  it("carrega quadro de áreas, 25 trechos, terraplenagem concluída, 10 disciplinas e 3 aprovações sem sobrescrever", () => {
    const r = aplicarSeedNovaMarina(EMPTY_LOTEADORA, t, "Cleberson", atividades);
    expect(r.estado.trechos).toHaveLength(25);
    expect(r.estado.trechos.reduce((a, x) => a + (x.pavimentoM2 ?? 0), 0)).toBeCloseTo(49067.54, 1);
    expect(r.estado.ficha.areaBrutaM2).toBe(276224.84);
    expect(r.estado.etapas).toHaveLength(10);
    expect(r.estado.etapas.reduce((a, x) => a + x.orcado, 0)).toBeCloseTo(11024755.67, 2);
    expect(r.estado.etapas[0]!.atividades).toEqual(["imp-ter-001"]);
    expect(r.estado.etapas.find((x) => x.nome.startsWith("Pavimenta"))!.atividades).toEqual(["imp-pav-003"]);
    expect(r.estado.solicitacoes.map((s) => s.id)).toEqual(["AL-0001", "AL-0002", "AL-0003"]);
    expect(statusSolicitacao(r.estado.solicitacoes[0]!).proxima).toBe("presidencia");
    const gravado = cleanLoteadora(updateLoteadora(undefined, () => r.estado))!;
    expect(gravado.frentes.filter((f) => f.concluidaEm)).toHaveLength(25);
    expect(gravado.etapas).toHaveLength(10);
    expect(aplicarSeedNovaMarina(r.estado, t, "Cleberson").incluidos).toEqual([]);
  });
  it("Gate 6: pavimentação travada sem drenagem, água/esgoto e guias concluídas", () => {
    const { estado } = aplicarSeedNovaMarina(EMPTY_LOTEADORA, t, "x");
    expect(gate(estado.frentes, "T02", "pavimentacao").travas.join(" ")).toMatch(/Drenagem/);
    // frente de pavimentação iniciada fora de ordem não avança
    const iniciada = marcarChecklist(estado.frentes, "T02", "pavimentacao", 0, true, "x", "2026-11-25").map((f) =>
      f.trechoId === "T02" && f.frente === "pavimentacao" ? { ...f, iniciadaEm: "2026-11-20" } : f,
    );
    expect(() => registrarAvanco(iniciada, "T02", "pavimentacao", 30)).toThrow(/Gate 6/);
  });
});

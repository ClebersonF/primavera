import { describe, expect, it } from "vitest";
import {
  aplicarCorrecoesNovaMarinaV2, aplicarSeedNovaMarina, cleanDiario, compararReforecast, EMPTY_LOTEADORA, ETAPA_AJUSTE_ID, fundoRetencao,
  impactoVetor, importPlanilhaAcompanhamentoCsv, liberarMarco, liberarRetencao, planilhaAcompanhamentoCsv, reservar, statusEspelho,
  travasLiberacaoMarco, updateLoteadora, validarMarcoJuridico, cleanPlanoDiretor,
  type Caucao, type Comercial, type FrenteTrecho, type Lote,
} from "../src";

const AGORA = "2026-11-26T12:00:00Z";

describe("Pendência 1/2 — correções do piloto Nova Marina", () => {
  it("fecha orçado, reforecast e realizado oficiais, inclui processos e titulares, e é idempotente", () => {
    const base = aplicarSeedNovaMarina(EMPTY_LOTEADORA, AGORA, "Sistema").estado;
    expect(base.ficha.municipio).toBe("Peruíbe");
    const r = aplicarCorrecoesNovaMarinaV2(base, AGORA, "Sistema", 1_000_000);
    const s = updateLoteadora(undefined, () => r.estado);
    expect(s.ficha.municipio).toBe("Bragança Paulista");
    const c = compararReforecast(s.etapas, s.reforecasts, {}, s.vgv);
    expect(c.totalOrcado).toBeCloseTo(13_511_201.27, 2);
    expect(c.totalReforecast).toBeCloseTo(14_714_432.68, 2);
    expect(c.totalRealizado).toBeCloseTo(7_404_922.1, 2); // + 1.000.000 que o sistema já tem = 8.404.922,10
    expect(s.reforecasts[0]!.mes).toBe("2026-10");
    expect(s.processos.map((p) => p.orgao)).toEqual(["GRAPROHAB / SDUH", "Prefeitura de Bragança Paulista", "CETESB", "SP Águas / DAEE"]);
    expect(s.equipe.find((m) => m.papel === "juridico")?.nome).toBe("Dra. Juliana");
    expect(s.equipe.find((m) => m.papel === "presidente")?.nome).toBe("José Benedito da Cruz Monte");
    const de2 = aplicarCorrecoesNovaMarinaV2(s, AGORA, "Sistema", 1_000_000);
    expect(de2.incluidos).toEqual([]);
    expect(s.etapas.filter((x) => x.id === ETAPA_AJUSTE_ID)).toHaveLength(1);
  });
});

describe("Pendência 3 — Plano Diretor", () => {
  it("guarda taxa de ocupação, coeficiente e vistos técnicos sem repetição", () => {
    const pd = cleanPlanoDiretor({ taxaOcupacaoMax: 0.6, coefAproveitamentoMax: 1.5, vistos: [{ nome: "Luciano", em: "2026-11-20" }, { nome: "luciano", em: "2026-11-21" }, { nome: "Evaristo", em: "2026-11-20" }] });
    expect(pd).toMatchObject({ taxaOcupacaoMax: 0.6, coefAproveitamentoMax: 1.5 });
    expect(pd!.vistos!.map((v) => v.nome)).toEqual(["Luciano", "Evaristo"]);
  });
});

describe("Pendência 4 — caução com gatilho físico, vistoria e Jurídico", () => {
  const frentes = [
    { trechoId: "T01", frente: "drenagem", percent: 100, concluidaEm: "2026-10-01", checklist: [] },
    { trechoId: "T02", frente: "drenagem", percent: 40, checklist: [] },
  ] as unknown as FrenteTrecho[];
  const c: Caucao = { tipo: "lotes", termo: "TC-01", firmadoEm: "2026-02-01", prazoObrasAte: "2027-12-01", lotes: ["A-1"], marcos: [{ id: "MC-01", descricao: "Drenagem", previstoEm: "2026-12-01", lotes: ["A-1"], frente: "drenagem", avancoMinPct: 100, trechos: ["T01", "T02"] }] };
  it("só libera com avanço, termo de vistoria parcial e validação jurídica; lote aparece como caucionado", () => {
    expect(travasLiberacaoMarco(c.marcos[0]!, frentes)).toHaveLength(3);
    expect(() => liberarMarco(c, "MC-01", "2026-11-26", frentes)).toThrow(/Liberação travada/);
    const lote: Lote = { id: "A-1", quadra: "A", numero: "1", areaM2: 300, matricula: "M1", fisico: "a_executar", comercial: "disponivel" };
    const vazio: Comercial = { reservas: [], propostas: [], vendas: [] };
    expect(statusEspelho(lote, vazio, AGORA, c)).toBe("caucionado");
    expect(() => reservar(vazio, { ...lote, comercial: "caucionado" }, undefined, { doc: "52998224725", nome: "Ana" }, "X", AGORA)).toThrow();
    const ok = frentes.map((f) => ({ ...f, percent: 100, concluidaEm: "2026-11-20" }));
    let c2 = validarMarcoJuridico({ ...c, marcos: [{ ...c.marcos[0]!, termoVistoriaParcial: "TVP 12/2026" }] }, "MC-01", "Dra. Juliana", "2026-11-25");
    c2 = liberarMarco(c2, "MC-01", "2026-11-26", ok);
    expect(statusEspelho(lote, vazio, AGORA, c2)).toBe("disponivel");
  });
});

describe("Pendência 5 — vetores estruturados", () => {
  it("guarda a situação do vetor e calcula pessoal pelo efetivo previsto × real", () => {
    const d = cleanDiario({ data: "2026-11-20", efetivo: 8, efetivoPrevisto: 20, equipamentos: "", clima: "sol", chuvaMm: 0, texto: "", avancos: [], fotos: [], registradoEm: "2026-11-20T17:00:00Z", por: "Canteiro", vetores: { material: { impacto: "parcial", tipo: "atraso" }, equipamento: { impacto: "nenhum", tipo: "invalido" } } })!;
    expect(d.vetores!.material).toEqual({ impacto: "parcial", tipo: "atraso" });
    expect(d.vetores!.equipamento!.tipo).toBeUndefined();
    expect(impactoVetor(d, "pessoal")).toBe("paralisou");
    expect(impactoVetor({ ...d, efetivo: 15 }, "pessoal")).toBe("parcial");
  });
});

describe("Pendência 6 — Planilha Própria (ida e volta)", () => {
  it("importa a planilha exportada sem duplicar e cria processos novos", () => {
    const procs = aplicarCorrecoesNovaMarinaV2(aplicarSeedNovaMarina(EMPTY_LOTEADORA, AGORA, "S").estado, AGORA, "S").estado.processos;
    const csv = planilhaAcompanhamentoCsv(procs, "2026-11-26");
    const ida = importPlanilhaAcompanhamentoCsv(csv, procs);
    expect(ida).toMatchObject({ novos: 0, atualizados: 0 });
    const r = importPlanilhaAcompanhamentoCsv("frente;orgao;assunto;protocolo;situacao\nB;CETESB;Licenciamento ambiental e TCRA de 6.915 mudas (plantio compensatório);e-Amb 123;Protocolado\nD;DER;Acesso pela SP-063;;", procs);
    expect(r).toMatchObject({ novos: 1, atualizados: 1 });
    expect(r.processos.find((p) => p.orgao === "CETESB")).toMatchObject({ protocolo: "e-Amb 123", situacao: "protocolado" });
    expect(r.processos.at(-1)).toMatchObject({ frente: "rodoviario", situacao: "em_elaboracao" });
  });
});

describe("Pendência 7 — fundo de retenção", () => {
  it("soma retido por fornecedor e trava a devolução com RNC aberta", () => {
    const f = fundoRetencao([{ id: "F1", nome: "Pavimix" }, { id: "F2", nome: "Edlin" }], [{ fornecedorId: "F1", retido: 1000 }, { fornecedorId: "F1", retido: 500 }, { fornecedorId: "F2", retido: 200 }], [], [], [{ id: "RNC-001", fornecedorId: "F2" }]);
    expect(f.map((x) => [x.nome, x.saldo, x.travas.length])).toEqual([["Pavimix", 1500, 0], ["Edlin", 200, 1]]);
    const l = liberarRetencao([], f[0]!, 1500, "CFO", "2026-11-26");
    expect(l[0]).toMatchObject({ id: "LR-001", valor: 1500 });
    expect(() => liberarRetencao([], f[1]!, 100, "CFO", "2026-11-26")).toThrow(/RNC/);
    const s = updateLoteadora(undefined, (x) => ({ ...x, retencoesLiberadas: l }));
    expect(s.retencoesLiberadas).toHaveLength(1);
  });
});

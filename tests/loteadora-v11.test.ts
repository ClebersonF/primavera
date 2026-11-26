import { describe, expect, it } from "vitest";
import {
  EMPTY_LOTEADORA, acionarGarantia, alertasLoteadora, conformidadePlanoDiretor, gate, incluirRisco, indiceGarantias, kpisPerfil, liberarMarco,
  novaGarantia, papeisDoNivel, pendenciasGarantiaTrecho, pendenciasMatriz, planilhaAcompanhamentoCsv, reservar, resolverAcionamento, resumoVetores,
  retencaoTravada, situacaoCaucao, statusGarantia, travaCaucao, travasProtocolo, updateLoteadora, vencimentoGarantia,
  type Caucao, type Comercial, type DiarioObra, type FrenteTrecho, type Lote, type ProcessoRegulatorio,
} from "../src";

const CPF = "52998224725";
const lote = (id: string, areaM2 = 300): Lote => ({ id, quadra: id.split("-")[0]!, numero: id.split("-")[1]!, areaM2, matricula: `M${id}`, fisico: "a_executar", comercial: "disponivel" });
const frentes: FrenteTrecho[] = [
  { trechoId: "T01", frente: "drenagem", iniciadaEm: "2026-01-10", concluidaEm: "2026-03-10", percent: 100, checklist: [] } as unknown as FrenteTrecho,
  { trechoId: "T01", frente: "pavimentacao", iniciadaEm: "2026-04-01", concluidaEm: "2026-06-01", percent: 100, checklist: [] } as unknown as FrenteTrecho,
];

describe("v1.1 — garantias de terceiros", () => {
  it("prazo padrão, status, acionamento com trava de retenção e Gate 8", () => {
    let g = novaGarantia([], { tipo: "obra_civil", fornecedor: "Pavimix", servico: "Pavimentação T01", frente: "pavimentacao", trechoId: "T01", inicio: "2026-06-01" });
    expect(g[0]).toMatchObject({ id: "GAR-001", prazoMeses: 60 });
    expect(vencimentoGarantia(g[0]!)).toBe("2031-06-01");
    expect(statusGarantia(g[0]!, "2031-04-01")).toBe("vencendo");
    expect(pendenciasGarantiaTrecho(g, frentes, "T01", "2026-11-25")).toEqual(["Sem garantia vigente de drenagem pluvial"]);
    expect(gate(frentes, "T01", "tvo", 0, pendenciasGarantiaTrecho(g, frentes, "T01", "2026-11-25")).travas).toContain("Sem garantia vigente de drenagem pluvial");
    expect(indiceGarantias(g, frentes, "2026-11-25")).toEqual({ exigidas: 2, cobertas: 1, pct: 0.5 });
    g = acionarGarantia(g, "GAR-001", "Trinca no pavimento", "Canteiro", "2026-11-20");
    expect(statusGarantia(g[0]!, "2026-11-25")).toBe("acionada");
    expect(retencaoTravada(g, "pavimix")).toMatch(/retenção travada/);
    const s = { ...EMPTY_LOTEADORA, garantias: g };
    const al = alertasLoteadora(s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z" });
    expect(al.find((a) => a.area === "garantias")).toMatchObject({ nivel: "vermelho" });
    g = resolverAcionamento(g, "GAR-001", "2026-11-24");
    expect(retencaoTravada(g, "Pavimix")).toBeNull();
  });
});

describe("v1.1 — caução junto à Prefeitura", () => {
  const caucao: Caucao = { tipo: "lotes", termo: "TC-01/2026", firmadoEm: "2026-02-01", prazoObrasAte: "2027-02-01", lotes: ["A-1", "A-2"], marcos: [{ id: "MC-01", descricao: "Drenagem e água", previstoEm: "2026-10-01", lotes: ["A-1"] }] };
  it("lote caucionado não reserva; marco liberado libera o lote; prazo e marcos geram alerta", () => {
    expect(travaCaucao("A-1", caucao)).toMatch(/caução municipal/);
    const vazio: Comercial = { reservas: [], propostas: [], vendas: [], tabela: { publicadaEm: "2026-11-01", publicadaPor: "P", precoM2: 1000, ajusteQuadra: {}, precoLote: {}, entradaMin: 0.1, parcelasMax: 120, jurosMes: 0.01 } };
    const cart = { decretoEm: "2026-06-01", notas: [], registradoEm: "2026-10-01" };
    expect(() => reservar(vazio, lote("A-1"), cart, { doc: CPF, nome: "Ana" }, "X", "2026-11-25T12:00:00Z", caucao)).toThrow(/caução/);
    const lib = liberarMarco(caucao, "MC-01", "2026-11-20");
    expect(travaCaucao("A-1", lib)).toBeNull();
    expect(situacaoCaucao(caucao, "2026-11-25")).toMatchObject({ presos: 2, diasPrazo: 68 });
    const s = updateLoteadora(undefined, (x) => ({ ...x, caucao }));
    expect(s.caucao?.termo).toBe("TC-01/2026");
    const al = alertasLoteadora(s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z" }).filter((a) => a.area === "garantias");
    expect(al.map((a) => a.titulo)).toEqual(["Prazo de obras da caução", "Liberação de caução atrasada"]);
    expect(kpisPerfil("presidencia", s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z" }).kpis.find((k) => k.rotulo === "Caução municipal")?.valor).toBe("2 lote(s) caucionado(s)");
  });
});

describe("v1.1 — Plano Diretor, Matriz de Risco e Jurídico", () => {
  it("trava urbanística e de protocolo", () => {
    const ficha = { areaBrutaM2: 1000, areaCessaoM2: 300, planoDiretor: { lei: "LC 1/2020", loteMinimoM2: 250, areasPublicasMinPct: 0.35, analisadoEm: "2026-01-10", conforme: true } };
    const pd = conformidadePlanoDiretor(ficha, [lote("A-1", 200), lote("A-2", 300)]);
    expect(pd.status).toBe("nao_conforme");
    expect(pd.pendencias).toHaveLength(2);
    expect(conformidadePlanoDiretor({}).status).toBe("pendente");
    let proc: ProcessoRegulatorio = { id: "PR-001", frente: "municipal", orgao: "Prefeitura", assunto: "Aprovação", situacao: "em_analise", eventos: [] } as unknown as ProcessoRegulatorio;
    expect(travasProtocolo(proc, "conforme")).toHaveLength(1);
    expect(() => incluirRisco(proc, { descricao: "Exigência de EIV", probabilidade: 4, impacto: 4, revisadoEm: "2026-11-01" })).toThrow(/mitigação/);
    proc = incluirRisco(proc, { descricao: "Exigência de EIV", probabilidade: 4, impacto: 4, mitigacao: "Antecipar estudo", revisadoEm: "2026-11-01" });
    expect(travasProtocolo(proc, "conforme")).toEqual([]);
    expect(pendenciasMatriz(proc, "2026-11-25")).toEqual(["Matriz de Risco sem revisão há 24 dias"]);
    expect(planilhaAcompanhamentoCsv([proc], "2026-11-25").split("\n")).toHaveLength(2);
    expect(papeisDoNivel("vermelho", "canteiro")).toContain("juridico");
    expect(papeisDoNivel("amarelo", "canteiro")).not.toContain("juridico");
  });
});

describe("v1.1 — 5 vetores de campo", () => {
  it("resume impacto por vetor e alerta acima de 7 dias em 30", () => {
    const dia = (d: number, extra: Partial<DiarioObra> = {}): DiarioObra => ({ data: `2026-11-${String(d).padStart(2, "0")}`, efetivo: 10, equipamentos: "", clima: "sol", chuvaMm: 0, texto: "", avancos: [], fotos: [], registradoEm: `2026-11-${String(d).padStart(2, "0")}T17:00:00Z`, por: "Canteiro", ...extra });
    const diarios = Array.from({ length: 9 }, (_, i) => dia(i + 2, { vetores: { material: { impacto: i === 0 ? "paralisou" : "parcial", obs: "Atraso de tubos" } } }));
    diarios.push(dia(20, { clima: "chuva_forte", chuvaMm: 40 }));
    const r = resumoVetores(diarios, "2026-11-01", "2026-11-30");
    expect(r.find((x) => x.vetor === "material")).toMatchObject({ diasComImpacto: 9, diasParalisados: 1, ultimaObs: "Atraso de tubos" });
    expect(r.find((x) => x.vetor === "chuva")!.diasComImpacto).toBe(1);
    const s = { ...EMPTY_LOTEADORA, diarios };
    const al = alertasLoteadora(s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z" });
    expect(al.some((a) => a.titulo === "Vetor de campo: Entrega de material")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  EMPTY_LOTEADORA, EMPTY_PLANNING, alertasLoteadora, diasDeChuvaPendentes, emitirOS, fecharQuinzena, gate, importEtapasCsv, indicePega,
  novoBoletim, periodoBloqueadoAte, quinzenaAFechar, registrarVistoria, statusPlantio, travasOS, updateLoteadora, vgvReferencia, vincularAtividade,
  withDiaDeChuva, withLoteadora, type DiarioObra, type Fornecedor, type Plantio,
} from "../src";

const forn: Fornecedor = {
  id: "F-001", nome: "Terra SP", frentes: ["terraplenagem"], experienciaSp: { m3: 10_000 }, garantiaAnos: 5, abnt: true,
  certidoes: { cnd_federal: "2027-06-01", fgts: "2027-06-01", trabalhista: "2027-06-01", estadual: "2027-06-01", municipal: "2027-06-01" },
};
const dia = (data: string, extra: Partial<DiarioObra> = {}): DiarioObra => ({ data, efetivo: 10, equipamentos: "", clima: "sol", chuvaMm: 0, texto: "", avancos: [], fotos: [], registradoEm: `${data}T17:00:00-03:00`, por: "H", ...extra });

describe("OS antes da frente (4.6)", () => {
  it("exige homologação, frente, integração SST, contrato e ART", () => {
    const dados = { contratoNumero: "CT-7", contratoAssinadoEm: "2026-11-20", artNumero: "ART-123" };
    expect(travasOS(forn, "terraplenagem", dados, "2026-11-25")).toEqual(["Integração de segurança (SST) em canteiro não registrada"]);
    expect(travasOS({ ...forn, sstIntegracaoEm: "2026-11-21" }, "drenagem", { ...dados, artNumero: "" }, "2026-11-25")).toHaveLength(2);
    const l = emitirOS([], "T1", "terraplenagem", { ...forn, sstIntegracaoEm: "2026-11-21" }, dados, "Fernando", "2026-11-25");
    expect(gate(l, "T1", "terraplenagem").situacao).toBe("liberada");
    expect(l[0]!.os?.artNumero).toBe("ART-123");
  });
  it("liga a frente à atividade do cronograma e alerta o atraso", () => {
    const frentes = vincularAtividade([], "T1", "drenagem", "a7");
    const al = alertasLoteadora({ ...EMPTY_LOTEADORA, frentes }, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z", atrasos: [{ atividade: "Drenagem", dias: 4, id: "a7" }] });
    expect(al.find((a) => a.area === "canteiro")?.detalhe).toMatch(/4 dia/);
  });
});

describe("orçamento base por CSV (1.4)", () => {
  it("liga atividades por id ou nome e aponta as não encontradas", () => {
    const r = importEtapasCsv("Etapa;Orçado (R$);Atividades\nTerraplenagem;\"1.200.000,00\";a1|Drenagem pluvial\nPavimentação;800000;xyz", [{ id: "a1", nome: "Corte e aterro" }, { id: "a2", nome: "Drenagem Pluvial" }]);
    expect(r.itens.map((e) => [e.nome, e.orcado, e.atividades])).toEqual([["Terraplenagem", 1_200_000, ["a1", "a2"]], ["Pavimentação", 800_000, []]]);
    expect(r.erros[0]!.mensagem).toMatch(/xyz/);
  });
});

describe("chuva no cronograma (3.8)", () => {
  it("dia de chuva útil fica pendente; aceito vira feriado da obra", () => {
    const diarios = [dia("2026-11-23", { chuvaMm: 25 }), dia("2026-11-22", { clima: "chuva_forte" }), dia("2026-11-24")];
    expect(diasDeChuvaPendentes(diarios, {})).toEqual(["2026-11-23"]);
    let p = withLoteadora(EMPTY_PLANNING, (s) => ({ ...s, diarios }));
    p = withDiaDeChuva(p, "2026-11-23", "aceito");
    expect(p.holidays).toContain("2026-11-23");
    expect(diasDeChuvaPendentes(p.loteadora!.diarios, p.loteadora!.chuvaDecisoes)).toEqual([]);
  });
});

describe("margem com vendas reais (5.6)", () => {
  it("usa vendido + estoque pela tabela", () => {
    const lotes = [{ id: "A-1", quadra: "A", numero: "1", areaM2: 100, fisico: "a_executar" as const, comercial: "vendido" as const }, { id: "A-2", quadra: "A", numero: "2", areaM2: 100, fisico: "a_executar" as const, comercial: "bloqueado" as const }];
    const tabela = { publicadaEm: "2026-11-01", publicadaPor: "L", precoM2: 1000, ajusteQuadra: {}, precoLote: {}, entradaMin: 0.1, parcelasMax: 12, jurosMes: 0 };
    const c = { tabela, reservas: [], propostas: [], vendas: [{ id: "CV-0001", propostaId: "PP-0001", loteId: "A-1", comprador: { doc: "52998224725", nome: "Ana" }, valor: 90_000, entrada: 9_000, parcelas: [], assinadoEm: "2026-11-10" }] };
    expect(vgvReferencia(lotes, c, 1)).toEqual({ valor: 190_000, fonte: "vendas" });
    expect(vgvReferencia(lotes, { reservas: [], propostas: [], vendas: [] }, 500)).toEqual({ valor: 500, fonte: "referencia" });
  });
});

describe("fechamento quinzenal (T5)", () => {
  it("fecha a quinzena, bloqueia o período e não desfaz", () => {
    const b = { ...novoBoletim({ id: "BM-001", fornecedorId: "F-001", trechoId: "T1", frente: "terraplenagem", quinzena: "2026-11-15", criadoPor: "H" }) };
    expect(() => fecharQuinzena([], "2026-11-15", [b], "Evaristo", "2026-11-20T10:00:00Z")).toThrow(/BM-001/);
    const conferido = { ...b, status: "conferido" as const };
    const f = fecharQuinzena([], "2026-11-15", [conferido], "Evaristo", "2026-11-20T10:00:00Z");
    expect(periodoBloqueadoAte(f)).toBe("2026-11-15");
    const s0 = updateLoteadora(undefined, (s) => ({ ...s, diarios: [dia("2026-11-10")], boletins: [conferido], fechamentos: f }));
    expect(() => updateLoteadora(s0, (s) => ({ ...s, diarios: [dia("2026-11-10", { efetivo: 20 })] }))).toThrow(/período fechado/);
    expect(() => updateLoteadora(s0, (s) => ({ ...s, boletins: s.boletins.map((x) => ({ ...x, itens: [{ descricao: "x", unidade: "m", quantidade: 1, precoUnit: 1 }] })) }))).toThrow(/quinzena fechada/);
    expect(updateLoteadora(s0, (s) => ({ ...s, boletins: s.boletins.map((x) => ({ ...x, status: "liberado" as const })) })).boletins[0]!.status).toBe("liberado");
    expect(() => updateLoteadora(s0, (s) => ({ ...s, fechamentos: [] }))).toThrow(/desfeitos/);
    expect(updateLoteadora(s0, (s) => ({ ...s, diarios: [...s.diarios, dia("2026-11-18")] })).diarios).toHaveLength(2);
    expect(quinzenaAFechar(f, "2026-12-08")).toMatchObject({ quinzena: "2026-11-30", nivel: "amarelo" });
  });
});

describe("plantio compensatório (T9)", () => {
  const pl: Plantio = { id: "PL-01", tcra: "TCRA 123/2026", local: "APP do córrego", exigidas: 200, plantioEm: "2026-08-10", meses: 24, metaPega: 0.85, vistorias: [] };
  it("cobra a vistoria mensal e alerta pega baixa", () => {
    expect(statusPlantio(pl, "2026-11-25")).toMatchObject({ nivel: "amarelo", mes: 3 });
    const p2 = registrarVistoria(pl, { mes: "2026-10", vivas: 150, replantadas: 0 }, "Mario", "2026-11-05T10:00:00Z");
    expect(indicePega(p2)).toBe(0.75);
    expect(statusPlantio(p2, "2026-11-05").nivel).toBe("amarelo");
    expect(() => registrarVistoria(pl, { mes: "2027-01", vivas: 1, replantadas: 0 }, "M", "2026-11-05T10:00:00Z")).toThrow(/futuro/);
    const fim = registrarVistoria(pl, { mes: "2028-09", vivas: 190, replantadas: 10 }, "M", "2028-09-20T10:00:00Z");
    expect(statusPlantio(fim, "2028-09-20")).toMatchObject({ encerrado: true, nivel: "verde" });
  });
});

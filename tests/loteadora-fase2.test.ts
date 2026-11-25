import { describe, expect, it } from "vitest";
import {
  EMPTY_LOTEADORA, PmoError, gravarOS, abrirRnc, alertasLoteadora, aplicarAvancos, avancoTrecho, cleanLoteadora, concluirFrente, conferirBoletim,
  devolverBoletim, diarioNoPrazo, diariosFaltando, enviarBoletim, escolherProposta, gate, homologacao, iniciarFrente, isQuinzena, liberarPagamento,
  liquidoBoletim, marcarChecklist, novaRevisao, novoBoletim, pagarBoletim, pranchasObsoletas, prazoRnc, quinzenaDe, realizadoMedicoes,
  registrarCorrecao, registrarPlano, rncsAbertasNoTrecho, scoreFornecedor, travasConferencia, updateLoteadora, validarCorrecao, valorBoletim,
  type Cotacao, type DiarioObra, type Fornecedor, type FrenteTrecho, type Prancha,
} from "../src";

const os = (l: FrenteTrecho[], t: string, f: Parameters<typeof marcarChecklist>[2]) =>
  gravarOS(l, t, f, { fornecedorId: "F-001", contratoNumero: "CT-1", contratoAssinadoEm: "2026-10-01", artNumero: "ART-1", emitidaEm: "2026-10-02", por: "Fernando" });
const tudoOk = (l: FrenteTrecho[], t: string, f: Parameters<typeof marcarChecklist>[2]) => {
  let out = l;
  const n = out.find((x) => x.trechoId === t && x.frente === f)!.checklist.length;
  for (let i = 0; i < n; i++) out = marcarChecklist(out, t, f, i, true, "Hércules", "2026-11-10");
  return out;
};

describe("gates anti-refação por trecho", () => {
  it("só libera a pavimentação com drenagem, água/esgoto e guias concluídas", () => {
    let l: FrenteTrecho[] = [];
    expect(gate(l, "T1", "terraplenagem").travas).toEqual(["Sem OS emitida (contrato, ART e integração de SST)"]);
    expect(gate(os(l, "T1", "terraplenagem"), "T1", "terraplenagem").situacao).toBe("liberada");
    expect(gate(l, "T1", "pavimentacao").travas).toHaveLength(4);
    expect(() => iniciarFrente(os(l, "T1", "drenagem"), "T1", "drenagem", "2026-11-01")).toThrow(/Trava anti-refação/);
    l = iniciarFrente(os(l, "T1", "terraplenagem"), "T1", "terraplenagem", "2026-11-01");
    expect(() => concluirFrente(l, "T1", "terraplenagem", "2026-11-05")).toThrow(/Checklist/);
    l = tudoOk(l, "T1", "terraplenagem");
    l = concluirFrente(l, "T1", "terraplenagem", "2026-11-10");
    for (const f of ["drenagem", "agua_esgoto", "guias"] as const) {
      l = iniciarFrente(os(l, "T1", f), "T1", f, "2026-11-11");
      l = tudoOk(l, "T1", f);
      l = concluirFrente(l, "T1", f, "2026-11-20");
    }
    expect(gate(os(l, "T1", "pavimentacao"), "T1", "pavimentacao").situacao).toBe("liberada");
    expect(gate(l, "T2", "pavimentacao").situacao).toBe("bloqueada");
    expect(avancoTrecho(l, "T1")).toBe(50);
  });
  it("TVO e conclusão travam com RNC aberta no trecho", () => {
    let l = iniciarFrente(os([], "T1", "terraplenagem"), "T1", "terraplenagem", "2026-11-01");
    l = tudoOk(l, "T1", "terraplenagem");
    expect(() => concluirFrente(l, "T1", "terraplenagem", "2026-11-10", 1)).toThrow(/RNC/);
    expect(gate([], "T1", "tvo", 2).travas.at(-1)).toMatch(/2 RNC/);
  });
});

describe("diário de obra", () => {
  const d = (data: string, reg: string, extra: Partial<DiarioObra> = {}): DiarioObra => ({ data, efetivo: 12, equipamentos: "", clima: "sol", chuvaMm: 0, texto: "", avancos: [], fotos: [], registradoEm: reg, por: "Hércules", ...extra });
  it("confere o limite das 17h30 no horário do canteiro", () => {
    expect(diarioNoPrazo(d("2026-11-24", "2026-11-24T17:20:00-03:00"))).toBe(true);
    expect(diarioNoPrazo(d("2026-11-24", "2026-11-24T18:05:00-03:00"))).toBe(false);
    expect(diarioNoPrazo(d("2026-11-24", "2026-11-24T20:00:00Z"))).toBe(true); // 17h00 em Brasília
  });
  it("lista dias úteis sem diário; hoje só conta depois das 17h30", () => {
    const ds = [d("2026-11-23", "2026-11-23T17:00:00-03:00")];
    expect(diariosFaltando(ds, "2026-11-20", "2026-11-25T10:00")).toEqual(["2026-11-20", "2026-11-24"]);
    expect(diariosFaltando(ds, "2026-11-20", "2026-11-25T18:00")).toEqual(["2026-11-20", "2026-11-24", "2026-11-25"]);
  });
  it("avanço do diário só vale em frente iniciada e não regride", () => {
    let l = iniciarFrente(os([], "T1", "terraplenagem"), "T1", "terraplenagem", "2026-11-01");
    l = aplicarAvancos(l, d("2026-11-02", "x", { avancos: [{ trechoId: "T1", frente: "terraplenagem", percent: 40 }] }));
    l = aplicarAvancos(l, d("2026-11-03", "x", { avancos: [{ trechoId: "T1", frente: "terraplenagem", percent: 30 }] }));
    expect(l[0]!.percent).toBe(40);
    expect(() => aplicarAvancos(l, d("2026-11-03", "x", { avancos: [{ trechoId: "T1", frente: "drenagem", percent: 10 }] }))).toThrow(PmoError);
  });
});

describe("RNC", () => {
  const r0 = abrirRnc({ id: "RNC-001", trechoId: "T1", frente: "guias", fornecedorId: "F-001", descricao: "Guia fora de alinhamento", gravidade: "grave", abertaEm: "2026-11-10T09:00:00Z", abertaPor: "Hércules" });
  it("cobra plano em 48 h e encerra só com validação", () => {
    expect(prazoRnc(r0, "2026-11-12T10:00:00Z").nivel).toBe("vermelho");
    let r = registrarPlano(r0, "Refazer 30 m de guia até sexta", "Empreiteira", "2026-11-11T08:00:00Z");
    expect(() => validarCorrecao(r, "2026-11-13", "Evaristo")).toThrow(/correção/);
    r = registrarCorrecao(r, "2026-11-13", 4200);
    expect(rncsAbertasNoTrecho([r], "T1")).toBe(1);
    r = validarCorrecao(r, "2026-11-14", "Evaristo");
    expect(rncsAbertasNoTrecho([r], "T1")).toBe(0);
  });
});

describe("boletim de medição", () => {
  it("valida quinzena, bloqueia com RNC e exige aditivo acima do contrato", () => {
    expect(isQuinzena("2026-11-15")).toBe(true);
    expect(isQuinzena("2026-11-30")).toBe(true);
    expect(isQuinzena("2026-11-29")).toBe(false);
    expect(quinzenaDe("2026-02-20")).toBe("2026-02-28");
    let b = novoBoletim({ id: "BM-001", fornecedorId: "F-001", trechoId: "T1", frente: "drenagem", quinzena: "2026-11-15", criadoPor: "Hércules", atividadeId: "a1", saldoContrato: 10_000 });
    expect(() => enviarBoletim(b, "2026-11-16T10:00:00Z")).toThrow(/item/);
    b = { ...b, itens: [{ descricao: "Tubo 600", unidade: "m", quantidade: 120, precoUnit: 100 }] };
    expect(() => enviarBoletim(b, "2026-11-16T10:00:00Z")).toThrow(/foto/);
    b = enviarBoletim({ ...b, fotoIds: ["f1"] }, "2026-11-16T10:00:00Z");
    expect(valorBoletim(b)).toBe(12_000);
    expect(travasConferencia(b, { rncAbertas: 1 })).toHaveLength(2);
    expect(() => conferirBoletim(b, { rncAbertas: 0 }, "Evaristo", "2026-11-17T10:00:00Z")).toThrow(/aditivo/);
    b = conferirBoletim({ ...b, aditivoId: "AL-0003" }, { rncAbertas: 0, aditivoAprovado: true }, "Evaristo", "2026-11-17T10:00:00Z");
    expect(() => liberarPagamento(b, { nfNumero: "123", nfEm: "2026-11-18", fiscalOk: true, sstOk: false, retencaoPct: 5 }, "Fernando", "2026-11-18T10:00:00Z")).toThrow(/SST/);
    b = liberarPagamento(b, { nfNumero: "123", nfEm: "2026-11-18", fiscalOk: true, sstOk: true, retencaoPct: 5 }, "Fernando", "2026-11-18T10:00:00Z");
    expect(liquidoBoletim(b)).toBe(11_400);
    b = pagarBoletim(b, "2026-11-25");
    expect(realizadoMedicoes([b])).toEqual({ a1: 12_000 });
  });
  it("devolução limpa a conferência e permite reenvio", () => {
    let b = novoBoletim({ id: "BM-002", fornecedorId: "F-001", trechoId: "T1", frente: "drenagem", quinzena: "2026-11-30", criadoPor: "H" });
    b = enviarBoletim({ ...b, itens: [{ descricao: "x", unidade: "m", quantidade: 1, precoUnit: 1 }], fotoIds: ["f"] }, "2026-12-01T10:00:00Z");
    b = devolverBoletim(b, "Evaristo", "2026-12-02T10:00:00Z", "Quantitativo diverge da foto");
    expect(b.status).toBe("devolvido");
    expect(enviarBoletim(b, "2026-12-03T10:00:00Z").status).toBe("enviado");
  });
});

describe("suprimentos", () => {
  const forn = (id: string, extra: Partial<Fornecedor> = {}): Fornecedor => ({
    id, nome: `Forn ${id}`, frentes: ["drenagem"], experienciaSp: { m: 5000 }, garantiaAnos: 5, abnt: true,
    certidoes: { cnd_federal: "2027-06-01", fgts: "2027-01-01", trabalhista: "2027-06-01", estadual: "2027-06-01", municipal: "2026-12-10" }, ...extra,
  });
  it("homologa por métricas, garantia de 5 anos e certidões; score cai com RNC", () => {
    expect(homologacao(forn("F-1"), "2026-11-25")).toMatchObject({ apto: true, vencendo: ["municipal"] });
    expect(homologacao(forn("F-2", { garantiaAnos: 2, experienciaSp: {} }), "2026-11-25").pendencias).toHaveLength(2);
    const rnc = abrirRnc({ id: "RNC-001", trechoId: "T1", fornecedorId: "F-1", descricao: "Falha", gravidade: "grave", abertaEm: "2026-11-01T09:00:00Z", abertaPor: "H" });
    expect(scoreFornecedor(forn("F-1"), [rnc], [], "2026-11-25")).toBe(80);
  });
  it("regra dos 3 cotações e justificativa fora do menor preço", () => {
    const fs = [forn("F-1"), forn("F-2"), forn("F-3", { garantiaAnos: 1 })];
    const c: Cotacao = { id: "COT-001", titulo: "Drenagem T1", escopo: "Tubos e PVs", pranchas: [], criadaEm: "2026-11-01T09:00:00Z", criadaPor: "Evaristo",
      propostas: [{ fornecedorId: "F-1", valor: 100, prazoDias: 30 }, { fornecedorId: "F-2", valor: 90, prazoDias: 40 }, { fornecedorId: "F-3", valor: 80, prazoDias: 30 }] };
    expect(() => escolherProposta(c, "F-3", fs, "2026-11-25", "E", "2026-11-25T10:00:00Z", "justificativa longa")).toThrow(/homologado/);
    expect(() => escolherProposta(c, "F-2", fs, "2026-11-25", "E", "2026-11-25T10:00:00Z")).toThrow(/justifique/);
    expect(escolherProposta(c, "F-2", fs, "2026-11-25", "E", "2026-11-25T10:00:00Z", "Só 2 homologados nesta região").escolha?.fornecedorId).toBe("F-2");
  });
  it("revisão única vigente e alerta de prancha obsoleta", () => {
    let p: Prancha = { codigo: "DR-01", titulo: "Drenagem", disciplina: "Drenagem", revisoes: [{ rev: "R00", em: "2026-10-01", por: "Elvis" }] };
    p = novaRevisao(p, { rev: "R01", em: "2026-11-01", por: "Elvis" });
    expect(() => novaRevisao(p, { rev: "R01", em: "2026-11-02", por: "Elvis" })).toThrow(PmoError);
    expect(pranchasObsoletas([{ codigo: "DR-01", rev: "R00" }], [p])).toEqual([{ codigo: "DR-01", citada: "R00", vigente: "R01" }]);
  });
});

describe("estado e alertas da Fase 2", () => {
  it("estado antigo ganha as listas novas e o diário exige um por dia", () => {
    const antigo = { ficha: {}, trechos: [], lotes: [], processos: [], equipe: [], solicitacoes: [], etapas: [], reforecasts: [] };
    expect(cleanLoteadora(antigo)?.diarios).toEqual([]);
    const dia: DiarioObra = { data: "2026-11-24", efetivo: 10, equipamentos: "", clima: "chuva", chuvaMm: 22, texto: "", avancos: [], fotos: [], registradoEm: "2026-11-24T17:00:00-03:00", por: "H" };
    expect(() => updateLoteadora(antigo as never, (s) => ({ ...s, diarios: [dia, dia] }))).toThrow(/repetido/);
  });
  it("alerta diário pendente, RNC sem plano e certidão vencida de fornecedor com medição aberta", () => {
    const s = {
      ...EMPTY_LOTEADORA,
      inicioDiario: "2026-11-20",
      rncs: [abrirRnc({ id: "RNC-001", trechoId: "T1", descricao: "Falha", gravidade: "leve", abertaEm: "2026-11-20T09:00:00Z", abertaPor: "H" })],
      fornecedores: [{ id: "F-1", nome: "Drenaq", frentes: ["drenagem" as const], experienciaSp: { m: 1 }, garantiaAnos: 5, abnt: true, certidoes: { fgts: "2026-11-01" } }],
      boletins: [novoBoletim({ id: "BM-001", fornecedorId: "F-1", trechoId: "T1", frente: "drenagem", quinzena: "2026-11-30", criadoPor: "H" })],
    };
    const al = alertasLoteadora(s, { hoje: "2026-11-25", agora: "2026-11-25T23:00:00Z" });
    expect(al.map((a) => a.area)).toEqual(expect.arrayContaining(["canteiro", "qualidade", "suprimentos"]));
  });
});

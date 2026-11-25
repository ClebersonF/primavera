import { describe, expect, it } from "vitest";
import {
  EMPTY_LOTEADORA, EMPTY_PLANNING, PARAMETROS_PADRAO, PmoError, addYears, alertasLoteadora, compararReforecast, congelarReforecast, decidir, describePlanningChange,
  etapasExigidas, filaDeAprovacao, importLotesCsv, importTrechosCsv, nivelGeral, normalizePlanning, novaSolicitacao, prazoFechamento, reenviar,
  relogioCartorio, relogioCertificado, relogioRet, resumoCadastro, semCheckin, slaAprovacao, slaExecutivo, statusSolicitacao, tempoInternoExterno,
  validarParametros, withLoteadora, type Membro, type ProcessoRegulatorio, type Solicitacao,
} from "../src";

const pres: Membro = { id: "m1", nome: "José Benedito", papel: "presidente" };
const eng: Membro = { id: "m2", nome: "José Evaristo", papel: "diretoria_tecnica" };
const amb: Membro = { id: "m3", nome: "Mario Sergio", papel: "ambiental" };
const cfo: Membro = { id: "m4", nome: "Fernando", papel: "cfo" };
const obra: Membro = { id: "m5", nome: "Hércules", papel: "canteiro" };

describe("cadastro de lotes e trechos", () => {
  it("importa lotes com ; e vírgula decimal, aplica a trava (sem situação = bloqueado) e aponta erros por linha", () => {
    const csv = "Quadra;Lote;Área (m²);Matrícula;Trecho;Comercial\nA;1;250,50;123.456;T001;Disponível\nA;2;300;;T001;\nA;1;250;;;\nB;3;abc;;;\n";
    const r = importLotesCsv(csv);
    expect(r.itens.map((l) => [l.id, l.areaM2, l.comercial])).toEqual([["A-1", 250.5, "disponivel"], ["A-2", 300, "bloqueado"]]);
    expect(r.erros.map((e) => e.linha)).toEqual([4, 5]);
    expect(() => importLotesCsv("x;y\n1;2")).toThrow(/quadra, lote e área/);
  });
  it("importa trechos e resume, apontando venda sem matrícula e trecho inexistente", () => {
    const t = importTrechosCsv("rua,trecho,largura,passeio,pavimento\nRua 1,Estaca 0-10,7,\"1,5\",\"1.400\"\n");
    expect(t.itens[0]).toMatchObject({ id: "T001", rua: "Rua 1", larguraPistaM: 7, passeioM: 1.5, pavimentoM2: 1400 });
    const lotes = importLotesCsv("quadra;lote;area;trecho;comercial\nA;1;200;T001;vendido\nA;2;300;T999;disponivel").itens;
    const r = resumoCadastro(lotes, t.itens, { areaVendavelM2: 480 });
    expect(r).toMatchObject({ lotes: 2, areaLotesM2: 500, semMatricula: 2, vendaSemMatricula: ["A-1"], trechoInexistente: ["A-2"], difAreaVendavelM2: 20 });
  });
});

describe("radar regulatório", () => {
  const hoje = "2026-11-25";
  it("RET: verde, amarelo em D+30, vermelho em D+40, crítico em D+45 sem petição e vencido após 60", () => {
    expect(relogioRet({ emitidoEm: "2026-11-01" }, hoje).nivel).toBe("verde");
    expect(relogioRet({ emitidoEm: "2026-10-26" }, hoje)).toMatchObject({ nivel: "amarelo", dia: 30, prazo: "2026-12-25", saldo: 30 });
    expect(relogioRet({ emitidoEm: "2026-10-16" }, hoje).nivel).toBe("vermelho");
    expect(relogioRet({ emitidoEm: "2026-10-11" }, hoje).nivel).toBe("critico");
    expect(relogioRet({ emitidoEm: "2026-09-01" }, hoje).mensagem).toMatch(/vencido/);
  });
  it("RET prorrogado soma 120 dias; respondido fica verde e aponta a meta interna de 40 dias", () => {
    const r = relogioRet({ emitidoEm: "2026-10-01", prorrogacaoEm: "2026-11-14" }, hoje);
    expect(r).toMatchObject({ prazo: "2027-03-30", nivel: "verde" });
    expect(relogioRet({ emitidoEm: "2026-10-01", respondidoEm: "2026-11-20" }, hoje)).toMatchObject({ nivel: "verde", dia: 50 });
    expect(relogioRet({ emitidoEm: "2026-10-01", respondidoEm: "2026-11-20" }, hoje).mensagem).toMatch(/acima da meta/);
  });
  it("cartório: 180 dias do decreto com marcos D+20, D+30, D+90 e D+120", () => {
    expect(relogioCartorio({ decretoEm: "2026-11-01", notas: [] }, hoje)).toMatchObject({ nivel: "amarelo", dia: 24, prazo: "2027-04-30" });
    expect(relogioCartorio({ decretoEm: "2026-11-01", pacoteCompletoEm: "2026-11-15", notas: [] }, hoje).nivel).toBe("verde");
    expect(relogioCartorio({ decretoEm: "2026-10-20", pacoteCompletoEm: "2026-11-01", notas: [] }, hoje).mensagem).toMatch(/sem protocolo/);
    expect(relogioCartorio({ decretoEm: "2026-08-20", pacoteCompletoEm: "2026-09-01", prenotadoEm: "2026-09-10", notas: [] }, hoje).nivel).toBe("vermelho");
    expect(relogioCartorio({ decretoEm: "2026-07-01", prenotadoEm: "2026-07-20", pacoteCompletoEm: "2026-07-10", notas: [] }, hoje).nivel).toBe("critico");
    expect(relogioCartorio({ decretoEm: "2026-05-01", notas: [] }, hoje).mensagem).toMatch(/vencido/);
    expect(relogioCartorio({ decretoEm: "2026-05-01", notas: [], registradoEm: "2026-08-01" }, hoje)).toMatchObject({ nivel: "verde", dia: 92 });
  });
  it("nota devolutiva sem resposta há mais de 10 dias úteis deixa o cartório vermelho", () => {
    const c = { decretoEm: "2026-11-01", pacoteCompletoEm: "2026-11-05", prenotadoEm: "2026-11-06", notas: [{ recebidaEm: "2026-11-09" }] };
    expect(relogioCartorio(c, hoje)).toMatchObject({ nivel: "vermelho", notasAtrasadas: 1 });
    expect(relogioCartorio(c, "2026-11-20").nivel).toBe("verde");
  });
  it("certificado: 4 anos, aviso 180 e 90 dias antes, inclusive 29/02", () => {
    expect(relogioCertificado({ emitidoEm: "2023-01-10", validadeAnos: 4 }, hoje)).toMatchObject({ nivel: "vermelho", prazo: "2027-01-10" });
    expect(relogioCertificado({ emitidoEm: "2023-05-01", validadeAnos: 4 }, hoje).nivel).toBe("amarelo");
    expect(relogioCertificado({ emitidoEm: "2022-01-01", validadeAnos: 4 }, hoje).nivel).toBe("critico");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
  });
  it("divide o tempo entre Sol Maior e órgão e cobra o check-in semanal", () => {
    const proc: ProcessoRegulatorio = { id: "PR-001", frente: "ambiental", orgao: "CETESB", assunto: "LI", situacao: "em_analise", eventos: [
      { data: "2026-10-01", descricao: "Montagem do dossiê", com: "interno" },
      { data: "2026-10-11", descricao: "Protocolo", com: "orgao" },
      { data: "2026-11-10", descricao: "Ligação ao analista", com: "orgao" },
    ] };
    expect(tempoInternoExterno(proc, hoje)).toEqual({ interno: 10, orgao: 45 });
    expect(semCheckin(proc, hoje)).toBe(15);
    expect(semCheckin({ ...proc, situacao: "aprovado" }, hoje)).toBeNull();
  });
  it("parâmetros precisam ser coerentes", () => {
    expect(() => validarParametros({ ...PARAMETROS_PADRAO, retVermelhoDia: 25 })).toThrow(PmoError);
    expect(() => validarParametros({ ...PARAMETROS_PADRAO, cartorioPrazoDias: 100 })).toThrow(PmoError);
    expect(() => validarParametros(PARAMETROS_PADRAO)).not.toThrow();
  });
});

describe("central de alçadas", () => {
  const base = (p: Partial<Solicitacao> = {}) => ({ ...novaSolicitacao({ id: "AL-0001", tipo: "contratacao", titulo: "Guias e sarjetas", valor: 420_000, criadaPor: "Elvis", criadaEm: "2026-11-20T09:00:00Z" }), ...p });
  it("segue Diretoria → Presidência → CFO e confere o papel de quem decide", () => {
    let s = base();
    expect(() => decidir(s, pres, "aprovar", "2026-11-20T10:00:00Z")).toThrow(/Pré-aprovação técnica é decisão/);
    s = decidir(s, eng, "aprovar", "2026-11-20T10:00:00Z");
    expect(statusSolicitacao(s).proxima).toBe("presidencia");
    expect(() => decidir(s, cfo, "aprovar", "2026-11-20T11:00:00Z")).toThrow(/Presidência/);
    s = decidir(s, pres, "aprovar", "2026-11-24T10:00:00Z");
    s = decidir(s, cfo, "aprovar", "2026-11-24T15:00:00Z");
    expect(statusSolicitacao(s).status).toBe("aprovada");
    expect(slaExecutivo(s)).toBe(2);
    expect(() => decidir(s, cfo, "aprovar", "2026-11-25T10:00:00Z")).toThrow(/encerrada/);
  });
  it("medição dentro do contrato dispensa a Presidência; aditivo exige impacto no reforecast", () => {
    expect(etapasExigidas({ tipo: "medicao", dentroDoContrato: true, valor: 10 })).toEqual(["pre_aprovacao", "financeiro"]);
    expect(etapasExigidas({ tipo: "medicao", dentroDoContrato: false, valor: 10 })).toEqual(["pre_aprovacao", "presidencia", "financeiro"]);
    expect(etapasExigidas({ tipo: "protocolo", valor: 0 })).toEqual(["pre_aprovacao", "presidencia"]);
    const ad = base({ tipo: "aditivo" });
    expect(() => decidir(ad, eng, "aprovar", "2026-11-20T10:00:00Z")).toThrow(/impacto no reforecast/);
    expect(statusSolicitacao(decidir({ ...ad, impactoReforecast: 35_000 }, eng, "aprovar", "2026-11-20T10:00:00Z")).proxima).toBe("presidencia");
  });
  it("devolver exige justificativa; o reenvio reinicia o fluxo e fica na trilha", () => {
    let s = decidir(base(), eng, "aprovar", "2026-11-20T10:00:00Z");
    expect(() => decidir(s, pres, "devolver", "2026-11-21T10:00:00Z", "")).toThrow(/justificativa/);
    s = decidir(s, pres, "devolver", "2026-11-21T10:00:00Z", "Falta a terceira cotação");
    expect(statusSolicitacao(s).status).toBe("devolvida");
    expect(() => decidir(s, eng, "aprovar", "2026-11-21T11:00:00Z")).toThrow(/reenvie/);
    s = reenviar(s, "Elvis", "2026-11-22T09:00:00Z", "Incluída a cotação da empresa C");
    expect(statusSolicitacao(s)).toMatchObject({ status: "pendente", proxima: "pre_aprovacao" });
    expect(s.decisoes).toHaveLength(2);
    expect(() => decidir(s, eng, "aprovar", "2026-11-21T08:00:00Z")).toThrow(/Data da decisão/);
  });
  it("SLA de 3 dias úteis (urgente 48 h) e fila pelo caminho crítico", () => {
    const s = decidir(base({ criadaEm: "2026-11-18T09:00:00Z" }), eng, "aprovar", "2026-11-19T10:00:00Z");
    expect(slaAprovacao(s, "2026-11-25T10:00:00Z")).toMatchObject({ diasUteis: 4, atrasada: true });
    expect(slaAprovacao({ ...s, urgente: true }, "2026-11-20T09:00:00Z")).toMatchObject({ horas: 23, atrasada: false });
    const a = base({ id: "AL-1", valor: 900_000, atividadeId: "pav" });
    const b = base({ id: "AL-2", valor: 10_000, atividadeId: "drenagem" });
    const c = base({ id: "AL-3", valor: 50_000, urgente: true });
    expect(filaDeAprovacao([a, b, c], { drenagem: 0, pav: 12 }).map((x) => x.id)).toEqual(["AL-2", "AL-1", "AL-3"]);
  });
});

describe("reforecast e alertas", () => {
  const etapas = [{ id: "ET-01", nome: "Drenagem", orcado: 1_000_000, atividades: ["a1", "a2"] }, { id: "ET-02", nome: "Pavimentação", orcado: 2_000_000, atividades: ["a3"] }];
  it("compara orçado, reforecast congelado e realizado, com desvios 3% e 5% e margem", () => {
    const snaps = congelarReforecast([], { mes: "2026-10", congeladoEm: "2026-11-05T10:00:00Z", por: "Fernando", valores: { "ET-01": 1_040_000, "ET-02": 2_120_000 } });
    const r = compararReforecast(etapas, snaps, { a1: 300_000, a2: 100_000, a3: 50_000 }, 10_000_000, 0.729);
    expect(r.linhas.map((l) => [l.realizado, l.nivel])).toEqual([[400_000, "amarelo"], [50_000, "vermelho"]]);
    expect(r).toMatchObject({ totalOrcado: 3_000_000, totalReforecast: 3_160_000, totalRealizado: 450_000, mesReforecast: "2026-10" });
    expect(r.margemBruta).toBeCloseTo(0.684, 6);
    expect(() => congelarReforecast(snaps, { ...snaps[0]! })).toThrow(/já foi congelado/);
  });
  it("fechamento no 5º dia útil do mês seguinte", () => {
    expect(prazoFechamento("2026-10")).toBe("2026-11-06");
    expect(prazoFechamento("2026-12", { workWeekdays: [1, 2, 3, 4, 5], holidays: ["2027-01-01"] })).toBe("2027-01-08");
  });
  it("junta os alertas com destinatários por nível e ordena do mais grave", () => {
    const s = {
      ...EMPTY_LOTEADORA,
      ficha: {}, trechos: [], equipe: [pres, eng, amb, cfo, obra],
      lotes: importLotesCsv("quadra;lote;area;comercial\nA;1;200;vendido").itens,
      processos: [{ id: "PR-001", frente: "ambiental" as const, orgao: "CETESB", assunto: "LI", situacao: "ret_aberto" as const, eventos: [], ret: { emitidoEm: "2026-10-16" } }],
      cartorio: { decretoEm: "2026-11-01", notas: [] },
      solicitacoes: [], etapas, reforecasts: [],
    };
    const al = alertasLoteadora(s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z", atrasos: [{ atividade: "Drenagem Rua 2", dias: 9 }] });
    expect(al.map((a) => [a.nivel, a.area])).toEqual([["critico", "comercial"], ["vermelho", "regulatorio"], ["amarelo", "cartorio"], ["amarelo", "custos"], ["amarelo", "cronograma"]]);
    expect(al[0]!.destinatarios.map((m) => m.nome)).toContain("José Benedito");
    expect(al[1]!.destinatarios.map((m) => m.nome)).not.toContain("José Benedito");
    expect(al[2]!.papeis).toEqual(["ambiental", "diretoria_tecnica"]);
    expect(nivelGeral(al)).toBe("critico");
    expect(nivelGeral([])).toBe("verde");
  });
});

describe("planejamento da obra", () => {
  it("grava, sobrevive à normalização, registra no histórico e recusa item inválido", () => {
    const p = withLoteadora(EMPTY_PLANNING, (s) => ({ ...s, lotes: importLotesCsv("quadra;lote;area\nA;1;200\nA;2;250").itens, equipe: [eng, pres] }));
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).loteadora).toEqual(p.loteadora);
    expect(describePlanningChange(EMPTY_PLANNING, p)).toEqual(expect.arrayContaining(["Lotes: 2", "Equipe e papéis: 2 pessoa(s)"]));
    expect(() => withLoteadora(p, (s) => ({ ...s, lotes: [...s.lotes, { ...s.lotes[0]! }] }))).toThrow(/repetido/);
    expect(() => withLoteadora(p, (s) => ({ ...s, cartorio: { decretoEm: "2026-02-30", notas: [] } }))).toThrow(/inválido/);
    expect(withLoteadora(p, (s) => s)).toBe(p);
  });
  it("295 lotes cabem no planejamento com folga", () => {
    const linhas = Array.from({ length: 295 }, (_, i) => `Q${String(Math.floor(i / 20) + 1).padStart(2, "0")};${(i % 20) + 1};${250 + (i % 7)};${100000 + i};T${String((i % 30) + 1).padStart(3, "0")}`);
    const lotes = importLotesCsv(`quadra;lote;area;matricula;trecho\n${linhas.join("\n")}`).itens;
    const p = withLoteadora(EMPTY_PLANNING, (s) => ({ ...s, lotes }));
    expect(p.loteadora!.lotes).toHaveLength(295);
    expect(JSON.stringify(p).length).toBeLessThan(60_000);
  });
});

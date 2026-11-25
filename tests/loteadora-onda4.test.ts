import { describe, expect, it } from "vitest";
import {
  EMPTY_LOTEADORA, abrirRnc, alertasLoteadora, avisosDeAlertas, cleanMembro, gatilhos, kpisPerfil, novaSolicitacao, planejarAvisos, registrarEnvios,
  relatorioExecutivoHtml, segundaDaSemana, textoAviso, updateLoteadora, type Membro,
} from "../src";

const eq: Membro[] = [
  { id: "m1", nome: "Pres", email: "p@x.com", papel: "presidente" },
  { id: "m2", nome: "Eng", email: "e@x.com", telefone: "5516999990000", papel: "diretoria_tecnica" },
  { id: "m3", nome: "Obra", email: "o@x.com", papel: "canteiro" },
  { id: "m4", nome: "Amb", email: "a@x.com", papel: "ambiental" },
];

describe("gatilhos e avisos (Onda 4)", () => {
  it("telefone do membro só com DDI+DDD", () => {
    expect(cleanMembro({ id: "x", nome: "A", papel: "cfo", telefone: "+55 (16) 99999-0000" })?.telefone).toBe("5516999990000");
    expect(cleanMembro({ id: "x", nome: "A", papel: "cfo", telefone: "9999" })?.telefone).toBeUndefined();
  });
  it("eventos saem uma vez; alertas repetem pelo intervalo do nível ou quando pioram", () => {
    const s = {
      ...EMPTY_LOTEADORA, equipe: eq, cartorio: { decretoEm: "2026-06-01", notas: [] },
      rncs: [abrirRnc({ id: "RNC-001", trechoId: "T1", descricao: "Guia torta", gravidade: "grave", abertaEm: "2026-11-25T09:00:00Z", abertaPor: "Obra" })],
      solicitacoes: [novaSolicitacao({ id: "AL-0001", tipo: "contratacao", titulo: "Drenagem", valor: 10_000, criadaPor: "Eng", criadaEm: "2026-11-25T08:00:00Z" })],
    };
    const t0 = "2026-11-25T12:00:00Z";
    const cand = [...gatilhos(s, t0), ...avisosDeAlertas(alertasLoteadora(s, { hoje: "2026-11-25", agora: t0 }))];
    const p1 = planejarAvisos(cand, [], t0);
    expect(p1.map((a) => a.chave)).toEqual(expect.arrayContaining(["evt:decreto:2026-06-01", "evt:rnc:RNC-001", "evt:alcada:AL-0001:pre_aprovacao:2026-11-25T08:00:00Z", "alerta:cartorio:Registro em cartório (180 dias)"]));
    expect(p1.find((a) => a.chave === "evt:rnc:RNC-001")!.destinatarios.map((d) => d.nome)).toEqual(["Eng", "Obra"]);
    const log = registrarEnvios([], p1.map((aviso) => ({ aviso, canais: ["email" as const] })), t0);
    expect(planejarAvisos(cand, log, "2026-11-25T18:00:00Z")).toEqual([]);
    const depois = planejarAvisos(cand, log, "2026-11-26T01:00:00Z").map((a) => a.chave);
    expect(depois).toEqual(["alerta:cartorio:Registro em cartório (180 dias)"]); // crítico repete após 12 h
    expect(textoAviso("Nova Marina", p1[0]!).assunto).toMatch(/^\[(Atenção|Urgente|CRÍTICO)\] Nova Marina/);
  });
  it("registro de avisos fica no estado da obra", () => {
    const s = updateLoteadora(undefined, (x) => ({ ...x, avisos: [{ chave: "evt:a", nivel: "amarelo", em: "2026-11-25T12:00:00Z", destinatarios: ["a@x.com"], canais: ["email"] }], ultimoRelatorio: "2026-11-23" }));
    expect(s.avisos).toHaveLength(1);
    expect(s.ultimoRelatorio).toBe("2026-11-23");
  });
  it("relatório semanal: HTML e segunda-feira da semana", () => {
    const s = { ...EMPTY_LOTEADORA, cartorio: { decretoEm: "2026-06-01", notas: [] } };
    const { kpis, alertas } = kpisPerfil("presidencia", s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z" });
    const html = relatorioExecutivoHtml("Nova Marina", "presidencia", kpis, alertas, [], "2026-11-25");
    expect(html).toContain("Relatório executivo — Nova Marina");
    expect(html).not.toContain("window.print");
    expect(segundaDaSemana("2026-11-25")).toBe("2026-11-23");
    expect(segundaDaSemana("2026-11-23")).toBe("2026-11-23");
    expect(segundaDaSemana("2026-11-29")).toBe("2026-11-23");
  });
});

import { aplicarOperacao, conflitoOperacao, descreverOperacao, marcarChecklist, type ItemFila } from "../src";
describe("fila offline do campo (Onda 5)", () => {
  const autor = { usuario: "Obra", autenticado: false };
  const diario = (por: string, registradoEm: string) => ({ data: "2026-11-25", efetivo: 12, equipamentos: "", clima: "sol" as const, chuvaMm: 0, texto: "ok", avancos: [], fotos: [], registradoEm, por });
  it("reaplica diário e RNC; RNC ganha o próximo número no servidor", () => {
    const base = { ...EMPTY_LOTEADORA, rncs: [abrirRnc({ id: "RNC-001", trechoId: "T1", descricao: "x", gravidade: "leve", abertaEm: "2026-11-24T10:00:00Z", abertaPor: "A" })] };
    const rnc = abrirRnc({ id: "RNC-TMP", trechoId: "T2", descricao: "Caixa trincada", gravidade: "grave", abertaEm: "2026-11-25T10:00:00Z", abertaPor: "Obra" });
    let s = aplicarOperacao(base, { id: "q1", obra: "o", criadoEm: "2026-11-25T10:00:00Z", autor, op: { tipo: "rnc", rnc } });
    expect(s.rncs.map((r) => r.id)).toEqual(["RNC-001", "RNC-002"]);
    s = aplicarOperacao(s, { id: "q2", obra: "o", criadoEm: "2026-11-25T16:00:00Z", autor, op: { tipo: "diario", diario: diario("Obra", "2026-11-25T16:00:00-03:00") } });
    expect(s.diarios).toHaveLength(1);
  });
  it("conflito quando outra pessoa gravou o diário do dia depois; checklist em frente concluída", () => {
    const item: ItemFila = { id: "q", obra: "o", criadoEm: "2026-11-25T15:00:00Z", autor, op: { tipo: "diario", diario: diario("Obra", "2026-11-25T12:00:00-03:00") } };
    const s = { ...EMPTY_LOTEADORA, diarios: [diario("Eng", "2026-11-25T17:00:00Z")] };
    expect(conflitoOperacao(s, item)).toMatch(/já foi gravado por Eng/);
    expect(() => aplicarOperacao(s, item)).toThrow(/já foi gravado/);
    const frentes = marcarChecklist([], "T1", "terraplenagem", 0, true, "Obra", "2026-11-20").map((f) => ({ ...f, concluidaEm: "2026-11-25" }));
    const ck: ItemFila = { id: "c", obra: "o", criadoEm: "2026-11-25T10:00:00Z", autor, op: { tipo: "checklist", trechoId: "T1", frente: "terraplenagem", indice: 0, item: frentes[0]!.checklist[0]!.item, ok: true, por: "Obra", em: "2026-11-25" } };
    expect(conflitoOperacao({ ...EMPTY_LOTEADORA, frentes }, ck)).toMatch(/concluída/);
    expect(descreverOperacao(ck.op)).toMatch(/^Checklist T1/);
  });
});

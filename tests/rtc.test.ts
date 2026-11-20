import { describe, expect, it } from "vitest";
import { PmoError, buildRtcOperacao, isRtcAction, rtcUrl, summarizeRtcResponse } from "../src";

const aliq = { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 };
const item = { numero: 1, nbs: "122011200", cst: "200", cClassTrib: "200028", baseCalculo: 1200, aliquotasNominais: aliq };
const base = { id: "op1", dhFatoGerador: "2027-03-10T10:00:00-03:00", municipio: 4314902, uf: "RS", itens: [item] };

// Resposta resumida do exemplo oficial (docs/exemplos.md da calculadora-rtc-regime-regular).
const resposta = {
  objetos: [
    { nObj: 1, estadoItem: "CALCULO_SIMULADO", tribCalc: { IBSCBS: { gIBSCBS: { vBC: "100.00", vIBS: "0.00", gCBS: { vCBS: "0.00" } } } } },
    { nObj: 2, estadoItem: "CALCULO_SIMULADO", tribCalc: { IS: { vIS: "15.00" }, IBSCBS: { gIBSCBS: { vIBS: "0.16", gCBS: { vCBS: "14.12" } } } } },
    { nObj: 3, estadoItem: "CALCULO_SIMULADO", tribCalc: { IBSCBS: { gIBSCBS: { vBC: "1200.00", vIBS: "0.48", gCBS: { vCBS: "42.24" } } } } },
    { nObj: 4, estadoItem: "INCONSISTENCIA_ENTRADA", erros: [{ code: "REG-011", title: "NCM não vinculada", pointer: "#/itens/3/ncm", detail: "x" }] },
  ],
};

describe("RTC — entrada", () => {
  it("monta operação válida e rejeita o que a API rejeitaria", () => {
    expect(buildRtcOperacao(base).versao).toBe("1.0.0");
    const bad = (p: object) => () => buildRtcOperacao({ ...base, ...p });
    expect(bad({ municipio: 123 })).toThrow(PmoError);
    expect(bad({ uf: "rs" })).toThrow(PmoError);
    expect(bad({ dhFatoGerador: "2027-03-10" })).toThrow(PmoError);
    expect(bad({ itens: [] })).toThrow(PmoError);
    expect(bad({ itens: [{ ...item, ncm: "10063021" }] })).toThrow(/NCM \(bem\) ou NBS/);
    expect(bad({ itens: [{ ...item, cClassTrib: "28" }] })).toThrow(/cClassTrib/);
    expect(bad({ itens: [item, item] })).toThrow(/repetido/);
    expect(bad({ itens: [{ ...item, aliquotasNominais: { ...aliq, cbs: 880 } }] })).toThrow(/alíquota cbs/);
  });
});

describe("RTC — resposta", () => {
  it("soma só os itens calculados e marca operação incompleta e simulada", () => {
    const r = summarizeRtcResponse(resposta);
    expect(r.vCBS).toBe(56.36);
    expect(r.vIBS).toBe(0.64);
    expect(r.vIS).toBe(15);
    expect(r.incompleto).toBe(true);
    expect(r.simulado).toBe(true);
    expect(r.itens[3]?.erros[0]?.code).toBe("REG-011");
  });
  it("resposta vazia ou estranha nunca vira total de zero 'completo'", () => {
    expect(summarizeRtcResponse(null).incompleto).toBe(true);
    expect(summarizeRtcResponse({ objetos: [{ nObj: 1, estadoItem: "OUTRO" }] }).itens[0]?.estado).toBe("FALHA_TECNICA");
  });
});

describe("RTC — destinos", () => {
  it("só aceita ações da lista e monta a URL com a base do serviço", () => {
    expect(isRtcAction("danfse")).toBe(true);
    expect(isRtcAction("../../etc")).toBe(false);
    expect(isRtcAction("toString")).toBe(false);
    expect(rtcUrl("http://rtc.interno:8080/", "regime-geral")).toBe("http://rtc.interno:8080/api/calculadora/observabilidade/regime-geral");
    expect(rtcUrl("https://x.com/base", "danfse", { stc: 0, canhoto: false })).toBe("https://x.com/base/api/danfse?stc=0&canhoto=false");
    expect(() => rtcUrl("ftp://x", "ncm")).toThrow(PmoError);
    expect(() => rtcUrl("nada", "ncm")).toThrow(PmoError);
  });
});

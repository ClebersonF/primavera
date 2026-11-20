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
    expect(bad({ itens: [{ ...item, ncm: "10063021" }] })).toThrow(/não os dois/);
    expect(bad({ itens: [{ ...item, nbs: "" }] })).toThrow(/falta o NBS do serviço/);
    expect(bad({ itens: [{ ...item, nbs: undefined, ncm: "" }] })).toThrow(/falta o NCM do bem/);
    expect(bad({ itens: [{ ...item, cst: "", cClassTrib: "" }] })).toThrow(/falta a classificação/);
    expect(bad({ itens: [{ ...item, baseCalculo: NaN }] })).toThrow(/base de cálculo em reais/);
    expect(bad({ itens: [{ ...item, cClassTrib: "28" }] })).toThrow(/classificação tributária/);
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

import { EMPTY_PLANNING, assessWorkCbsOfficial, buildWorkRtcOperacao, describePlanningChange, normalizePlanning, withTax, withTaxOfficialConfig, withTaxOfficialResult, type TaxOfficialConfig } from "../src";

describe("RTC — cálculo oficial na obra", () => {
  const line = { nbs: "122011200", cst: "000", cClassTrib: "000001" };
  const cfg: TaxOfficialConfig = { date: "2027-03-10", municipio: "3550308", uf: "SP", engineering: line, software: { ...line, nbs: "111032100" }, aliquotas: aliq };
  const resumo = { itens: [], vCBS: 8000, vIBS: 100, vIS: 0, incompleto: false, simulado: true };
  const base0 = withTax(EMPTY_PLANNING, { engineeringShare: 0.7, purchases: [{ id: "NF-001", category: "cloud", cbsDestacada: 500, supplierIsRegularPJ: true }] });

  it("monta a operação com a mesma divisão da estimativa e omite linha zerada", () => {
    const p = withTaxOfficialConfig(base0, cfg);
    const op = buildWorkRtcOperacao(100000, p.tax!, "x1");
    expect(op.itens.map((i) => i.baseCalculo)).toEqual([70000, 30000]);
    expect(op.itens[1]?.nbs).toBe("111032100");
    expect(op.dhFatoGerador).toBe("2027-03-10T12:00:00-03:00");
    const soEng = withTaxOfficialConfig(withTax(EMPTY_PLANNING, { engineeringShare: 1, purchases: [] }), cfg);
    expect(buildWorkRtcOperacao(100000, soEng.tax!, "x2").itens).toHaveLength(1);
    expect(() => buildWorkRtcOperacao(0, p.tax!, "x3")).toThrow(/orçamento/);
  });
  it("antes de 2027 não envia alíquotas; a partir de 2027 exige", () => {
    const antes = withTaxOfficialConfig(base0, { ...cfg, date: "2026-11-20" });
    expect(buildWorkRtcOperacao(1000, antes.tax!, "a").itens[0]?.aliquotasNominais).toBeUndefined();
    const sem = withTaxOfficialConfig(base0, { ...cfg, aliquotas: undefined });
    expect(() => buildWorkRtcOperacao(1000, sem.tax!, "b")).toThrow(/2027/);
    expect(() => buildWorkRtcOperacao(1000, base0.tax!, "c")).toThrow(/classificação/);
  });
  it("só usa o valor oficial quando vigente: mesma base, tudo calculado", () => {
    let p = withTaxOfficialConfig(base0, cfg);
    expect(assessWorkCbsOfficial(100000, p.tax).status).toBe("nao_calculado");
    expect(assessWorkCbsOfficial(100000, base0.tax).status).toBe("sem_classificacao");
    p = withTaxOfficialResult(p, 100000, resumo, "2026-11-20T15:00:00Z");
    const r = assessWorkCbsOfficial(100000, p.tax);
    expect(r.status).toBe("vigente");
    expect(r.official).toMatchObject({ debitCbs: 8000, credit: 500, balance: 7500, payable: 7500, ibs: 100, simulado: true });
    expect(assessWorkCbsOfficial(120000, p.tax).status).toBe("desatualizado");
    expect(assessWorkCbsOfficial(100000, withTax(p, { ...p.tax!, engineeringShare: 0.5 }).tax).status).toBe("desatualizado");
    const parcial = withTaxOfficialResult(p, 100000, { ...resumo, incompleto: true, itens: [{ numero: 2, estado: "INCONSISTENCIA_ENTRADA", vCBS: 0, vIBS: 0, vIS: 0, erros: [{ code: "REG-011", title: "t", detail: "d" }] }] }, "2026-11-20T16:00:00Z");
    expect(assessWorkCbsOfficial(100000, parcial.tax)).toEqual({ status: "incompleto", official: null });
    expect(parcial.tax?.official?.result?.erros).toEqual(["Item 2: REG-011 — d"]);
  });
  it("mudar a classificação descarta o resultado; regravar a mesma mantém; sobrevive à normalização", () => {
    const p = withTaxOfficialResult(withTaxOfficialConfig(base0, cfg), 100000, resumo, "2026-11-20T15:00:00Z");
    expect(withTaxOfficialConfig(p, cfg)).toBe(p);
    expect(withTaxOfficialConfig(p, { ...cfg, uf: "RJ" }).tax?.official?.result).toBeUndefined();
    expect(withTaxOfficialConfig(p, null).tax?.official).toBeUndefined();
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).tax).toEqual(p.tax);
    expect(() => withTaxOfficialConfig(base0, { ...cfg, municipio: "12" })).toThrow();
    expect(describePlanningChange(withTaxOfficialConfig(base0, cfg), p)).toContain("Cálculo oficial de CBS/IBS gravado");
    expect(describePlanningChange(base0, withTaxOfficialConfig(base0, cfg))).toContain("Classificação tributária da obra atualizada");
  });
});

import { cstFromClassTrib, searchRtcCatalog } from "../src";
describe("RTC — localizar códigos", () => {
  it("CST é o prefixo da classificação; entrada inválida não gera CST", () => {
    expect(cstFromClassTrib("200028")).toBe("200");
    expect(cstFromClassTrib("28")).toBe("");
  });
  it("busca por código ou palavras, sem acento, com limite", () => {
    const itens = [{ codigo: "114031100", descricao: "Serviços de engenharia de projetos de construção" }, { codigo: 3550308, nome: "São Paulo" }, { codigo: "111032100", descricao: "Licenciamento de programas de computador" }];
    expect(searchRtcCatalog(itens, "ENGENHARIA construcao").map((i) => i.codigo)).toEqual(["114031100"]);
    expect(searchRtcCatalog(itens, "sao paulo")[0]?.codigo).toBe(3550308);
    expect(searchRtcCatalog(itens, "3550")).toHaveLength(1);
    expect(searchRtcCatalog(itens, "", 2)).toHaveLength(2);
    expect(searchRtcCatalog(itens, "inexistente")).toEqual([]);
  });
});

import { UFS_BR, matchRtcByName } from "../src";
describe("RTC — município pelo nome", () => {
  const sp = [{ codigo: 3538709, nome: "Piracicaba" }, { codigo: 3550308, nome: "São Paulo" }, { codigo: 3549904, nome: "São José dos Campos" }];
  it("resolve o nome exato sem acento nem caixa; parcial ou vazio não resolve", () => {
    expect(matchRtcByName(sp, "  sao  paulo ")?.codigo).toBe(3550308);
    expect(matchRtcByName(sp, "PIRACICABA")?.codigo).toBe(3538709);
    expect(matchRtcByName(sp, "São")).toBeNull();
    expect(matchRtcByName(sp, "")).toBeNull();
    expect(matchRtcByName([...sp, { codigo: 1, nome: "Piracicaba" }], "Piracicaba")).toBeNull();
  });
  it("lista as 27 UFs sem repetição", () => {
    expect(new Set(UFS_BR).size).toBe(27);
  });
});

import { searchNcm } from "../src";
describe("RTC — busca de NCM", () => {
  const ncm = [{ ncm: "25231000", descricao: "- Cimentos não pulverizados, denominados clinkers" }, { ncm: "25232910", descricao: "--- Cimento comum" }, { ncm: "25232990", descricao: "--- Outros" }, { ncm: "72142000", descricao: "- Dentadas, com nervuras" }];
  it("dígitos casam com o início do código, com ou sem pontos", () => {
    expect(searchNcm(ncm, "2523").map((i) => i.codigo)).toEqual(["25231000", "25232910", "25232990"]);
    expect(searchNcm(ncm, "2523.29")).toHaveLength(2);
    expect(searchNcm(ncm, "232")).toEqual([]);
  });
  it("palavras casam com a descrição, sem acento, e o rótulo perde os traços", () => {
    expect(searchNcm(ncm, "cimento comum")).toEqual([{ codigo: "25232910", descricao: "Cimento comum" }]);
    expect(searchNcm(ncm, "NERVURAS")[0]?.codigo).toBe("72142000");
    expect(searchNcm(ncm, "", 2)).toHaveLength(2);
    expect(searchNcm([{ ncm: "25231000", descricao: "- Cimentos <i>clinkers</i>" }], "clinkers")[0]?.descricao).toBe("Cimentos clinkers");
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, PmoError, assessDelivery, checkCondoLotesDesign, delayIndemnity, evaluateThresholds, normalizePlanning, withDeliveryCommitment, CONDO_LOTES_GATES, DEFAULT_THRESHOLDS } from "../src";

describe("condomínio de lotes — mínimos da lei municipal", () => {
  it("aponta o que está abaixo do mínimo e ignora o não informado", () => {
    const issues = checkCondoLotesDesign({ asOf: "2026-11-20", roadWidthM: 6.5, sidewalkWidthM: 1.2, fenceHeightM: 2, culDeSacDiameterM: 10 });
    expect(issues.map((i) => i.field).sort()).toEqual(["culDeSac", "road"]);
    expect(checkCondoLotesDesign({ asOf: "2026-11-20" })).toEqual([]);
  });
  it("matrícula com mais de 30 dias vence; com 30 não", () => {
    expect(checkCondoLotesDesign({ asOf: "2026-11-20", registryIssuedOn: "2026-10-21" })).toEqual([]);
    expect(checkCondoLotesDesign({ asOf: "2026-11-20", registryIssuedOn: "2026-10-20" })[0]?.kind).toBe("matricula_vencida");
    expect(() => checkCondoLotesDesign({ asOf: "2026-11-20", registryIssuedOn: "2026-12-01" })).toThrow(PmoError);
  });
  it("aceita parâmetros do município e recusa inválidos", () => {
    const rules = { fenceMinHeightM: 2.2, roadMinWidthM: 6, sidewalkMinWidthM: 1.5, culDeSacMinDiameterM: 12, registryMaxAgeDays: 90 };
    expect(checkCondoLotesDesign({ asOf: "2026-11-20", fenceHeightM: 2 }, rules)).toHaveLength(1);
    expect(() => checkCondoLotesDesign({ asOf: "2026-11-20" }, { ...rules, roadMinWidthM: -1 })).toThrow(PmoError);
    expect(() => checkCondoLotesDesign({ asOf: "2026-11-20", roadWidthM: Number.NaN })).toThrow(PmoError);
  });
  it("tem os 8 marcos em ordem", () => expect(CONDO_LOTES_GATES.map((g) => g.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]));
});

describe("compromisso de entrega e tolerância", () => {
  const c = { date: "2027-06-30", toleranceDays: 180 };
  it("classifica no prazo, em tolerância e estourado", () => {
    expect(assessDelivery(c, "2027-06-30").status).toBe("no_prazo");
    expect(assessDelivery(c, "2027-05-01").daysLate).toBe(0);
    const a = assessDelivery(c, "2027-09-01");
    expect(a.status).toBe("em_tolerancia");
    expect(a.daysLate).toBe(63);
    expect(a.toleranceLimit).toBe("2027-12-27");
    expect(assessDelivery(c, "2027-12-27").status).toBe("em_tolerancia");
    const b = assessDelivery(c, "2028-01-10");
    expect(b.status).toBe("estourado");
    expect(b.daysBeyondTolerance).toBe(14);
  });
  it("sem cláusula de tolerância, qualquer atraso estoura", () => expect(assessDelivery({ date: "2027-06-30", toleranceDays: 0 }, "2027-07-01").status).toBe("estourado"));
  it("indenização pro rata sobre o valor pago", () => {
    expect(delayIndemnity(100_000, 30)).toBe(500);
    expect(delayIndemnity(100_000, 15)).toBe(250);
    expect(delayIndemnity(100_000, 0)).toBe(0);
    expect(() => delayIndemnity(-1, 1)).toThrow(PmoError);
    expect(() => delayIndemnity(1, 1.5)).toThrow(PmoError);
    expect(() => delayIndemnity(1, 1, 2)).toThrow(PmoError);
  });
  it("valida datas e tolerância", () => {
    expect(() => assessDelivery({ date: "2027-02-30", toleranceDays: 1 }, "2027-03-01")).toThrow(PmoError);
    expect(() => assessDelivery({ date: "2027-02-01", toleranceDays: 400 }, "2027-03-01")).toThrow(PmoError);
    expect(() => assessDelivery({ date: "2027-02-01", toleranceDays: 1.5 }, "2027-03-01")).toThrow(PmoError);
  });
  it("grava no planejamento, é idempotente e descarta lixo ao carregar", () => {
    const p = withDeliveryCommitment(EMPTY_PLANNING, c);
    expect(p.delivery).toEqual(c);
    expect(withDeliveryCommitment(p, c)).toBe(p);
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).delivery).toEqual(c);
    expect(withDeliveryCommitment(p, undefined).delivery).toBeUndefined();
    expect(normalizePlanning({ delivery: { date: "x", toleranceDays: 5 } }).delivery).toBeUndefined();
    expect(() => withDeliveryCommitment(EMPTY_PLANNING, { date: "2027-01-01", toleranceDays: -1 })).toThrow(PmoError);
  });
  it("gera alerta de entrega", () => {
    const base = { spi: 1, cpi: 1, severeRisks: 0, overdueIssues: 0, daysToEnd: 100 } as never;
    expect(evaluateThresholds({ ...(base as object), deliveryRisk: "estourado" } as never, DEFAULT_THRESHOLDS).find((a) => a.code === "entrega")?.severity).toBe("critico");
    expect(evaluateThresholds({ ...(base as object), deliveryRisk: "em_tolerancia" } as never, DEFAULT_THRESHOLDS).find((a) => a.code === "entrega")?.severity).toBe("atencao");
  });
});

describe("compromisso ligado a uma atividade", () => {
  it("guarda e valida o id da atividade", () => {
    const p = withDeliveryCommitment(EMPTY_PLANNING, { date: "2027-06-30", toleranceDays: 180, activityId: "tpl-loteamento-9-9" });
    expect(p.delivery?.activityId).toBe("tpl-loteamento-9-9");
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).delivery?.activityId).toBe("tpl-loteamento-9-9");
    expect(() => withDeliveryCommitment(EMPTY_PLANNING, { date: "2027-06-30", toleranceDays: 1, activityId: "" })).toThrow(PmoError);
  });
});

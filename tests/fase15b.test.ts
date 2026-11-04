import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, PmoError, approveChangeStep, canApproveNext, normalizePlanning, sumField, withActivityPlan, withApprovalFlow, withChange, withChangeStatus, withFieldDef, withProjectField, withResourceOff, withoutFieldDef } from "../src";

const base = EMPTY_PLANNING;
const num = { id: "F-1", name: "Área (m²)", kind: "numero", scope: "atividade" } as const;

describe("campos próprios", () => {
  it("valida tipo e escopo e soma campos numéricos", () => {
    let p = withFieldDef(base, num);
    expect(withFieldDef(p, num)).toBe(p);
    p = withActivityPlan(p, "a", { fields: { "F-1": 10 } });
    p = withActivityPlan(p, "b", { fields: { "F-1": 5.5 } });
    expect(sumField(p, "F-1")).toBe(15.5);
    expect(() => withActivityPlan(p, "c", { fields: { "F-1": "x" as any } })).toThrow(PmoError);
    expect(() => withActivityPlan(p, "c", { fields: { "F-9": 1 } })).toThrow(PmoError);
    expect(() => withFieldDef(p, { id: "F-2", name: "", kind: "texto", scope: "projeto" })).toThrow(PmoError);
  });
  it("mudar o tipo ou remover o campo apaga os valores", () => {
    let p = withFieldDef(base, num);
    p = withActivityPlan(p, "a", { fields: { "F-1": 10 } });
    const t = withFieldDef(p, { ...num, kind: "texto" });
    expect(t.activityPlans.a?.fields).toBeUndefined();
    const r = withoutFieldDef(p, "F-1");
    expect(r.fieldDefs).toEqual([]);
    expect(r.activityPlans.a?.fields).toBeUndefined();
    expect(withoutFieldDef(r, "F-1")).toBe(r);
  });
  it("campos de projeto validam data e sobrevivem à normalização", () => {
    let p = withFieldDef(base, { id: "F-1", name: "Licença até", kind: "data", scope: "projeto" });
    p = withProjectField(p, "F-1", "2027-03-01");
    expect(() => withProjectField(p, "F-1", "01/03/2027")).toThrow(PmoError);
    const n = normalizePlanning(JSON.parse(JSON.stringify(p)));
    expect(n.projectFields).toEqual({ "F-1": "2027-03-01" });
    expect(withProjectField(p, "F-1", undefined).projectFields).toEqual({});
    expect(normalizePlanning({ ...p, projectFields: { "F-1": "lixo", "F-7": 1 } }).projectFields).toEqual({});
  });
});

describe("folgas de recursos", () => {
  it("guarda datas ordenadas e únicas; lista vazia remove", () => {
    let p = withResourceOff(base, "Ana", ["2026-12-25", "2026-12-24", "2026-12-24"]);
    expect(p.resourceOff.Ana).toEqual(["2026-12-24", "2026-12-25"]);
    expect(withResourceOff(p, "Ana", ["2026-12-24", "2026-12-25"])).toBe(p);
    expect(() => withResourceOff(p, "Ana", ["25/12/2026"])).toThrow(PmoError);
    p = withResourceOff(p, "Ana", []);
    expect(p.resourceOff).toEqual({});
  });
});

describe("fluxo de aprovação em etapas", () => {
  const cr = { id: "C-1", title: "Mudança", status: "rascunho" as const, costDeltas: [{ activityId: "a", delta: 100 }] };
  const flow = [{ role: "analyst" as const, label: "Análise" }, { role: "manager" as const, label: "Gerência" }];
  it("sem fluxo, só gerente ou diretor aprova (comportamento antigo)", () => {
    let p = withChangeStatus(withChange(base, cr), "C-1", "em_aprovacao");
    expect(canApproveNext(p, p.changes[0]!, "analyst")).toBe(false);
    expect(() => approveChangeStep(p, "C-1", { role: "analyst", name: "A" }, "2026-11-04T10:00:00Z")).toThrow(PmoError);
    p = approveChangeStep(p, "C-1", { role: "manager", name: "M" }, "2026-11-04T10:00:00Z");
    expect(p.changes[0]!.status).toBe("aprovada");
  });
  it("com fluxo, exige as etapas em ordem; o diretor assina qualquer etapa", () => {
    let p = withApprovalFlow(base, flow);
    p = withChangeStatus(withChange(p, cr), "C-1", "em_aprovacao");
    expect(() => withChangeStatus(p, "C-1", "aprovada")).toThrow(PmoError);
    expect(() => approveChangeStep(p, "C-1", { role: "manager", name: "M" }, "2026-11-04T10:00:00Z")).toThrow(PmoError);
    p = approveChangeStep(p, "C-1", { role: "analyst", name: "Ana" }, "2026-11-04T10:00:00Z");
    expect(p.changes[0]!.status).toBe("em_aprovacao");
    expect(p.changes[0]!.approvals).toHaveLength(1);
    expect(() => withApprovalFlow(p, [])).toThrow(PmoError); // aprovação em andamento
    p = approveChangeStep(p, "C-1", { role: "director", name: "Dir" }, "2026-11-04T11:00:00Z");
    expect(p.changes[0]!.status).toBe("aprovada");
    expect(p.changes[0]!.approvals).toHaveLength(2);
  });
  it("devolver a rascunho zera as aprovações; fluxo inválido é recusado", () => {
    let p = withApprovalFlow(base, flow);
    p = withChangeStatus(withChange(p, cr), "C-1", "em_aprovacao");
    p = approveChangeStep(p, "C-1", { role: "analyst", name: "Ana" }, "2026-11-04T10:00:00Z");
    p = withChangeStatus(p, "C-1", "rascunho");
    expect(p.changes[0]!.approvals).toBeUndefined();
    expect(() => withApprovalFlow(base, [{ role: "tenant" as any, label: "x" }])).toThrow(PmoError);
    expect(() => withApprovalFlow(base, Array(6).fill(flow[0]))).toThrow(PmoError);
    expect(normalizePlanning({ approvalFlow: [{ role: "x", label: "y" }, flow[0]] }).approvalFlow).toEqual([flow[0]]);
  });
});

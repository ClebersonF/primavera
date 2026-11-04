import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, PmoError, applyGlobalChange, layoutNetwork, mergeActivityPlans, planWbs, scheduleCpm, stepsPercent, withActivityPlan, withCodeType, workToWbsInputs } from "../src";

describe("restrição obrigatória no motor", () => {
  it("o início obrigatório vence os vínculos e fixa a atividade", () => {
    const r = scheduleCpm([
      { id: "a", duration: 5 },
      { id: "b", duration: 3, predecessors: [{ id: "a" }], mandatoryStart: 2 },
      { id: "c", duration: 2, predecessors: [{ id: "b" }] },
    ]);
    const b = r.activities.find((x) => x.id === "b")!;
    expect([b.earlyStart, b.earlyFinish, b.totalFloat]).toEqual([2, 5, 0]); // a termina em 5, mas b é fixada em 2
    expect(r.activities.find((x) => x.id === "c")!.earlyStart).toBe(5);
    expect(() => scheduleCpm([{ id: "a", duration: 1, mandatoryStart: -1 }])).toThrow();
  });
  it("o adaptador converte iniciar_em e terminar_em em dias úteis, ignorando datas impossíveis", () => {
    const work: any = { id: "w", title: "W", kickoffAt: "2026-11-02T00:00:00Z", createdAt: "2026-11-02T00:00:00Z", activities: [
      { id: "a", title: "A", status: "todo", durationDays: 5 },
      { id: "b", title: "B", status: "todo", durationDays: 2, predecessors: [{ id: "a" }], constraint: { kind: "iniciar_em", date: "2026-11-04" } },
      { id: "c", title: "C", status: "todo", durationDays: 2, predecessors: [], constraint: { kind: "terminar_em", date: "2026-11-13" } },
      { id: "d", title: "D", status: "todo", durationDays: 2, predecessors: [], constraint: { kind: "iniciar_em", date: "2026-10-01" } },
    ] };
    const { inputs, assumptions } = workToWbsInputs(work);
    const get = (id: string) => inputs.find((i) => i.id === id)!;
    expect(get("b").mandatoryStart).toBe(2); // 02/11 seg → 04/11 qua = 2 dias úteis
    expect(get("c").mandatoryStart).toBe(8); // termina sex 13/11: 10 dias úteis desde 02/11, menos 2 de duração
    expect(get("d").mandatoryStart).toBeUndefined();
    expect(assumptions.some((a) => a.includes("anterior ao início"))).toBe(true);
    const plan = planWbs(inputs);
    expect(plan.leaves.find((l) => l.id === "b")!.start).toBe(2);
  });
});

describe("passos, documentos e restrição no planejamento", () => {
  it("passos pesam o avanço e só valem sem % nem término real", () => {
    const steps = [{ title: "Cercar", done: true, weight: 1 }, { title: "Plantar", done: false, weight: 3 }];
    expect(stepsPercent(steps)).toBe(25);
    expect(stepsPercent([])).toBeNull();
    const p = withActivityPlan(EMPTY_PLANNING, "a", { steps });
    const [m] = mergeActivityPlans([{ id: "a" }], p.activityPlans);
    expect(m!.percentComplete).toBe(25);
    const q = withActivityPlan(p, "a", { percentComplete: 60 });
    expect(mergeActivityPlans([{ id: "a" }], q.activityPlans)[0]!.percentComplete).toBe(60);
    expect(() => withActivityPlan(EMPTY_PLANNING, "a", { steps: [{ title: "x", done: false, weight: 0 }] })).toThrow(PmoError);
  });
  it("documentos: valida tipo, situação e endereço http(s)", () => {
    const ok = withActivityPlan(EMPTY_PLANNING, "a", { documents: [{ name: " Laudo ", kind: "evidencia", status: "entregue", url: "https://x.org/laudo.pdf" }] });
    expect(ok.activityPlans.a!.documents![0]!.name).toBe("Laudo");
    for (const bad of [{ name: "x", kind: "outro", status: "pendente" }, { name: "x", kind: "produto", status: "feito" }, { name: "x", kind: "produto", status: "pendente", url: "javascript:alert(1)" }, { name: "", kind: "produto", status: "pendente" }]) {
      expect(() => withActivityPlan(EMPTY_PLANNING, "a", { documents: [bad as any] })).toThrow(PmoError);
    }
  });
  it("restrição obrigatória: grava, valida data e tipo", () => {
    const p = withActivityPlan(EMPTY_PLANNING, "a", { constraint: { kind: "terminar_em", date: "2026-12-01" } });
    expect(p.activityPlans.a!.constraint).toEqual({ kind: "terminar_em", date: "2026-12-01" });
    expect(() => withActivityPlan(p, "a", { constraint: { kind: "x" as any, date: "2026-12-01" } })).toThrow(PmoError);
    expect(() => withActivityPlan(p, "a", { constraint: { kind: "iniciar_em", date: "2026-02-30" } })).toThrow(PmoError);
  });
});

describe("mudança global", () => {
  const targets = [{ id: "a", duration: 10 }, { id: "b", duration: 4 }];
  it("fator, delta, grupo e código em lote", () => {
    let p = withCodeType(EMPTY_PLANNING, { id: "T-1", name: "Fase", values: ["Plantio"] });
    p = applyGlobalChange(p, targets, { durationFactor: 1.5, durationDelta: 1, group: "Campo", code: { typeId: "T-1", value: "Plantio" } });
    expect(p.activityPlans.a).toMatchObject({ durationDays: 16, group: "Campo", codes: { "T-1": "Plantio" } });
    expect(p.activityPlans.b!.durationDays).toBe(7);
  });
  it("desloca prazos existentes, ignora atividades sem prazo e nunca deixa duração negativa", () => {
    let p = withActivityPlan(EMPTY_PLANNING, "a", { deadline: "2026-11-30" });
    p = applyGlobalChange(p, targets, { deadlineShiftDays: 10 });
    expect(p.activityPlans.a!.deadline).toBe("2026-12-10");
    expect(p.activityPlans.b).toBeUndefined();
    expect(applyGlobalChange(EMPTY_PLANNING, targets, { durationDelta: -50 }).activityPlans.a!.durationDays).toBe(0);
  });
  it("tudo ou nada e validações", () => {
    expect(() => applyGlobalChange(EMPTY_PLANNING, targets, { code: { typeId: "T-9", value: "x" } })).toThrow(PmoError);
    expect(() => applyGlobalChange(EMPTY_PLANNING, [], { durationDelta: 1 })).toThrow(PmoError);
    expect(() => applyGlobalChange(EMPTY_PLANNING, targets, {})).toThrow(PmoError);
    expect(() => applyGlobalChange(EMPTY_PLANNING, targets, { durationFactor: 50 })).toThrow(PmoError);
    expect(() => applyGlobalChange(EMPTY_PLANNING, targets, { durationDelta: 1.5 })).toThrow(PmoError);
  });
});

describe("diagrama de rede", () => {
  it("colunas pelo maior caminho, vínculos críticos e predecessoras inexistentes ignoradas", () => {
    const l = layoutNetwork([
      { id: "a", name: "A", critical: true },
      { id: "b", name: "B", critical: true, predecessors: [{ id: "a" }, { id: "fantasma" }] },
      { id: "c", name: "C", predecessors: [{ id: "a", type: "SS", lag: 2 }] },
      { id: "d", name: "D", critical: true, predecessors: [{ id: "b" }, { id: "c" }] },
    ]);
    expect(l.nodes.map((n) => [n.id, n.level, n.row])).toEqual([["a", 0, 0], ["b", 1, 0], ["c", 1, 1], ["d", 2, 0]]);
    expect(l.levels).toBe(3);
    expect(l.rows).toBe(2);
    expect(l.edges.find((e) => e.from === "a" && e.to === "c")).toMatchObject({ type: "SS", lag: 2, critical: false });
    expect(l.edges.find((e) => e.from === "a" && e.to === "b")!.critical).toBe(true);
    expect(l.edges).toHaveLength(4);
  });
  it("ciclo e ids duplicados são recusados; vazio é válido", () => {
    expect(() => layoutNetwork([{ id: "a", name: "A", predecessors: [{ id: "b" }] }, { id: "b", name: "B", predecessors: [{ id: "a" }] }])).toThrow(PmoError);
    expect(() => layoutNetwork([{ id: "a", name: "A" }, { id: "a", name: "A2" }])).toThrow(PmoError);
    expect(layoutNetwork([])).toEqual({ nodes: [], edges: [], levels: 0, rows: 0 });
  });
});

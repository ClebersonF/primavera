import { describe, expect, it } from "vitest";
import { planWbs, workDaysBetween, workToWbsInputs, type WorkLike } from "../src";

// 2026-11-02 é segunda-feira.
const work = (over: Partial<WorkLike> = {}): WorkLike => ({
  id: "obr-1",
  title: "Retrofit",
  kickoffAt: "2026-11-02T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  budgetBRL: 1000,
  activities: [
    { id: "a1", title: "Mobilização", status: "done", completedAt: "2026-11-06T12:00:00.000Z" },
    { id: "a2", title: "Remoção", status: "done", completedAt: "2026-11-13T12:00:00.000Z" },
    { id: "a3", title: "Reforço", status: "doing", dueDate: "2026-11-20T12:00:00.000Z" },
    { id: "a4", title: "Instalação", status: "todo" },
  ],
  ...over,
});

describe("workDaysBetween", () => {
  it("conta dias úteis em [from, to)", () => {
    expect(workDaysBetween("2026-11-02", "2026-11-09")).toBe(5);
    expect(workDaysBetween("2026-11-07", "2026-11-09")).toBe(0); // sáb–dom
    expect(workDaysBetween("2026-11-09", "2026-11-02")).toBe(0);
    expect(workDaysBetween("2026-11-02", "2026-11-02")).toBe(0);
    expect(workDaysBetween("2026-11-02", "2026-11-07", { workWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-11-04"] })).toBe(4);
  });
});

describe("workToWbsInputs", () => {
  it("deriva durações das datas, encadeia em sequência e rateia o orçamento", () => {
    const { startDate, inputs, assumptions } = workToWbsInputs(work());
    expect(startDate).toBe("2026-11-02");
    const leaves = inputs.filter((n) => n.parentId !== null);
    expect(leaves.map((l) => l.duration)).toEqual([5, 5, 5, 1]);
    expect(leaves.map((l) => l.plannedCost)).toEqual([312.5, 312.5, 312.5, 62.5]);
    expect(leaves.map((l) => l.percentComplete)).toEqual([100, 100, 50, 0]);
    expect(leaves[0]!.predecessors).toBeUndefined();
    expect(leaves[2]!.predecessors).toEqual([{ id: "a2" }]);
    expect(assumptions.join("\n")).toMatch(/Instalação.*sem data/);
    expect(assumptions.join("\n")).toMatch(/sequência/);
    expect(assumptions.join("\n")).toMatch(/50%/);
    expect(assumptions.join("\n")).toMatch(/rateado/);

    const plan = planWbs(inputs);
    expect(plan.projectDuration).toBe(16);
    expect(plan.totalPlannedCost).toBe(1000);
    expect(plan.percentComplete).toBe(78.13);
  });

  it("respeita duração e dependências explícitas", () => {
    const w = work({
      activities: [
        { id: "a1", title: "A", status: "todo", durationDays: 5, predecessorIds: [] },
        { id: "a2", title: "B", status: "todo", durationDays: 3, predecessorIds: [] },
        { id: "a3", title: "C", status: "todo", durationDays: 2, predecessorIds: ["a1", "a2"] },
      ],
    });
    const { inputs, assumptions } = workToWbsInputs(w);
    expect(assumptions.join("\n")).not.toMatch(/sequência/);
    const plan = planWbs(inputs);
    expect(plan.byId.get("a2")!.start).toBe(0);
    expect(plan.projectDuration).toBe(7);
    expect(plan.cpm.criticalPath).toEqual(["a1", "a3"]);
  });

  it("usa o calendário com feriados", () => {
    const { inputs } = workToWbsInputs(work(), { workWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-11-04"] });
    expect(inputs.find((n) => n.id === "a1")!.duration).toBe(4);
  });

  it("assume 1 dia quando a data está fora da ordem da lista", () => {
    const w = work({
      activities: [
        { id: "a1", title: "A", status: "done", completedAt: "2026-11-13T00:00:00.000Z" },
        { id: "a2", title: "B", status: "done", completedAt: "2026-11-06T00:00:00.000Z" },
      ],
    });
    const { inputs, assumptions } = workToWbsInputs(w);
    expect(inputs.find((n) => n.id === "a2")!.duration).toBe(1);
    expect(assumptions.join("\n")).toMatch(/fora da ordem/);
  });

  it("sem kickoff começa na criação e sem atividades devolve EAP vazia", () => {
    const noKick = workToWbsInputs(work({ kickoffAt: undefined }));
    expect(noKick.startDate).toBe("2026-10-01");
    expect(noKick.assumptions.join("\n")).toMatch(/Sem kickoff/);
    const empty = workToWbsInputs(work({ activities: [] }));
    expect(empty.inputs).toEqual([]);
    expect(planWbs(empty.inputs).projectDuration).toBe(0);
  });

  it("não perde centavos no rateio e funciona sem orçamento", () => {
    const w = work({ budgetBRL: 100.01 });
    const plan = planWbs(workToWbsInputs(w).inputs);
    expect(plan.totalPlannedCost).toBe(100.01);
    const none = planWbs(workToWbsInputs(work({ budgetBRL: undefined })).inputs);
    expect(none.totalPlannedCost).toBe(0);
  });
});

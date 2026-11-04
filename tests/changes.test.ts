import { describe, expect, it } from "vitest";
import { applyApprovedChange, assessChange, PmoError, transitionChange, type ChangeRequest } from "../src";
import { sampleWbs } from "./fixtures";

const cr = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: "MUD-1",
  title: "Reforço estrutural",
  status: "rascunho",
  ...over,
});

describe("assessChange", () => {
  it("mostra o impacto em prazo e custo", () => {
    const impact = assessChange(
      sampleWbs(),
      cr({ durationDeltas: [{ activityId: "B", delta: 3 }], costDeltas: [{ activityId: "B", delta: 100 }] }),
    );
    expect(impact).toMatchObject({
      durationBefore: 19,
      durationAfter: 22,
      durationDelta: 3,
      costBefore: 4500.5,
      costAfter: 4600.5,
      costDelta: 100,
      criticalPathBefore: ["A", "B", "C"],
      criticalPathAfter: ["A", "B", "C"],
      newlyCritical: [],
    });
  });

  it("detecta quando o caminho crítico muda", () => {
    const impact = assessChange(sampleWbs(), cr({ durationDeltas: [{ activityId: "C", delta: -3 }] }));
    expect(impact.durationDelta).toBe(-2);
    expect(impact.criticalPathAfter).toEqual(["A", "B", "D"]);
    expect(impact.newlyCritical).toEqual(["D"]);
  });

  it("não altera as entradas e funciona sem ajustes", () => {
    const inputs = sampleWbs();
    assessChange(inputs, cr({ durationDeltas: [{ activityId: "B", delta: 5 }] }));
    expect(inputs).toEqual(sampleWbs());
    expect(assessChange(inputs, cr()).durationDelta).toBe(0);
  });

  it("rejeita ajustes inválidos", () => {
    expect(() => assessChange(sampleWbs(), cr({ durationDeltas: [{ activityId: "C", delta: -5 }] }))).toThrowError(/negativa/);
    expect(() => assessChange(sampleWbs(), cr({ durationDeltas: [{ activityId: "S", delta: 1 }] }))).toThrowError(/resumo/);
    expect(() => assessChange(sampleWbs(), cr({ durationDeltas: [{ activityId: "Z", delta: 1 }] }))).toThrowError(PmoError);
    expect(() => assessChange(sampleWbs(), cr({ durationDeltas: [{ activityId: "B", delta: 0.5 }] }))).toThrowError(/inteiro/);
    expect(() => assessChange(sampleWbs(), cr({ costDeltas: [{ activityId: "D", delta: -500 }] }))).toThrowError(/negativo/);
  });
});

describe("fluxo de aprovação", () => {
  it("segue as transições permitidas", () => {
    const submitted = transitionChange(cr(), "em_aprovacao");
    expect(submitted.status).toBe("em_aprovacao");
    expect(transitionChange(submitted, "aprovada").status).toBe("aprovada");
    expect(transitionChange(submitted, "rejeitada").status).toBe("rejeitada");
    expect(transitionChange(transitionChange(submitted, "rejeitada"), "rascunho").status).toBe("rascunho");
    expect(() => transitionChange(cr(), "aprovada")).toThrowError(/Transição inválida/);
    expect(() => transitionChange(transitionChange(submitted, "aprovada"), "rascunho")).toThrowError(PmoError);
  });

  it("só incorpora mudanças aprovadas, sem mutar a EAP original", () => {
    const base = sampleWbs();
    const draft = cr({ durationDeltas: [{ activityId: "B", delta: 3 }], costDeltas: [{ activityId: "B", delta: 100 }] });
    expect(() => applyApprovedChange(base, draft)).toThrowError(/não está aprovado/);

    const approved = transitionChange(transitionChange(draft, "em_aprovacao"), "aprovada");
    const next = applyApprovedChange(base, approved);
    const b = next.find((n) => n.id === "B")!;
    expect([b.duration, b.plannedCost]).toEqual([13, 2600.5]);
    expect(base.find((n) => n.id === "B")!.duration).toBe(10);
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_PLANNING, PmoError, normalizePlanning, withProjectKind } from "../src";

describe("tipo de empreendimento", () => {
  it("define, limpa e valida", () => {
    const p = withProjectKind(EMPTY_PLANNING, "loteamento");
    expect(p.kind).toBe("loteamento");
    expect(withProjectKind(p, "loteamento")).toBe(p);
    expect(withProjectKind(p, undefined).kind).toBeUndefined();
    expect(() => withProjectKind(p, "galpao" as any)).toThrow(PmoError);
  });
  it("a normalização descarta valor desconhecido e mantém o válido", () => {
    expect(normalizePlanning({ kind: "condominio" }).kind).toBe("condominio");
    expect(normalizePlanning({ kind: "x" }).kind).toBeUndefined();
  });
});

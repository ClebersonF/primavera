import { describe, expect, it } from "vitest";
import { formatBrNumber, parseBrNumber } from "../src";

describe("número no padrão brasileiro", () => {
  it("lê milhar com ponto, decimal com vírgula e decimal com ponto isolado", () => {
    expect(parseBrNumber("5000000")).toBe(5_000_000);
    expect(parseBrNumber("5.000.000")).toBe(5_000_000);
    expect(parseBrNumber("5.000.000,00")).toBe(5_000_000);
    expect(parseBrNumber("R$ 1.340.000,50")).toBe(1_340_000.5);
    expect(parseBrNumber("1234,5")).toBe(1234.5);
    expect(parseBrNumber("11.2")).toBe(11.2);
    expect(parseBrNumber("11,2 %")).toBe(11.2);
    expect(parseBrNumber("1.234")).toBe(1234);
    expect(parseBrNumber("-250")).toBe(-250);
  });
  it("vazio e lixo viram NaN, nunca zero", () => {
    for (const t of ["", "  ", "abc", "1,2,3", "1.2.3", "12a", ",", "R$"]) expect(parseBrNumber(t)).toBeNaN();
  });
  it("formata com milhar e casas fixas, sem -0", () => {
    expect(formatBrNumber(5_000_000)).toBe("5.000.000,00");
    expect(formatBrNumber(1340000.5)).toBe("1.340.000,50");
    expect(formatBrNumber(0)).toBe("0,00");
    expect(formatBrNumber(11.2)).toBe("11,20");
    expect(formatBrNumber(999.999)).toBe("1.000,00");
    expect(formatBrNumber(-1234.5)).toBe("-1.234,50");
    expect(formatBrNumber(-0.001)).toBe("0,00");
    expect(formatBrNumber(20, 0)).toBe("20");
    expect(formatBrNumber(NaN)).toBe("");
  });
  it("ida e volta: formatar e ler devolve o mesmo valor", () => {
    for (const v of [0, 0.01, 12.34, 1000, 250000, 5_000_000, 78_000_000.99]) expect(parseBrNumber(formatBrNumber(v))).toBe(v);
  });
});

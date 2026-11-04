import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, EMPTY_LICENSING, EMPTY_PLANNING, PmoError, describePlanningChange, licensingSummary, nextLicenseId, normalizePlanning, parseThresholds, withLicenseProcess, withLicensing, withoutLicenseProcess } from "../src";

const lic = (extra = {}) => ({ ...EMPTY_LICENSING, start: "2026-11-01", ...extra });
const proc = (id: string, name = "Outorga de uso da água", extra = {}) => ({ id, name, ...lic(extra) });

describe("vários processos de licenciamento", () => {
  it("cria, atualiza, remove, numera; no-op não muda rev", () => {
    const a = withLicenseProcess(EMPTY_PLANNING, proc("L-1", " Outorga "));
    expect(a.licenses[0]!.name).toBe("Outorga");
    expect(a.rev).toBe(1);
    expect(withLicenseProcess(a, a.licenses[0]!)).toBe(a);
    expect(nextLicenseId(a)).toBe("L-2");
    const b = withLicenseProcess(a, { ...a.licenses[0]!, issuedOn: "2026-12-01" });
    expect(describePlanningChange(a, b)).toContain("Processo de licenciamento L-1 atualizado: Outorga");
    expect(describePlanningChange(EMPTY_PLANNING, a)).toContain("Processo de licenciamento L-1 criado: Outorga");
    expect(withoutLicenseProcess(b, "L-1").licenses).toEqual([]);
    expect(withoutLicenseProcess(b, "L-9")).toBe(b);
  });
  it("o processo principal continua independente", () => {
    const a = withLicensing(withLicenseProcess(EMPTY_PLANNING, proc("L-1")), lic({ withComunique: true }));
    expect(a.licensing?.withComunique).toBe(true);
    expect(a.licenses[0]!.withComunique).toBe(false);
  });
  it("valida entrada", () => {
    expect(() => withLicenseProcess(EMPTY_PLANNING, proc("L-1", "  "))).toThrow(PmoError);
    expect(() => withLicenseProcess(EMPTY_PLANNING, proc("L-1", "x", { start: "01/11/2026" }))).toThrow(PmoError);
    expect(() => withLicenseProcess(EMPTY_PLANNING, proc("L-1", "x".repeat(81)))).toThrow(PmoError);
  });
  it("normaliza JSON salvo, descarta lixo e duplicados; planejamento antigo sem o campo vira lista vazia", () => {
    const p = withLicenseProcess(EMPTY_PLANNING, proc("L-1"));
    expect(normalizePlanning(JSON.parse(JSON.stringify(p))).licenses).toEqual(p.licenses);
    expect(normalizePlanning({ licenses: [proc("L-1"), proc("L-1"), { id: "x" }, null] }).licenses).toHaveLength(1);
    expect(normalizePlanning({ licensing: lic() }).licenses).toEqual([]);
    expect(normalizePlanning({ licensing: lic() }).licensing?.start).toBe("2026-11-01");
  });
  it("resumo: principal só conta se preenchido", () => {
    expect(licensingSummary(EMPTY_PLANNING)).toEqual({ total: 0, started: 0, issued: 0 });
    expect(licensingSummary({ licensing: EMPTY_LICENSING, licenses: [] })).toEqual({ total: 0, started: 0, issued: 0 });
    const p = withLicenseProcess(withLicensing(EMPTY_PLANNING, lic({ issuedOn: "2026-12-01" })), proc("L-1"));
    expect(licensingSummary(p)).toEqual({ total: 2, started: 2, issued: 1 });
  });
});

describe("limiares salvos", () => {
  it("completa com o padrão e rejeita inválidos", () => {
    expect(parseThresholds({})).toEqual(DEFAULT_THRESHOLDS);
    expect(parseThresholds({ spiWarn: 0.9, spiCritical: 0.7 })).toMatchObject({ spiWarn: 0.9, spiCritical: 0.7 });
    expect(parseThresholds({ spiWarn: "0.9" })).toBeNull();
    expect(parseThresholds({ spiWarn: 0.5 })).toBeNull(); // crítico (0,80) > atenção
    expect(parseThresholds({ deadlineWarnDays: -1 })).toBeNull();
    expect(parseThresholds(null)).toBeNull();
    expect(parseThresholds([])).toBeNull();
  });
});

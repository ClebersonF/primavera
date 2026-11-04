import { describe, expect, it } from "vitest";
import {
  appBufferMeters,
  buildGraprohabProcess,
  checkAreaTableConsistency,
  comuniqueSeDeadline,
  GRAPROHAB_DOCUMENTS,
  missingDocuments,
  PmoError,
  scheduleCpm,
} from "../src";

describe("processo GRAPROHAB", () => {
  it("monta a cadeia sem Comunique-se", () => {
    const acts = buildGraprohabProcess();
    expect(acts.map((a) => a.id)).toEqual([
      "graprohab.protocolo",
      "graprohab.distribuicao",
      "graprohab.analise",
      "graprohab.deliberacao",
      "graprohab.certificado",
    ]);
    expect(scheduleCpm(acts).projectDuration).toBe(55);
  });

  it("inclui Comunique-se e reanálise e aceita durações próprias", () => {
    const acts = buildGraprohabProcess({ comuniqueSe: true });
    expect(acts.map((a) => a.id.replace("graprohab.", ""))).toEqual([
      "protocolo",
      "distribuicao",
      "analise",
      "comunique_se",
      "reanalise",
      "deliberacao",
      "certificado",
    ]);
    expect(scheduleCpm(acts).projectDuration).toBe(90);
    expect(scheduleCpm(buildGraprohabProcess({ days: { analise: 45 } })).projectDuration).toBe(70);
    expect(scheduleCpm(buildGraprohabProcess({ days: { analise: 0 } })).projectDuration).toBe(25);
  });

  it("rejeita etapas e durações inválidas", () => {
    expect(() => buildGraprohabProcess({ days: { nope: 3 } as never })).toThrowError(/desconhecida/);
    expect(() => buildGraprohabProcess({ days: { analise: -1 } })).toThrowError(PmoError);
    expect(() => buildGraprohabProcess({ days: { analise: 1.5 } })).toThrowError(PmoError);
  });
});

describe("prazo do Comunique-se", () => {
  it("soma 180 dias corridos", () => {
    expect(comuniqueSeDeadline("2026-11-04")).toBe("2027-05-03");
    expect(comuniqueSeDeadline("2026-11-04", 0)).toBe("2026-11-04");
    expect(comuniqueSeDeadline("2027-12-31", 1)).toBe("2028-01-01");
  });

  it("rejeita datas e prazos inválidos", () => {
    expect(() => comuniqueSeDeadline("04/11/2026")).toThrowError(PmoError);
    expect(() => comuniqueSeDeadline("2026-02-30")).toThrowError(/inexistente/);
    expect(() => comuniqueSeDeadline("2026-11-04", -1)).toThrowError(PmoError);
  });
});

describe("checklist de documentos", () => {
  it("lista os pendentes", () => {
    expect(missingDocuments([])).toHaveLength(GRAPROHAB_DOCUMENTS.length);
    const left = missingDocuments(["matricula", "uso_solo"]).map((d) => d.id);
    expect(left).not.toContain("matricula");
    expect(left).not.toContain("uso_solo");
    expect(left).toHaveLength(GRAPROHAB_DOCUMENTS.length - 2);
    expect(missingDocuments(GRAPROHAB_DOCUMENTS.map((d) => d.id))).toEqual([]);
  });

  it("acusa id desconhecido", () => {
    expect(() => missingDocuments(["matricla"])).toThrowError(/desconhecido/);
  });
});

describe("quadro de áreas", () => {
  const planta = { total: 10_000, lotes: 6000, viario: 2000, verdes: 1000, institucional: 1000 };

  it("não acusa nada quando os documentos batem", () => {
    expect(checkAreaTableConsistency({ planta, memorial: { ...planta }, sabesp: { ...planta } })).toEqual([]);
  });

  it("acusa soma incorreta e divergência entre documentos", () => {
    const issues = checkAreaTableConsistency({ planta, sabesp: { ...planta, viario: 2100 } });
    expect(issues).toEqual([
      { kind: "soma", source: "sabesp", field: "soma", expected: 10_000, found: 10_100 },
      { kind: "divergencia", source: "sabesp", field: "viario", expected: 2000, found: 2100 },
    ]);
  });

  it("considera 'outros' e a tolerância", () => {
    expect(checkAreaTableConsistency({ a: { ...planta, institucional: 900, outros: 100 } })).toEqual([]);
    expect(checkAreaTableConsistency({ a: planta, b: { ...planta, lotes: 6000.005, total: 10_000.005 } })).toEqual([]);
    expect(() => checkAreaTableConsistency({ a: { ...planta, lotes: -1 } })).toThrowError(PmoError);
  });
});

describe("faixa de APP (Código Florestal, art. 4º, I)", () => {
  it("escolhe a faixa pela largura do curso d'água", () => {
    expect([5, 9.99].map(appBufferMeters)).toEqual([30, 30]);
    expect([10, 49].map(appBufferMeters)).toEqual([50, 50]);
    expect([50, 199].map(appBufferMeters)).toEqual([100, 100]);
    expect([200, 599].map(appBufferMeters)).toEqual([200, 200]);
    expect([600, 1000].map(appBufferMeters)).toEqual([500, 500]);
    expect(() => appBufferMeters(-1)).toThrowError(PmoError);
  });
});

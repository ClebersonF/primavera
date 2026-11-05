import { describe, expect, it } from "vitest";
import { PmoError, parseActivityCsv, parseDate, parsePercent, parseStatus } from "../src";

describe("importação de atividades por CSV", () => {
  it("reconhece situações, percentuais e datas em português", () => {
    expect(parseStatus("Concluída")).toBe("done");
    expect(parseStatus("Parcialmente Concluída")).toBe("doing");
    expect(parseStatus("Contínuo")).toBe("doing");
    expect(parseStatus("PENDENTE")).toBe("todo");
    expect(parseStatus("Não Iniciada")).toBe("todo");
    expect(parseStatus("Verificar")).toBe("todo");
    expect(parseStatus("xyz")).toBeNull();
    expect(parsePercent("0,6")).toBe(60);
    expect(parsePercent("60%")).toBe(60);
    expect(parsePercent("1")).toBe(100);
    expect(parsePercent("1%")).toBe(1);
    expect(parsePercent("150")).toBeNull();
    expect(parseDate("2024-03-01 00:00:00")).toBe("2024-03-01");
    expect(parseDate("01/03/2024")).toBe("2024-03-01");
    expect(parseDate("31/02/2024")).toBeNull();
    expect(parseDate("")).toBe("");
  });
  it("lê a planilha de acompanhamento (separador ; e aspas)", () => {
    const csv = [
      "CÓDIGO;ETAPA;DESCRIÇÃO;STATUS;% EXECUÇÃO;DATA INÍCIO;DATA TÉRMINO;RESPONSÁVEL;OBSERVAÇÕES",
      ";;;;;;;;",
      "TER-001;Terraplenagem;Abertura das vias principais;Concluída;1;2024-03-01 00:00:00;2024-04-30 00:00:00;Edlin;",
      "DRE-001;Drenagem Pluvial;Tubulação principal;Parcialmente Concluída;0,7;2024-05-01;;Edlin;",
      'GUI-001;Guia e Sarjeta;"Guia, sarjeta extrusada - 7.860 m";PENDENTE;0;;;;PRIORIDADE',
      "X;Y;;Pendente;0;;;;",
      "Z;Y;Com data ruim;Pendente;0;31/02/2024;;;",
    ].join("\n");
    const r = parseActivityCsv(csv);
    expect(r.rows.map((x) => [x.code, x.status, x.percent])).toEqual([["TER-001", "done", 100], ["DRE-001", "doing", 70], ["GUI-001", "todo", 0]]);
    expect(r.rows[0]).toMatchObject({ group: "Terraplenagem", start: "2024-03-01", finish: "2024-04-30", owner: "Edlin" });
    expect(r.rows[2]!.title).toBe("Guia, sarjeta extrusada - 7.860 m");
    expect(r.errors.map((e) => e.line)).toEqual([6, 7]);
  });
  it("exige a coluna de descrição e recusa arquivo vazio", () => {
    expect(() => parseActivityCsv("a;b\n1;2")).toThrow(PmoError);
    expect(() => parseActivityCsv("")).toThrow(PmoError);
  });
  it("percentual coerente com a situação", () => {
    const r = parseActivityCsv("Descrição;Status;% Execução\nA;Em andamento;1\nB;Concluída;0,3\nC;Pendente;0,5");
    expect(r.rows.map((x) => [x.status, x.percent])).toEqual([["doing", 99], ["done", 100], ["todo", 0]]);
  });
});

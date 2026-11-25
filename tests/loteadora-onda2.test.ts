import { describe, expect, it } from "vitest";
import {
  ABAS_DO_PAPEL, EMPTY_PLANNING, MACROPROCESSOS, PAPEIS, PERFIS_GENERICOS, decidir, novaSolicitacao, papeisNoMacro, raciDe, registrar, sha256Hex,
  updateLoteadora, verificarTrilha, withLoteadora, type Autor,
} from "../src";

const pres: Autor = { usuario: "Presidência (perfil genérico)", email: "presidencia@perfil.solmaior", papel: "presidente", autenticado: false };

describe("SHA-256", () => {
  it("bate com os vetores conhecidos", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    expect(sha256Hex("ação")).toHaveLength(64);
  });
});

describe("RACI e perfis genéricos", () => {
  it("8 papéis, um perfil genérico por papel, RACI dos 10 macroprocessos", () => {
    expect(PAPEIS).toHaveLength(8);
    expect(PERFIS_GENERICOS.map((p) => p.papel)).toEqual([...PAPEIS]);
    expect(MACROPROCESSOS).toHaveLength(10);
    expect(papeisNoMacro("cartorio", "R")).toEqual(["ambiental"]);
    expect(papeisNoMacro("comercial", "R")).toEqual(["comercial"]);
    expect(raciDe("presidente").filter((x) => x.raci === "A")).toHaveLength(8);
    expect(ABAS_DO_PAPEL.canteiro).toContain("canteiro");
    expect(ABAS_DO_PAPEL.comercial).not.toContain("custos");
  });
});

describe("trilha encadeada", () => {
  it("registra decisões com justificativa e impacto e detecta adulteração", () => {
    const sol = novaSolicitacao({ id: "AL-0001", tipo: "aditivo", titulo: "Drenagem extra", valor: 50_000, impactoReforecast: 50_000, criadaPor: "Eng", criadaEm: "2026-11-20T10:00:00Z" });
    let s = updateLoteadora(undefined, (x) => ({ ...x, solicitacoes: [sol] }), { ...pres, papel: "diretoria_tecnica", usuario: "Eng" }, "2026-11-20T10:00:00Z");
    expect(s.trilha.map((r) => r.acao)).toEqual(["alcada_aberta"]);
    const membro = { id: "u", nome: "Eng", papel: "diretoria_tecnica" as const };
    s = updateLoteadora(s, (x) => ({ ...x, solicitacoes: x.solicitacoes.map((y) => decidir(y, membro, "devolver", "2026-11-21T10:00:00Z", "Falta parecer técnico")) }), { ...pres, papel: "diretoria_tecnica", usuario: "Eng" }, "2026-11-21T10:00:00Z");
    const ult = s.trilha.at(-1)!;
    expect(ult).toMatchObject({ acao: "alcada_devolver", alvo: "AL-0001", justificativa: "Falta parecer técnico", impacto: 50_000, seq: 2 });
    expect(verificarTrilha(s.trilha)).toEqual({ integra: true, total: 2 });
    // Relida como viria do banco (JSON + limpeza), a corrente continua íntegra.
    expect(verificarTrilha(updateLoteadora(JSON.parse(JSON.stringify(s)), (x) => x).trilha)).toEqual({ integra: true, total: 2 });
    const adulterada = s.trilha.map((r, i) => (i === 0 ? { ...r, detalhe: "outra coisa" } : r));
    expect(verificarTrilha(adulterada)).toMatchObject({ integra: false, quebraEm: 1 });
    expect(() => updateLoteadora(s, (x) => ({ ...x, trilha: adulterada }))).toThrow(/só de inclusão/);
    expect(() => updateLoteadora(s, (x) => ({ ...x, trilha: x.trilha.slice(1) }))).toThrow(/só de inclusão/);
  });
  it("withLoteadora registra o resumo das demais mudanças", () => {
    const p = withLoteadora(EMPTY_PLANNING, (x) => ({ ...x, ficha: { municipio: "Peruíbe" } }), pres, "2026-11-25T12:00:00Z");
    expect(p.loteadora!.trilha[0]).toMatchObject({ acao: "alteracao", detalhe: "Ficha do empreendimento atualizada", papel: "presidente" });
    expect(registrar([], pres, "2026-11-25T12:00:00Z", { acao: "x", alvo: "y", detalhe: "z" })[0]!.anterior).toBe("0".repeat(64));
  });
});

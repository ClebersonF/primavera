import { describe, expect, it } from "vitest";
import {
  aplicarCorrecoesNovaMarinaV2, aplicarSeedNovaMarina, chaveRegistro, cleanLoteadora, conferirMigracao, contagens, diferencas,
  EMPTY_LOTEADORA, importLotesCsv, LISTAS, montar, particionar, updateLoteadora, type LoteadoraState,
} from "../src";

const AGORA = "2026-11-26T12:00:00Z";
const autor = { usuario: "Teste", autenticado: false };

function pilotoCompleto(): LoteadoraState {
  let s = aplicarCorrecoesNovaMarinaV2(aplicarSeedNovaMarina(EMPTY_LOTEADORA, AGORA, "S").estado, AGORA, "S").estado;
  const linhas = Array.from({ length: 295 }, (_, i) => `Q${String(Math.floor(i / 20) + 1).padStart(2, "0")};${(i % 20) + 1};${250 + (i % 7)};M${i}`);
  const lotes = importLotesCsv(`quadra;lote;area;matricula\n${linhas.join("\n")}`).itens;
  const diarios = Array.from({ length: 365 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 10, 26) + i * 86_400_000).toISOString().slice(0, 10);
    return { data: d, efetivo: 12, equipamentos: "2 escavadeiras", clima: "sol", chuvaMm: 0, texto: `Diário ${d}`, avancos: [], fotos: [], registradoEm: `${d}T17:00:00Z`, por: "Canteiro" };
  });
  s = updateLoteadora(s, (x) => ({ ...x, lotes, diarios: diarios as never }), autor, AGORA);
  return s;
}

describe("Onda 3 — registros por item", () => {
  it("cobre todas as listas do estado", () => {
    const listas = Object.entries(EMPTY_LOTEADORA).filter(([, v]) => Array.isArray(v)).map(([k]) => k);
    expect(listas.filter((k) => !LISTAS.some((l) => l.campo === k))).toEqual([]);
  });

  it("ida e volta sem perda no piloto completo (295 lotes e 1 ano de diários) e rápido", () => {
    const s = pilotoCompleto();
    const t0 = performance.now();
    const regs = particionar(s);
    const volta = montar(JSON.parse(JSON.stringify(regs)));
    const ms = performance.now() - t0;
    expect(volta).toEqual(cleanLoteadora(s));
    expect(conferirMigracao(s, volta)).toEqual({ ok: true, divergencias: [] });
    expect(contagens(s)).toMatchObject({ lotes: 295, diarios: 365, trechos: 25, processos: 4 });
    expect(new Set(regs.map(chaveRegistro)).size).toBe(regs.length);
    expect(ms).toBeLessThan(1500);
  });

  it("grava só o que mudou e apaga o que saiu", () => {
    const s = pilotoCompleto();
    const lote = s.lotes[10]!;
    const depois = updateLoteadora(s, (x) => ({ ...x, lotes: x.lotes.map((l) => (l.id === lote.id ? { ...l, matricula: "NOVA" } : l)), rncs: [] }), autor, AGORA);
    const d = diferencas(s, depois);
    // O lote alterado e o registro novo da trilha (a mudança fica auditada).
    expect(d.gravar.map((r) => r.colecao).sort()).toEqual(["lotes", "trilha"]);
    expect(d.apagar).toEqual([]);
    const sem = { ...depois, processos: depois.processos.slice(1) };
    const d2 = diferencas(depois, sem);
    expect(d2.apagar).toEqual([{ colecao: "processos", chave: depois.processos[0]!.id }]);
    // Reordenar só regrava as posições que mudaram.
    expect(diferencas(depois, depois)).toEqual({ gravar: [], apagar: [] });
  });

  it("duas pessoas em listas diferentes não disputam o mesmo registro", () => {
    const s = pilotoCompleto();
    const a = diferencas(s, { ...s, diarios: [...s.diarios.slice(0, -1), { ...s.diarios.at(-1)!, texto: "editado pelo canteiro" }] });
    const b = diferencas(s, { ...s, comercial: { ...s.comercial, breakevenLotes: 90 } });
    const ka = new Set(a.gravar.map(chaveRegistro));
    expect(b.gravar.some((r) => ka.has(chaveRegistro(r)))).toBe(false);
  });

  it("conferência aponta divergência de contagem", () => {
    const s = pilotoCompleto();
    const r = conferirMigracao(s, { ...s, lotes: s.lotes.slice(1) });
    expect(r.ok).toBe(false);
    expect(r.divergencias[0]).toMatch(/lotes: 295 no JSON × 294/);
  });
});

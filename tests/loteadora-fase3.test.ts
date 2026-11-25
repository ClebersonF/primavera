import { describe, expect, it } from "vitest";
import {
  EMPTY_LOTEADORA, alertasLoteadora, analisarCredito, assinarContrato, baixarEntrada, baixarParcela, cancelarReserva, entregarLote,
  excecoesTabela, fluxoIntegrado, gerarParcelas, indicadoresComerciais, isValidCpf, ocupacaoLote, parcelaPrice, precoTabela, proporFromReserva,
  recebiveis, reservar, statusEspelho, statusReserva, travaR01, travasContrato, updateLoteadora, type Comercial, type Lote, type TabelaVendas,
} from "../src";

const CPF = "52998224725";
const lote = (id: string, extra: Partial<Lote> = {}): Lote => ({ id, quadra: id.split("-")[0]!, numero: id.split("-")[1]!, areaM2: 300, matricula: `M${id}`, fisico: "a_executar", comercial: "disponivel", ...extra });
const tabela: TabelaVendas = { publicadaEm: "2026-11-01", publicadaPor: "Luciano", precoM2: 1000, ajusteQuadra: { B: 0.1 }, precoLote: { "A-9": 500_000 }, entradaMin: 0.1, parcelasMax: 120, jurosMes: 0.01 };
const cartorio = { decretoEm: "2026-06-01", notas: [], registradoEm: "2026-10-01" };
const vazio: Comercial = { reservas: [], propostas: [], vendas: [], tabela };
const T0 = "2026-11-25T12:00:00.000Z";

describe("documento e tabela", () => {
  it("valida CPF e calcula preço por m², quadra e preço fechado", () => {
    expect(isValidCpf(CPF)).toBe(true);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(precoTabela(lote("A-1"), tabela)).toBe(300_000);
    expect(precoTabela(lote("B-1"), tabela)).toBe(330_000);
    expect(precoTabela(lote("A-9"), tabela)).toBe(500_000);
  });
  it("trava do R-01 e exceções de tabela", () => {
    expect(travaR01(lote("A-1"), { decretoEm: "2026-06-01", notas: [] })).toMatch(/R-01/);
    expect(travaR01(lote("A-1", { matricula: undefined }), cartorio)).toMatch(/matrícula/);
    expect(excecoesTabela({ valor: 270_000, valorTabela: 300_000, entrada: 20_000, parcelas: 150 }, tabela)).toHaveLength(3);
    expect(parcelaPrice(100_000, 10, 0)).toBe(10_000);
  });
});

describe("reserva → proposta → contrato → entrega", () => {
  it("reserva expira em 48 h e não reserva o mesmo lote duas vezes", () => {
    const l = lote("A-1");
    let c = reservar(vazio, l, cartorio, { doc: CPF, nome: "Ana" }, "Corretor X", T0);
    expect(statusReserva(c.reservas[0]!, "2026-11-27T11:59:00Z")).toBe("ativa");
    expect(statusReserva(c.reservas[0]!, "2026-11-27T12:01:00Z")).toBe("expirada");
    expect(() => reservar(c, l, cartorio, { doc: CPF, nome: "Bia" }, "Y", T0)).toThrow(/já está em reserva/);
    expect(statusEspelho(l, c, "2026-11-28T00:00:00Z")).toBe("disponivel");
    c = cancelarReserva(c, "RS-0001", "2026-11-25T13:00:00Z");
    expect(ocupacaoLote(c, "A-1", "2026-11-25T14:00:00Z")).toBeNull();
    expect(() => reservar(vazio, l, undefined, { doc: CPF, nome: "Ana" }, "X", T0)).toThrow(/Trava legal/);
  });
  it("exceção de tabela exige Presidência; crédito; parcelas; entrega", () => {
    let l = lote("A-1");
    let c = reservar(vazio, l, cartorio, { doc: CPF, nome: "Ana" }, "X", T0);
    c = proporFromReserva(c, "RS-0001", l, { valor: 280_000, entrada: 28_000, parcelas: 12 }, "X", "2026-11-25T15:00:00Z");
    const p = c.propostas[0]!;
    expect(statusEspelho(l, c, "2026-12-30T00:00:00Z")).toBe("reservado");
    expect(travasContrato(c, p, { lote: l, cartorio, excecaoAprovada: false })).toEqual(["Análise de crédito pendente", "Exceção de tabela sem aprovação da Presidência"]);
    c = analisarCredito(c, p.id, true, "Fernando", "2026-11-26T10:00:00Z");
    c = assinarContrato(c, p.id, { lote: l, cartorio, excecaoAprovada: true }, "2026-11-30");
    const v = c.vendas[0]!;
    expect(v.parcelas).toHaveLength(12);
    expect(v.parcelas[0]!.venc).toBe("2026-12-28");
    expect(statusEspelho(l, c, T0)).toBe("vendido");
    expect(() => entregarLote(c, v.id, l, { em: "2027-01-10", recebidoPor: "Ana", termoAssinado: true })).toThrow(/Entrada/);
    c = baixarEntrada(c, v.id, "2026-12-01");
    expect(() => entregarLote(c, v.id, l, { em: "2027-01-10", recebidoPor: "Ana", termoAssinado: true })).toThrow(/Infraestrutura/);
    l = { ...l, fisico: "infra_concluida" };
    c = entregarLote(c, v.id, l, { em: "2027-01-10", recebidoPor: "Ana", termoAssinado: true });
    expect(c.vendas[0]!.entrega?.recebidoPor).toBe("Ana");
  });
});

describe("indicadores, fluxo e estado", () => {
  it("VGV, breakeven, VSO e inadimplência", () => {
    const lotes = [lote("A-1"), lote("A-2"), lote("A-3"), lote("A-4")];
    let c = reservar(vazio, lotes[0]!, cartorio, { doc: CPF, nome: "Ana" }, "X", "2026-09-01T12:00:00Z");
    c = proporFromReserva(c, "RS-0001", lotes[0]!, { valor: 300_000, entrada: 30_000, parcelas: 3 }, "X", "2026-09-01T13:00:00Z");
    c = analisarCredito(c, "PP-0001", true, "F", "2026-09-02T10:00:00Z");
    c = assinarContrato(c, "PP-0001", { lote: lotes[0]!, cartorio, excecaoAprovada: false }, "2026-09-05");
    c = baixarEntrada(c, "CV-0001", "2026-09-05");
    c = baixarParcela(c, "CV-0001", 0, "2026-10-05");
    const ind = indicadoresComerciais(lotes, { ...c, breakevenLotes: 2 }, "2026-11-25", "2026-11-25T12:00:00Z");
    expect(ind).toMatchObject({ vgvTabela: 1_200_000, vgvVendido: 300_000, lotesVendidos: 1, lotesDisponiveis: 3, progressoBreakeven: 0.5, vsoMes: 0 });
    // Parcela de 05/11 vencida há 20 dias: ainda não conta como inadimplência (> 30 dias).
    expect(ind.inadimplencia).toBe(0);
    const fluxo = fluxoIntegrado(recebiveis(c), [{ data: "2026-09-20", valor: 50_000, realizado: true }]);
    expect(fluxo[0]).toMatchObject({ mes: "2026-09", entradasRealizadas: 30_000, saidasRealizadas: 50_000, saldoAcumulado: -20_000 });
    expect(gerarParcelas(1000, 2, 0, "2026-01-31").map((p) => p.venc)).toEqual(["2026-02-28", "2026-03-28"]);
  });
  it("estado guarda o comercial e alerta reserva perto de expirar", () => {
    const s = updateLoteadora(undefined, (st) => ({ ...st, lotes: [lote("A-1")], cartorio, comercial: reservar(vazio, lote("A-1"), cartorio, { doc: CPF, nome: "Ana" }, "X", T0) }));
    expect(s.comercial.reservas).toHaveLength(1);
    const al = alertasLoteadora({ ...EMPTY_LOTEADORA, ...s }, { hoje: "2026-11-27", agora: "2026-11-27T08:00:00Z" });
    expect(al.some((a) => a.titulo === "Reserva RS-0001")).toBe(true);
  });
});

import { kpisPerfil, resumoEmpreendimento } from "../src";
describe("painel executivo", () => {
  it("resume o empreendimento e filtra alertas por perfil", () => {
    const s = { ...EMPTY_LOTEADORA, cartorio: { decretoEm: "2026-06-01", notas: [] }, rncs: [] };
    const r = resumoEmpreendimento(s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z" });
    expect(r.saldoCartorio).toBe(3);
    expect(r.nivel).toBe("critico");
    const pres = kpisPerfil("presidencia", s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z", idp: 0.92 });
    expect(pres.kpis[0]).toMatchObject({ valor: "3 dias", nivel: "critico" });
    expect(pres.kpis.find((k) => k.rotulo.startsWith("IDP"))?.nivel).toBe("amarelo");
    expect(kpisPerfil("financeiro", s, { hoje: "2026-11-25", agora: "2026-11-25T12:00:00Z" }).alertas.length).toBeGreaterThan(0);
  });
});

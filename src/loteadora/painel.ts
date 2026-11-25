import { alertasLoteadora, nivelGeral, type Alerta, type EntradaAlertas } from "./alertas";
import type { Papel } from "./alcadas";
import { statusSolicitacao } from "./alcadas";
import { avancoTrecho } from "./campo";
import { indicadoresComerciais, vgvReferencia } from "./comercial";
import type { Nivel } from "./common";
import { indiceRefacao, rncAberta } from "./qualidade";
import { compararReforecast } from "./reforecast";
import { PARAMETROS_PADRAO, processoEncerrado, relogioCartorio } from "./regulatorio";
import type { LoteadoraState } from "./state";

/**
 * Fase 3 — Painel Executivo 360º (documento, módulo 7): uma linha por empreendimento para a visão
 * multi-obras e quatro visões por perfil (Presidência, Engenharia/Obras, Ambiental, Financeiro).
 */

export interface ResumoEmpreendimento {
  nivel: Nivel;
  alertas: number;
  criticos: number;
  /** Dias até o limite do cartório (null sem decreto ou já registrado). */
  saldoCartorio: number | null;
  vgvVendido: number;
  lotesVendidos: number;
  progressoBreakeven: number;
  margemBruta: number | null;
  desvioCusto: number | null;
  rncAbertas: number;
  alcadasPendentes: number;
  /** Avanço físico médio dos trechos (0..100). */
  avancoFisico: number | null;
}

export function resumoEmpreendimento(s: LoteadoraState, e: EntradaAlertas): ResumoEmpreendimento {
  const alertas = alertasLoteadora(s, e);
  const cart = s.cartorio && !s.cartorio.registradoEm ? relogioCartorio(s.cartorio, e.hoje, s.parametros ?? PARAMETROS_PADRAO, e.calendario) : null;
  const ind = indicadoresComerciais(s.lotes, s.comercial, e.hoje, e.agora);
  const custos = s.etapas.length ? compararReforecast(s.etapas, s.reforecasts, e.realizadoPorAtividade ?? {}, vgvReferencia(s.lotes, s.comercial, s.vgv).valor, s.metaMargem) : null;
  return {
    nivel: nivelGeral(alertas),
    alertas: alertas.length,
    criticos: alertas.filter((a) => a.nivel === "critico").length,
    saldoCartorio: cart ? cart.saldo : null,
    vgvVendido: ind.vgvVendido,
    lotesVendidos: ind.lotesVendidos,
    progressoBreakeven: ind.progressoBreakeven,
    margemBruta: custos?.margemBruta ?? null,
    desvioCusto: custos?.desvioTotal ?? null,
    rncAbertas: s.rncs.filter(rncAberta).length,
    alcadasPendentes: s.solicitacoes.filter((x) => statusSolicitacao(x).status === "pendente").length,
    avancoFisico: s.trechos.length ? Math.round((s.trechos.reduce((a, t) => a + avancoTrecho(s.frentes, t.id), 0) / s.trechos.length) * 10) / 10 : null,
  };
}

export const PERFIS = ["presidencia", "engenharia", "ambiental", "financeiro"] as const;
export type Perfil = (typeof PERFIS)[number];
export const PERFIL_LABEL: Record<Perfil, string> = { presidencia: "Presidência", engenharia: "Engenharia e obras", ambiental: "Ambiental e regulatório", financeiro: "Financeiro" };
/** Papéis cujos alertas cada visão mostra (a Presidência vê tudo). */
export const PAPEIS_DO_PERFIL: Record<Perfil, readonly Papel[] | "todos"> = {
  presidencia: "todos",
  engenharia: ["diretoria_tecnica", "canteiro", "projetista"],
  ambiental: ["ambiental"],
  financeiro: ["cfo", "comercial"],
};

export interface Kpi {
  rotulo: string;
  valor: string;
  nivel: Nivel;
  dica?: string;
}

const pct = (v: number | null, casas = 1) => (v === null ? "—" : `${(v * 100).toFixed(casas).replace(".", ",")}%`);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Indicadores do documento (seção 6) para cada perfil. `idp`/`idc` vêm do EVM da obra, quando houver. */
export function kpisPerfil(perfil: Perfil, s: LoteadoraState, e: EntradaAlertas & { idp?: number | null; idc?: number | null }): { kpis: Kpi[]; alertas: Alerta[] } {
  const r = resumoEmpreendimento(s, e);
  const todos = alertasLoteadora(s, e);
  const filtro = PAPEIS_DO_PERFIL[perfil];
  const alertas = filtro === "todos" ? todos : todos.filter((a) => a.papeis.some((p) => filtro.includes(p)));
  const ind = indicadoresComerciais(s.lotes, s.comercial, e.hoje, e.agora);
  const custos = s.etapas.length ? compararReforecast(s.etapas, s.reforecasts, e.realizadoPorAtividade ?? {}, vgvReferencia(s.lotes, s.comercial, s.vgv).valor, s.metaMargem) : null;
  const nivelIdx = (v: number | null | undefined): Nivel => (v === null || v === undefined ? "verde" : v >= 0.95 ? "verde" : v >= 0.9 ? "amarelo" : "vermelho");
  const cartorio: Kpi = { rotulo: "Prazo caducal do cartório", valor: r.saldoCartorio === null ? (s.cartorio?.registradoEm ? "Registrado" : "—") : `${r.saldoCartorio} dias`, nivel: r.saldoCartorio === null ? "verde" : r.saldoCartorio <= 60 ? "critico" : r.saldoCartorio <= 90 ? "vermelho" : r.saldoCartorio <= 150 ? "amarelo" : "verde", dica: "Meta: registro até D+120" };
  const idp: Kpi = { rotulo: "IDP (prazo)", valor: e.idp ? e.idp.toFixed(2).replace(".", ",") : "—", nivel: nivelIdx(e.idp), dica: "Meta ≥ 0,95" };
  const idc: Kpi = { rotulo: "IDC (custo)", valor: e.idc ? e.idc.toFixed(2).replace(".", ",") : "—", nivel: nivelIdx(e.idc), dica: "Meta ≥ 0,95" };
  const margem: Kpi = { rotulo: "Margem bruta", valor: pct(r.margemBruta), nivel: r.margemBruta !== null && s.metaMargem !== undefined && r.margemBruta < s.metaMargem ? "vermelho" : "verde", dica: s.metaMargem !== undefined ? `Meta ${pct(s.metaMargem)}` : "Defina VGV e meta em Custos" };
  const vendas: Kpi = { rotulo: "VGV vendido", valor: brl(ind.vgvVendido), nivel: "verde", dica: `${ind.lotesVendidos} de ${ind.breakevenLotes} lotes do breakeven (${pct(ind.progressoBreakeven, 0)})` };
  const rnc: Kpi = { rotulo: "RNCs abertas", valor: String(r.rncAbertas), nivel: r.rncAbertas ? "amarelo" : "verde", dica: "Meta: nenhuma com mais de 7 dias" };
  const refacao = custos ? indiceRefacao(s.rncs, custos.totalReforecast) : null;
  const inad: Kpi = { rotulo: "Inadimplência > 30 dias", valor: pct(ind.inadimplencia), nivel: ind.inadimplencia !== null && ind.inadimplencia > 0.05 ? "vermelho" : "verde" };
  const k: Record<Perfil, Kpi[]> = {
    presidencia: [cartorio, vendas, margem, idp, idc, { rotulo: "Alçadas pendentes", valor: String(r.alcadasPendentes), nivel: r.alcadasPendentes > 5 ? "amarelo" : "verde" }],
    engenharia: [idp, { rotulo: "Avanço físico dos trechos", valor: r.avancoFisico === null ? "—" : `${String(r.avancoFisico).replace(".", ",")}%`, nivel: "verde" }, rnc, { rotulo: "Índice de refação", valor: refacao === null ? "—" : `${refacao.toFixed(2).replace(".", ",")}%`, nivel: refacao !== null && refacao >= 1.5 ? "vermelho" : "verde", dica: "Meta < 1,5%" }, { rotulo: "Dias perdidos por chuva", valor: String(s.diarios.filter((d) => d.clima === "chuva_forte" || d.chuvaMm >= (s.limiteChuvaMm ?? 10)).length), nivel: "verde" }],
    ambiental: [cartorio, { rotulo: "Processos abertos", valor: String(s.processos.filter((p) => !processoEncerrado(p)).length), nivel: "verde" }, { rotulo: "RET em curso", valor: String(s.processos.filter((p) => p.ret && !p.ret.respondidoEm && !processoEncerrado(p)).length), nivel: "verde" }],
    financeiro: [idc, margem, { rotulo: "Desvio do reforecast", valor: pct(r.desvioCusto), nivel: custos?.nivelTotal ?? "verde", dica: "Alerta em 3% e 5%" }, { rotulo: "Carteira a receber", valor: brl(ind.carteira), nivel: "verde", dica: `Recebido ${brl(ind.recebido)}` }, inad, { rotulo: "VSO do mês", valor: pct(ind.vsoMes), nivel: "verde" }],
  };
  return { kpis: k[perfil], alertas };
}

import { NIVEL_LABEL, type Nivel } from "./common";
import type { Alerta } from "./alertas";
import type { LinhaFluxo } from "./comercial";
import { PERFIL_LABEL, type Kpi, type Perfil } from "./painel";
import { VETOR_LABEL, type ResumoVetor } from "./campo";

/** Relatório executivo (7.3): o mesmo HTML para o botão do Painel e para o envio semanal automático. */
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const COR: Record<Nivel, string> = { verde: "#1f7a4a", amarelo: "#9a6b00", vermelho: "#b3261e", critico: "#7a0f0a" };
const AREA: Record<string, string> = { regulatorio: "Regulatório", cartorio: "Cartório", garantias: "Garantias e caução", canteiro: "Canteiro", qualidade: "Qualidade", medicoes: "Medições", suprimentos: "Suprimentos", alcadas: "Alçadas", custos: "Custos", comercial: "Comercial", cronograma: "Cronograma" };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function relatorioExecutivoHtml(obra: string, perfil: Perfil, kpis: readonly Kpi[], alertas: readonly Alerta[], fluxo: readonly LinhaFluxo[], hoje: string, opts: { imprimir?: boolean; vetores?: readonly ResumoVetor[] } = {}): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório executivo — ${esc(obra)}</title>
<style>body{font:12px/1.45 system-ui,sans-serif;color:#1d2420;margin:24px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:18px 0 6px}
.k{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.c{border:1px solid #ccd5cf;border-radius:6px;padding:8px}.c b{display:block;font-size:15px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e8e4;padding:3px 4px;text-align:left;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums}
.t{font-weight:600}@media print{body{margin:12mm}}</style></head><body>
<h1>Relatório executivo — ${esc(obra)}</h1><p>Visão ${esc(PERFIL_LABEL[perfil])} · ${dataBr(hoje)}</p>
<h2>Indicadores</h2><div class="k">${kpis.map((k) => `<div class="c"><span>${esc(k.rotulo)}</span><b style="color:${COR[k.nivel]}">${esc(k.valor)}</b>${k.dica ? `<small>${esc(k.dica)}</small>` : ""}</div>`).join("")}</div>
<h2>Alertas (${alertas.length})</h2>${alertas.length ? `<table>${alertas.map((a) => `<tr><td style="color:${COR[a.nivel]}" class="t">${esc(NIVEL_LABEL[a.nivel])}</td><td>${esc(AREA[a.area] ?? a.area)}</td><td><span class="t">${esc(a.titulo)}</span><br>${esc(a.detalhe)}</td><td>${esc(a.acao)}</td></tr>`).join("")}</table>` : "<p>Nenhum alerta amarelo ou pior.</p>"}
${opts.vetores?.length ? `<h2>Vetores de campo — últimos 30 dias (comitê semanal)</h2><table><tr><th>Vetor</th><th>Dias com impacto</th><th>Dias paralisados</th><th>Última observação</th></tr>${opts.vetores.map((v) => `<tr><td>${esc(VETOR_LABEL[v.vetor])}</td><td class="n">${v.diasComImpacto}</td><td class="n">${v.diasParalisados}</td><td>${esc(v.ultimaObs ?? "—")}</td></tr>`).join("")}</table>` : ""}
${fluxo.length ? `<h2>Fluxo de caixa integrado (obras + vendas)</h2><table><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Saldo do mês</th><th>Acumulado</th></tr>${fluxo.map((l) => `<tr><td>${l.mes}</td><td class="n">${brl(l.entradasRealizadas + l.entradasPrevistas)}</td><td class="n">${brl(l.saidasRealizadas + l.saidasPrevistas)}</td><td class="n">${brl(l.saldoMes)}</td><td class="n">${brl(l.saldoAcumulado)}</td></tr>`).join("")}</table>` : ""}
${opts.imprimir ? "<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>" : ""}</body></html>`;
}

/** Segunda-feira da semana de `hoje` (o relatório semanal sai uma vez por semana). */
export function segundaDaSemana(hoje: string): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dia * 86_400_000).toISOString().slice(0, 10);
}

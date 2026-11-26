import { DEFAULT_CALENDAR, type WorkCalendar } from "../cpm/calendar";
import { PAPEL_LABEL, slaAprovacao, statusSolicitacao, type Membro, type Papel } from "./alcadas";
import { resumoCadastro } from "./cadastro";
import { dataBr, nivelRank, type Nivel } from "./common";
import { compararReforecast, prazoFechamento } from "./reforecast";
import { FRENTE_LABEL, PARAMETROS_PADRAO, processoEncerrado, relogioCartorio, relogioCertificado, relogioRet, semCheckin } from "./regulatorio";
import type { LoteadoraState } from "./state";
import { diariosFaltando } from "./campo";
import { prazoRnc } from "./qualidade";
import { prazoBoletim, rotuloBoletim } from "./medicao";
import { indicadoresComerciais, prazoReserva, statusReserva, vgvReferencia } from "./comercial";
import { diasDeChuvaPendentes, FRENTE_OBRA_LABEL } from "./campo";
import { quinzenaAFechar } from "./fechamento";
import { statusPlantio } from "./plantio";
import { acionamentoAberto, situacaoCaucao, statusGarantia, vencimentoGarantia } from "./garantias";
import { conformidadePlanoDiretor } from "./cadastro";
import { pendenciasMatriz } from "./regulatorio";
import { resumoVetores, VETOR_LABEL } from "./campo";
import { CERTIDAO_LABEL, homologacao, pranchasObsoletas } from "./suprimentos";

/** Matriz de alertas escalonados (documento, 6.1): o mesmo cálculo para o painel e para os avisos. */

export type AreaAlerta = "regulatorio" | "cartorio" | "garantias" | "alcadas" | "custos" | "comercial" | "cronograma" | "canteiro" | "qualidade" | "medicoes" | "suprimentos";

export interface Alerta {
  nivel: Exclude<Nivel, "verde">;
  area: AreaAlerta;
  titulo: string;
  detalhe: string;
  /** Papéis que recebem o alerta, conforme o nível. */
  papeis: Papel[];
  /** Pessoas da equipe da obra com esses papéis. */
  destinatarios: Membro[];
  acao: string;
}

/** Quem recebe cada nível (v1.1): amarelo, o responsável e a diretoria técnica; vermelho, o corpo diretivo e o Jurídico; crítico, também a Presidência. */
export function papeisDoNivel(nivel: Exclude<Nivel, "verde">, responsavel: Papel): Papel[] {
  const set = new Set<Papel>([responsavel]);
  if (nivel === "amarelo") set.add("diretoria_tecnica");
  else {
    ["diretoria_tecnica", "ambiental", "cfo", "juridico"].forEach((p) => set.add(p as Papel));
    if (nivel === "critico") set.add("presidente");
  }
  return [...set];
}

export const ACAO_DO_NIVEL: Record<Exclude<Nivel, "verde">, string> = {
  amarelo: "Plano de ação na reunião semanal",
  vermelho: "Intervenção imediata em até 24 horas",
  critico: "Reunião extraordinária e desbloqueio imediato",
};

export interface EntradaAlertas {
  hoje: string;
  /** Agora (ISO com hora), para o SLA de 48 h. */
  agora: string;
  /** Pagamentos realizados por atividade (R$). */
  realizadoPorAtividade?: Readonly<Record<string, number>>;
  /** Atividades com atraso (dias úteis) em relação à linha de base. */
  atrasos?: readonly { atividade: string; dias: number; id?: string }[];
  calendario?: WorkCalendar;
  /** Hora local do canteiro ("AAAA-MM-DDTHH:MM"), para o diário das 17h30. Sem ela, usa `agora` em UTC-3. */
  agoraLocal?: string;
}

export function alertasLoteadora(s: LoteadoraState, e: EntradaAlertas): Alerta[] {
  const cal = e.calendario ?? DEFAULT_CALENDAR;
  const p = s.parametros ?? PARAMETROS_PADRAO;
  const out: Alerta[] = [];
  const add = (nivel: Nivel, area: AreaAlerta, responsavel: Papel, titulo: string, detalhe: string) => {
    if (nivel === "verde") return;
    const papeis = papeisDoNivel(nivel, responsavel);
    out.push({ nivel, area, titulo, detalhe, papeis, destinatarios: s.equipe.filter((m) => papeis.includes(m.papel)), acao: ACAO_DO_NIVEL[nivel] });
  };

  for (const proc of s.processos) {
    const nome = `${proc.id} · ${proc.orgao}`;
    if (proc.ret && !processoEncerrado(proc)) {
      const r = relogioRet(proc.ret, e.hoje, p);
      add(r.nivel, "regulatorio", "ambiental", `RET ${nome}`, r.mensagem);
    }
    if (proc.certificado) {
      const r = relogioCertificado(proc.certificado, e.hoje, p);
      add(r.nivel, "regulatorio", "ambiental", `Certificado ${nome}`, r.mensagem);
    }
    const sem = semCheckin(proc, e.hoje, p);
    if (sem !== null) add("amarelo", "regulatorio", "ambiental", `Check-in ${nome}`, `${FRENTE_LABEL[proc.frente].split(" (")[0]}: ${sem} dias sem movimento registrado (check-in semanal).`);
  }
  if (s.cartorio) {
    const r = relogioCartorio(s.cartorio, e.hoje, p, cal);
    add(r.nivel, "cartorio", "ambiental", "Registro em cartório (180 dias)", r.mensagem);
  }
  for (const sol of s.solicitacoes) {
    const sla = slaAprovacao(sol, e.agora, cal);
    if (sla?.atrasada) {
      const st = statusSolicitacao(sol);
      const resp: Papel = st.proxima === "presidencia" ? "presidente" : st.proxima === "financeiro" ? "cfo" : "diretoria_tecnica";
      add(sol.urgente ? "vermelho" : "amarelo", "alcadas", resp, `Alçada ${sol.id} parada`, `${sol.titulo}: aguardando ${PAPEL_LABEL[resp]} há ${sol.urgente ? `${sla.horas} horas (limite 48 h)` : `${sla.diasUteis} dias úteis (limite 3)`}.`);
    }
  }
  if (s.etapas.length > 0) {
    const r = compararReforecast(s.etapas, s.reforecasts, e.realizadoPorAtividade ?? {}, vgvReferencia(s.lotes, s.comercial, s.vgv).valor, s.metaMargem);
    for (const l of r.linhas) {
      if (l.nivel !== "verde") add(l.nivel, "custos", "cfo", `Reforecast ${l.etapa.nome}`, `Desvio de ${(l.desvio! * 100).toFixed(1).replace(".", ",")}% sobre o orçado.`);
    }
    if (r.margemBruta !== null && r.metaMargem !== null && r.margemBruta < r.metaMargem) {
      add("vermelho", "custos", "cfo", "Margem bruta abaixo da meta", `Margem de ${(r.margemBruta * 100).toFixed(1).replace(".", ",")}% contra a meta de ${(r.metaMargem * 100).toFixed(1).replace(".", ",")}%.`);
    }
    // Fechamento mensal: o mês anterior precisa estar congelado até o 5º dia útil.
    const [y, m] = e.hoje.split("-").map(Number) as [number, number];
    const anterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    if (!s.reforecasts.some((x) => x.mes === anterior) && e.hoje > prazoFechamento(anterior, cal)) {
      add("amarelo", "custos", "cfo", `Fechamento de ${anterior} pendente`, `O reforecast de ${anterior} devia estar congelado até ${dataBr(prazoFechamento(anterior, cal))}.`);
    }
  }
  const cad = resumoCadastro(s.lotes, s.trechos, s.ficha);
  if (cad.vendaSemMatricula.length > 0) add("critico", "comercial", "comercial", "Venda sem matrícula registrada", `${cad.vendaSemMatricula.length} lote(s) reservado(s) ou vendido(s) sem matrícula (trava legal do R-01): ${cad.vendaSemMatricula.slice(0, 5).join(", ")}${cad.vendaSemMatricula.length > 5 ? "…" : ""}.`);
  for (const a of e.atrasos ?? []) if (a.dias > 7) add("amarelo", "cronograma", "canteiro", `Atraso em ${a.atividade}`, `${a.dias} dias úteis de atraso.`);

  // Fase 2 — canteiro, qualidade, medições e suprimentos.
  if (s.inicioDiario) {
    const local = e.agoraLocal ?? new Date(Date.parse(e.agora) - 3 * 3_600_000).toISOString().slice(0, 16);
    const faltam = diariosFaltando(s.diarios, s.inicioDiario, local, cal);
    if (faltam.length) add(faltam.length > 2 ? "vermelho" : "amarelo", "canteiro", "canteiro", "Diário de obra pendente", `${faltam.length} dia(s) útil(eis) sem diário (prazo 17h30 do dia): ${faltam.slice(-5).map(dataBr).join(", ")}${faltam.length > 5 ? "…" : ""}.`);
  }
  for (const r of s.rncs) {
    const pr = prazoRnc(r, e.agora);
    add(pr.nivel, "qualidade", "canteiro", `${r.id} · trecho ${r.trechoId}`, pr.mensagem);
  }
  for (const b of s.boletins) {
    const pr = prazoBoletim(b, e.hoje, cal);
    add(pr.nivel, "medicoes", b.status === "liberado" ? "cfo" : b.status === "enviado" ? "diretoria_tecnica" : "canteiro", `Medição ${rotuloBoletim(b)}`, pr.mensagem);
  }
  const comContrato = new Set(s.boletins.filter((b) => b.status !== "pago").map((b) => b.fornecedorId));
  for (const f of s.fornecedores) {
    if (!comContrato.has(f.id)) continue;
    const h = homologacao(f, e.hoje);
    const vencidas = h.pendencias.filter((p) => p.includes("vencida"));
    if (vencidas.length) add("vermelho", "suprimentos", "cfo", `Certidão vencida · ${f.nome}`, `${vencidas.join("; ")}. Pagamento não deve ser liberado.`);
    else if (h.vencendo.length) add("amarelo", "suprimentos", "cfo", `Certidão vencendo · ${f.nome}`, `${h.vencendo.map((c) => CERTIDAO_LABEL[c]).join(", ")} vence(m) em até 30 dias.`);
  }
  for (const c of s.cotacoes) {
    const obs = pranchasObsoletas(c.pranchas, s.pranchas);
    if (obs.length) add("vermelho", "suprimentos", "projetista", `Prancha obsoleta em ${c.id}`, `${obs.map((o) => `${o.codigo} citada na ${o.citada}, vigente ${o.vigente}`).join("; ")}: refaça a requisição antes de contratar.`);
  }
  // Onda 1 — frentes atrasadas no Gantt, chuva a decidir, fechamento quinzenal, plantio compensatório.
  const atrasoPorId = new Map((e.atrasos ?? []).filter((a) => a.id).map((a) => [a.id!, a.dias]));
  for (const f of s.frentes) {
    if (!f.atividadeId || f.concluidaEm) continue;
    const dias = atrasoPorId.get(f.atividadeId);
    if (dias && dias > 0) add(dias > 10 ? "vermelho" : "amarelo", "canteiro", "canteiro", `Trecho ${f.trechoId} · ${FRENTE_OBRA_LABEL[f.frente].slice(4)}`, `Atividade do cronograma ${dias} dia(s) útil(eis) atrasada em relação à linha de base.`);
  }
  const chuva = diasDeChuvaPendentes(s.diarios, s.chuvaDecisoes, cal, s.limiteChuvaMm ?? 10);
  if (chuva.length) add("amarelo", "cronograma", "diretoria_tecnica", "Dias de chuva a decidir", `${chuva.length} dia(s) útil(eis) de chuva no diário ainda não viraram dia não útil nem foram recusados: ${chuva.slice(-5).map(dataBr).join(", ")}.`);
  if (s.boletins.length || s.fechamentos.length) {
    const q = quinzenaAFechar(s.fechamentos, e.hoje);
    if (q) add(q.nivel, "medicoes", "diretoria_tecnica", "Fechamento quinzenal", q.mensagem);
  }
  for (const pl of s.plantios) {
    const st = statusPlantio(pl, e.hoje);
    add(st.nivel, "regulatorio", "ambiental", `Plantio compensatório ${pl.id}`, st.mensagem);
  }

  // v1.1 — Plano Diretor, Matriz de Risco do licenciamento, garantias de terceiros, caução e 5 vetores de campo.
  if (Object.keys(s.ficha).length || s.lotes.length || s.processos.length) {
    const pd = conformidadePlanoDiretor(s.ficha, s.lotes);
    if (pd.status === "nao_conforme") add("vermelho", "regulatorio", "consultor", "Projeto não conforme com o Plano Diretor", pd.pendencias.slice(0, 4).join("; ") + ".");
    else if (pd.status === "pendente" && s.processos.length) add("amarelo", "regulatorio", "consultor", "Análise do Plano Diretor pendente", "Trava de conformidade urbanística (F1.02): concluir e validar a análise antes do protocolo.");
  }
  for (const proc of s.processos) {
    const pm = pendenciasMatriz(proc, e.hoje);
    if (pm.length) add("amarelo", "regulatorio", "ambiental", `Matriz de Risco ${proc.id} · ${proc.orgao}`, pm.join("; ") + ".");
  }
  for (const g of s.garantias ?? []) {
    const st = statusGarantia(g, e.hoje);
    const ac = acionamentoAberto(g);
    if (ac) {
      const h = (Date.parse(e.agora) - Date.parse(ac.em.length === 10 ? `${ac.em}T12:00:00Z` : ac.em)) / 3_600_000;
      add(h > 48 ? "vermelho" : "amarelo", "garantias", "diretoria_tecnica", `Garantia ${g.id} acionada · ${g.fornecedor}`, `${ac.descricao}${h > 48 ? ` — sem solução há ${Math.floor(h)} horas (limite 48 h)` : ""}.`);
    } else if (st === "vencendo") add("amarelo", "garantias", "diretoria_tecnica", `Garantia ${g.id} vencendo · ${g.fornecedor}`, `${g.servico}: vence em ${dataBr(vencimentoGarantia(g))}. Vistoria antes do vencimento.`);
  }
  if (s.caucao && !s.caucao.descaucionadaEm) {
    const c = situacaoCaucao(s.caucao, e.hoje);
    if (c.diasPrazo !== null && c.diasPrazo < 0) add("critico", "garantias", "juridico", "Prazo de obras da caução vencido", `Termo ${s.caucao.termo}: prazo perante a Prefeitura venceu em ${dataBr(s.caucao.prazoObrasAte)}; ${c.presos} lote(s) seguem caucionados.`);
    else if (c.diasPrazo !== null && c.diasPrazo <= 90) add(c.diasPrazo <= 30 ? "vermelho" : "amarelo", "garantias", "juridico", "Prazo de obras da caução", `Termo ${s.caucao.termo}: ${c.diasPrazo} dia(s) para o prazo de ${dataBr(s.caucao.prazoObrasAte)}.`);
    if (c.marcosVencidos.length) add("amarelo", "garantias", "juridico", "Liberação de caução atrasada", c.marcosVencidos.map((m) => `${m.id} ${m.descricao} (previsto ${dataBr(m.previstoEm)})`).join("; ") + ".");
  }
  if (s.diarios.length) {
    const de = new Date(Date.parse(`${e.hoje}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    for (const r of resumoVetores(s.diarios, de, e.hoje, s.limiteChuvaMm ?? 10)) {
      if (r.diasComImpacto > 7) add("amarelo", "cronograma", "canteiro", `Vetor de campo: ${VETOR_LABEL[r.vetor]}`, `${r.diasComImpacto} dia(s) com impacto nos últimos 30 (${r.diasParalisados} paralisado(s))${r.ultimaObs ? ` — ${r.ultimaObs}` : ""}.`);
    }
  }

  // Fase 3 — comercial.
  const com = s.comercial;
  for (const r of com.reservas) {
    if (statusReserva(r, e.agora) !== "ativa") continue;
    const pr = prazoReserva(r, e.agora);
    add(pr.nivel, "comercial", "comercial", `Reserva ${r.id}`, pr.mensagem);
  }
  for (const p of com.propostas) {
    if (p.credito || p.desistenciaEm) continue;
    const h = (Date.parse(e.agora) - Date.parse(p.criadaEm)) / 3_600_000;
    if (h > 48) add("amarelo", "comercial", "cfo", `Proposta ${p.id} sem análise de crédito`, `Lote ${p.loteId}: aguardando há ${Math.floor(h)} horas.`);
  }
  if (com.vendas.length) {
    const ind = indicadoresComerciais(s.lotes, com, e.hoje, e.agora);
    if (ind.inadimplencia !== null && ind.inadimplencia > 0.05) add(ind.inadimplencia > 0.1 ? "vermelho" : "amarelo", "comercial", "cfo", "Inadimplência da carteira", `${(ind.inadimplencia * 100).toFixed(1).replace(".", ",")}% do vencido está há mais de 30 dias sem pagamento.`);
  }

  return out.sort((x, y) => nivelRank(y.nivel) - nivelRank(x.nivel));
}

/** Nível geral do empreendimento: o pior alerta, ou verde. */
export const nivelGeral = (alertas: readonly Alerta[]): Nivel => alertas.reduce<Nivel>((n, a) => (nivelRank(a.nivel) > nivelRank(n) ? a.nivel : n), "verde");

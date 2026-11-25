import { DEFAULT_CALENDAR, type WorkCalendar } from "../cpm/calendar";
import { PAPEL_LABEL, slaAprovacao, statusSolicitacao, type Membro, type Papel } from "./alcadas";
import { resumoCadastro } from "./cadastro";
import { nivelRank, type Nivel } from "./common";
import { compararReforecast, prazoFechamento } from "./reforecast";
import { FRENTE_LABEL, PARAMETROS_PADRAO, processoEncerrado, relogioCartorio, relogioCertificado, relogioRet, semCheckin } from "./regulatorio";
import type { LoteadoraState } from "./state";

/** Matriz de alertas escalonados (documento, 6.1): o mesmo cálculo para o painel e para os avisos. */

export type AreaAlerta = "regulatorio" | "cartorio" | "alcadas" | "custos" | "comercial" | "cronograma";
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

/** Quem recebe cada nível: amarelo, o responsável e a diretoria técnica; vermelho, o corpo diretivo; crítico, Presidência e diretoria. */
export function papeisDoNivel(nivel: Exclude<Nivel, "verde">, responsavel: Papel): Papel[] {
  const set = new Set<Papel>([responsavel]);
  if (nivel === "amarelo") set.add("diretoria_tecnica");
  else {
    ["diretoria_tecnica", "ambiental", "cfo"].forEach((p) => set.add(p as Papel));
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
  atrasos?: readonly { atividade: string; dias: number }[];
  calendario?: WorkCalendar;
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
    const r = compararReforecast(s.etapas, s.reforecasts, e.realizadoPorAtividade ?? {}, s.vgv, s.metaMargem);
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
      add("amarelo", "custos", "cfo", `Fechamento de ${anterior} pendente`, `O reforecast de ${anterior} devia estar congelado até ${prazoFechamento(anterior, cal)}.`);
    }
  }
  const cad = resumoCadastro(s.lotes, s.trechos, s.ficha);
  if (cad.vendaSemMatricula.length > 0) add("critico", "comercial", "comercial", "Venda sem matrícula registrada", `${cad.vendaSemMatricula.length} lote(s) reservado(s) ou vendido(s) sem matrícula (trava legal do R-01): ${cad.vendaSemMatricula.slice(0, 5).join(", ")}${cad.vendaSemMatricula.length > 5 ? "…" : ""}.`);
  for (const a of e.atrasos ?? []) if (a.dias > 7) add("amarelo", "cronograma", "canteiro", `Atraso em ${a.atividade}`, `${a.dias} dias úteis de atraso.`);

  return out.sort((x, y) => nivelRank(y.nivel) - nivelRank(x.nivel));
}

/** Nível geral do empreendimento: o pior alerta, ou verde. */
export const nivelGeral = (alertas: readonly Alerta[]): Nivel => alertas.reduce<Nivel>((n, a) => (nivelRank(a.nivel) > nivelRank(n) ? a.nivel : n), "verde");

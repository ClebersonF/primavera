import { ETAPA_LABEL, PAPEIS_DA_ETAPA, statusSolicitacao, type Membro, type Papel } from "./alcadas";
import { ACAO_DO_NIVEL, type Alerta } from "./alertas";
import { dataBr, isObj, nivelRank, text, type Nivel } from "./common";
import { statusReserva } from "./comercial";
import { rncAberta } from "./qualidade";
import type { LoteadoraState } from "./state";

/**
 * Onda 4 — avisos automáticos: a rotina agendada calcula os mesmos alertas da tela, junta os gatilhos
 * por evento e decide o que enviar a quem, sem repetir. O registro do que foi enviado fica na obra.
 */

export type Canal = "email" | "whatsapp";

export interface AvisoEnviado {
  chave: string;
  nivel: Exclude<Nivel, "verde">;
  em: string;
  destinatarios: string[];
  canais: Canal[];
}

export interface AvisoPlanejado {
  chave: string;
  nivel: Exclude<Nivel, "verde">;
  titulo: string;
  detalhe: string;
  acao: string;
  destinatarios: Membro[];
}

export const MAX_AVISOS = 3000;

export function cleanAviso(v: unknown): AvisoEnviado | null {
  if (!isObj(v)) return null;
  const chave = text(v.chave, 200);
  if (!chave || !["amarelo", "vermelho", "critico"].includes(v.nivel as string) || typeof v.em !== "string" || Number.isNaN(Date.parse(v.em))) return null;
  const destinatarios = (Array.isArray(v.destinatarios) ? v.destinatarios : []).filter((x): x is string => typeof x === "string").slice(0, 30).map((x) => x.slice(0, 120));
  const canais = (Array.isArray(v.canais) ? v.canais : []).filter((x): x is Canal => x === "email" || x === "whatsapp");
  return { chave, nivel: v.nivel as AvisoEnviado["nivel"], em: v.em, destinatarios, canais };
}

/** Intervalo mínimo entre dois avisos iguais, por nível (horas). Gatilhos por evento ("evt:") saem uma vez só. */
export const REPETIR_HORAS: Record<Exclude<Nivel, "verde">, number> = { amarelo: 24 * 7, vermelho: 24, critico: 12 };

const membrosDosPapeis = (equipe: readonly Membro[], papeis: readonly Papel[]) => equipe.filter((m) => papeis.includes(m.papel));

/** Gatilhos por evento (T4): o que aconteceu e precisa avisar alguém na hora, uma vez. */
export function gatilhos(s: LoteadoraState, agoraIso: string): AvisoPlanejado[] {
  const out: AvisoPlanejado[] = [];
  const ev = (chave: string, nivel: AvisoPlanejado["nivel"], titulo: string, detalhe: string, papeis: readonly Papel[], acao: string) =>
    out.push({ chave: `evt:${chave}`, nivel, titulo, detalhe, acao, destinatarios: membrosDosPapeis(s.equipe, papeis) });
  // Decreto registrado: começa o prazo caducal do cartório.
  if (s.cartorio) ev(`decreto:${s.cartorio.decretoEm}`, "amarelo", "Prazo de 180 dias do cartório iniciado", `Decreto de ${dataBr(s.cartorio.decretoEm)}: o registro precisa sair até D+180 (meta D+120).`, ["ambiental", "presidente"], "Montar o pacote cartorário até D+20");
  // RET recebido: abre o plano de resposta.
  for (const p of s.processos) if (p.ret && !p.ret.respondidoEm) ev(`ret:${p.id}:${p.ret.emitidoEm}`, "amarelo", `RET recebido · ${p.orgao}`, `${p.assunto}: RET de ${dataBr(p.ret.emitidoEm)}, resposta em até 60 dias (petição de prorrogação em D+45).`, ["ambiental", "projetista", "diretoria_tecnica"], "Plano de resposta na reunião semanal");
  // RNC aberta: canteiro, engenharia (e o fornecedor, quando tem e-mail no cadastro).
  for (const r of s.rncs) if (rncAberta(r)) {
    const forn = r.fornecedorId ? s.fornecedores.find((f) => f.id === r.fornecedorId) : undefined;
    const extra: Membro[] = forn?.contato && /@/.test(forn.contato) ? [{ id: `forn:${forn.id}`, nome: forn.nome, email: forn.contato.match(/[^\s<>,;]+@[^\s<>,;]+/)?.[0], papel: "canteiro" }] : [];
    out.push({ chave: `evt:rnc:${r.id}`, nivel: r.gravidade === "grave" ? "vermelho" : "amarelo", titulo: `${r.id} aberta no trecho ${r.trechoId}`, detalhe: `${r.descricao}. Plano de ação em até 48 horas; a medição do trecho fica bloqueada até a validação.`, acao: "Registrar o plano de ação", destinatarios: [...membrosDosPapeis(s.equipe, ["canteiro", "diretoria_tecnica"]), ...extra] });
  }
  // Alçada aguardando etapa: quem decide aquela etapa.
  for (const sol of s.solicitacoes) {
    const st = statusSolicitacao(sol);
    if (st.status !== "pendente" || !st.proxima) continue;
    ev(`alcada:${sol.id}:${st.proxima}:${st.aguardandoDesde}`, sol.urgente ? "vermelho" : "amarelo", `Alçada ${sol.id} aguarda ${ETAPA_LABEL[st.proxima]}`, `${sol.titulo} — ${sol.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${sol.urgente ? " (urgente: 48 h)" : " (prazo: 3 dias úteis)"}.`, PAPEIS_DA_ETAPA[st.proxima], "Decidir na Central de Alçadas");
  }
  // Reserva vencida: o lote voltou ao estoque.
  for (const r of s.comercial.reservas) if (statusReserva(r, agoraIso) === "expirada") ev(`reserva:${r.id}`, "amarelo", `Reserva ${r.id} expirou`, `Lote ${r.loteId} voltou a ficar disponível (reserva de ${r.comprador.nome} sem proposta em 48 h).`, ["comercial"], "Retomar o contato ou oferecer o lote");
  // Aditivo aberto: Presidência precisa saber do impacto no reforecast.
  for (const sol of s.solicitacoes) if (sol.tipo === "aditivo" && sol.impactoReforecast !== undefined) ev(`aditivo:${sol.id}`, "amarelo", `Aditivo ${sol.id} aberto`, `${sol.titulo}: impacto de ${sol.impactoReforecast.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} no reforecast.`, ["presidente", "cfo"], "Avaliar na Central de Alçadas");
  return out;
}

/** Alertas da tela viram avisos com chave estável (área + título). */
export function avisosDeAlertas(alertas: readonly Alerta[]): AvisoPlanejado[] {
  return alertas.map((a) => ({ chave: `alerta:${a.area}:${a.titulo}`, nivel: a.nivel, titulo: a.titulo, detalhe: a.detalhe, acao: a.acao, destinatarios: a.destinatarios }));
}

/** Decide o que enviar agora: novo, piorou de nível ou passou o intervalo do nível (eventos, uma vez só). */
export function planejarAvisos(candidatos: readonly AvisoPlanejado[], log: readonly AvisoEnviado[], agoraIso: string): AvisoPlanejado[] {
  const ultimo = new Map<string, AvisoEnviado>();
  for (const a of log) {
    const u = ultimo.get(a.chave);
    if (!u || a.em > u.em) ultimo.set(a.chave, a);
  }
  const vistos = new Set<string>();
  return candidatos.filter((c) => {
    if (vistos.has(c.chave) || c.destinatarios.length === 0) return false;
    vistos.add(c.chave);
    const u = ultimo.get(c.chave);
    if (!u) return true;
    if (c.chave.startsWith("evt:")) return false;
    if (nivelRank(c.nivel) > nivelRank(u.nivel)) return true;
    return (Date.parse(agoraIso) - Date.parse(u.em)) / 3_600_000 >= REPETIR_HORAS[c.nivel];
  });
}

/** Registro do envio, com o log limitado aos mais recentes. */
export function registrarEnvios(log: readonly AvisoEnviado[], enviados: readonly { aviso: AvisoPlanejado; canais: Canal[] }[], agoraIso: string): AvisoEnviado[] {
  const novos = enviados.map((e) => ({ chave: e.aviso.chave, nivel: e.aviso.nivel, em: agoraIso, destinatarios: e.aviso.destinatarios.map((d) => d.email ?? d.telefone ?? d.nome), canais: e.canais }));
  return [...log, ...novos].slice(-MAX_AVISOS);
}

/** Texto do aviso (e-mail e WhatsApp). */
export function textoAviso(obra: string, a: AvisoPlanejado): { assunto: string; corpo: string } {
  const nivel = { amarelo: "Atenção", vermelho: "Urgente", critico: "CRÍTICO" }[a.nivel];
  return {
    assunto: `[${nivel}] ${obra} · ${a.titulo}`,
    corpo: `${a.titulo}\n${a.detalhe}\n\nO que fazer: ${a.acao}.\nObra: ${obra}\nNível: ${nivel} (${ACAO_DO_NIVEL[a.nivel]}).`,
  };
}


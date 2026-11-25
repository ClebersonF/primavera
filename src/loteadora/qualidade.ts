import { PmoError } from "../errors";
import { daysBetween, isIsoDate, isObj, nonNeg, optText, text, type Nivel } from "./common";
import { FRENTES_OBRA, type FrenteObra } from "./campo";

/**
 * Registro de Não Conformidade (documento, F5.05 e 6.1): abertura imediata, plano de ação em 48 h,
 * bloqueio da medição do trecho enquanto aberta, efeito no score do fornecedor e índice de refação.
 */

export const GRAVIDADES = ["leve", "grave"] as const;
export type Gravidade = (typeof GRAVIDADES)[number];

export interface Rnc {
  id: string;
  trechoId: string;
  frente?: FrenteObra;
  fornecedorId?: string;
  descricao: string;
  gravidade: Gravidade;
  /** ISO com hora. */
  abertaEm: string;
  abertaPor: string;
  plano?: { texto: string; em: string; por: string };
  /** Correção executada em campo. */
  corrigidaEm?: string;
  /** Validação da correção pela diretoria técnica: encerra a RNC e libera a medição. */
  validadaEm?: string;
  validadaPor?: string;
  /** Custo da refação (R$), para o índice de refação. */
  custoRefacao?: number;
}

export type StatusRnc = "aberta" | "com_plano" | "corrigida" | "encerrada";
export const STATUS_RNC_LABEL: Record<StatusRnc, string> = { aberta: "Aberta, sem plano", com_plano: "Com plano de ação", corrigida: "Corrigida, aguardando validação", encerrada: "Encerrada" };

export const MAX_RNCS = 1000;

export function statusRnc(r: Rnc): StatusRnc {
  if (r.validadaEm) return "encerrada";
  if (r.corrigidaEm) return "corrigida";
  if (r.plano) return "com_plano";
  return "aberta";
}

/** Aberta para efeito de trava: tudo o que ainda não foi validado. */
export const rncAberta = (r: Rnc) => !r.validadaEm;

export function rncsAbertasNoTrecho(lista: readonly Rnc[], trechoId: string, frente?: FrenteObra): number {
  return lista.filter((r) => rncAberta(r) && r.trechoId === trechoId && (frente === undefined || r.frente === undefined || r.frente === frente)).length;
}

const validIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function cleanRnc(v: unknown): Rnc | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), trechoId = text(v.trechoId, 40), descricao = text(v.descricao, 2000), abertaPor = text(v.abertaPor, 100);
  if (!id || !trechoId || !descricao || !abertaPor || !validIso(v.abertaEm)) return null;
  if (!(GRAVIDADES as readonly unknown[]).includes(v.gravidade)) return null;
  const r: Rnc = { id, trechoId, descricao, gravidade: v.gravidade as Gravidade, abertaEm: v.abertaEm, abertaPor };
  if ((FRENTES_OBRA as readonly unknown[]).includes(v.frente)) r.frente = v.frente as FrenteObra;
  const forn = optText(v.fornecedorId, 40);
  if (forn) r.fornecedorId = forn;
  if (isObj(v.plano)) {
    const t = text(v.plano.texto, 2000), por = text(v.plano.por, 100);
    if (t && por && validIso(v.plano.em)) r.plano = { texto: t, em: v.plano.em, por };
  }
  if (isIsoDate(v.corrigidaEm)) r.corrigidaEm = v.corrigidaEm;
  if (isIsoDate(v.validadaEm)) {
    r.validadaEm = v.validadaEm;
    r.validadaPor = optText(v.validadaPor, 100) ?? "—";
  }
  if (nonNeg(v.custoRefacao)) r.custoRefacao = v.custoRefacao;
  return r;
}

export function nextRncId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, "")) || 0), 0);
  return `RNC-${String(n + 1).padStart(3, "0")}`;
}

export function abrirRnc(p: { id: string; trechoId: string; frente?: FrenteObra; fornecedorId?: string; descricao: string; gravidade: Gravidade; abertaEm: string; abertaPor: string }): Rnc {
  const r = cleanRnc(p);
  if (!r) throw new PmoError("RNC inválida: trecho, descrição, gravidade e responsável são obrigatórios.");
  return r;
}

export function registrarPlano(r: Rnc, textoPlano: string, por: string, emIso: string): Rnc {
  if (r.validadaEm) throw new PmoError("RNC encerrada.");
  const t = textoPlano.trim();
  if (t.length < 10) throw new PmoError("Descreva o plano de ação (o que, quem e quando).");
  if (Date.parse(emIso) < Date.parse(r.abertaEm)) throw new PmoError("O plano não pode ser anterior à abertura.");
  return { ...r, plano: { texto: t.slice(0, 2000), em: emIso, por: por.trim().slice(0, 100) || "—" } };
}

export function registrarCorrecao(r: Rnc, em: string, custoRefacao?: number): Rnc {
  if (!r.plano) throw new PmoError("Registre o plano de ação antes da correção.");
  if (r.validadaEm) throw new PmoError("RNC encerrada.");
  if (!isIsoDate(em) || em < r.abertaEm.slice(0, 10)) throw new PmoError("Data da correção inválida.");
  if (custoRefacao !== undefined && !nonNeg(custoRefacao)) throw new PmoError("Custo da refação inválido.");
  return { ...r, corrigidaEm: em, ...(custoRefacao !== undefined ? { custoRefacao } : {}) };
}

/** Só a diretoria técnica valida (o bloqueio da medição cai aqui). */
export function validarCorrecao(r: Rnc, em: string, por: string): Rnc {
  if (!r.corrigidaEm) throw new PmoError("A correção ainda não foi registrada.");
  if (r.validadaEm) throw new PmoError("RNC já encerrada.");
  if (!isIsoDate(em) || em < r.corrigidaEm) throw new PmoError("A validação não pode ser antes da correção.");
  return { ...r, validadaEm: em, validadaPor: por.trim().slice(0, 100) || "—" };
}

/** Plano devido em 48 h; aberta há mais de 7 dias fere a meta "zero RNC > 7d". */
export function prazoRnc(r: Rnc, agoraIso: string): { nivel: Nivel; mensagem: string; horasSemPlano: number | null; dias: number } {
  const dias = daysBetween(r.abertaEm.slice(0, 10), agoraIso.slice(0, 10));
  if (r.validadaEm) return { nivel: "verde", mensagem: "Encerrada.", horasSemPlano: null, dias };
  const horas = r.plano ? null : Math.floor((Date.parse(agoraIso) - Date.parse(r.abertaEm)) / 3_600_000);
  if (horas !== null && horas > 48) return { nivel: "vermelho", mensagem: `Sem plano de ação há ${horas} horas (limite 48 h).`, horasSemPlano: horas, dias };
  if (dias > 7) return { nivel: r.gravidade === "grave" ? "vermelho" : "amarelo", mensagem: `Aberta há ${dias} dias (meta: nenhuma RNC com mais de 7 dias).`, horasSemPlano: horas, dias };
  return { nivel: "verde", mensagem: horas !== null ? `Plano devido em ${48 - horas} horas.` : `Aberta há ${dias} dia(s).`, horasSemPlano: horas, dias };
}

/** Índice de refação = custo de retrabalho ÷ custo direto × 100 (meta < 1,5%). */
export function indiceRefacao(lista: readonly Rnc[], custoDireto: number): number | null {
  if (!(custoDireto > 0)) return null;
  const soma = lista.reduce((s, r) => s + (r.custoRefacao ?? 0), 0);
  return (soma / custoDireto) * 100;
}

import { PmoError } from "../errors";
import { aplicarAvancos, marcarChecklist, type DiarioObra, type FrenteObra } from "./campo";
import { nextRncId, type Rnc } from "./qualidade";
import type { LoteadoraState } from "./state";
import type { Autor } from "./trilha";

/**
 * Onda 5 — campo sem sinal (gap 3.5). Diário, RNC e checklist gravados sem conexão ficam numa fila no
 * aparelho como operações serializáveis; ao voltar a conexão, cada uma é reaplicada sobre o estado atual
 * do servidor. Quando o servidor mudou no meio tempo de um jeito que a operação não cabe mais, ela vira
 * conflito (explicado em português) e não sobrescreve o trabalho de ninguém.
 */

export type OperacaoCampo =
  | { tipo: "diario"; diario: DiarioObra }
  | { tipo: "rnc"; rnc: Rnc }
  | { tipo: "checklist"; trechoId: string; frente: FrenteObra; indice: number; item: string; ok: boolean; por: string; em: string };

export interface ItemFila {
  id: string;
  /** Id da obra (Work.id) a que a operação pertence. */
  obra: string;
  criadoEm: string;
  autor: Autor;
  op: OperacaoCampo;
}

const hora = (iso: string) => iso.slice(11, 16);
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function descreverOperacao(op: OperacaoCampo): string {
  if (op.tipo === "diario") return `Diário de ${dataBr(op.diario.data)}`;
  if (op.tipo === "rnc") return `RNC no trecho ${op.rnc.trechoId}: ${op.rnc.descricao.slice(0, 60)}`;
  return `Checklist ${op.trechoId} · ${op.item}: ${op.ok ? "feito" : "desmarcado"}`;
}

/** Motivo pelo qual a operação não pode mais ser aplicada sobre `s` (null quando pode). */
export function conflitoOperacao(s: LoteadoraState, item: ItemFila): string | null {
  const op = item.op;
  if (op.tipo === "diario") {
    const ja = s.diarios.find((d) => d.data === op.diario.data);
    if (ja && ja.por !== op.diario.por && ja.registradoEm > item.criadoEm)
      return `${descreverOperacao(op)} já foi gravado por ${ja.por} às ${hora(ja.registradoEm)}, depois do seu registro sem sinal. Confira e complemente o diário dele.`;
    return null;
  }
  if (op.tipo === "checklist") {
    const fr = s.frentes.find((f) => f.trechoId === op.trechoId && f.frente === op.frente);
    if (fr?.concluidaEm) return `${descreverOperacao(op)}: a frente foi concluída enquanto você estava sem sinal.`;
    const c = fr?.checklist[op.indice];
    if (fr && (!c || c.item !== op.item)) return `${descreverOperacao(op)}: o checklist da frente mudou e o item não confere mais.`;
    return null;
  }
  return null;
}

/** Aplica a operação; lança PmoError com o motivo quando há conflito. */
export function aplicarOperacao(s: LoteadoraState, item: ItemFila): LoteadoraState {
  const motivo = conflitoOperacao(s, item);
  if (motivo) throw new PmoError(motivo);
  const op = item.op;
  if (op.tipo === "diario") {
    const d = op.diario;
    return { ...s, diarios: [...s.diarios.filter((x) => x.data !== d.data), d], frentes: aplicarAvancos(s.frentes, d) };
  }
  if (op.tipo === "rnc") return { ...s, rncs: [...s.rncs, { ...op.rnc, id: nextRncId(s.rncs) }] };
  const fr = s.frentes.find((f) => f.trechoId === op.trechoId && f.frente === op.frente);
  if (fr?.checklist[op.indice]?.ok === op.ok) return s; // já está como o campo marcou
  return { ...s, frentes: marcarChecklist(s.frentes, op.trechoId, op.frente, op.indice, op.ok, op.por, op.em) };
}

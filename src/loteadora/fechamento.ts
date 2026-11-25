import { PmoError } from "../errors";
import { addDays, dataBr, isIsoDate, isObj, text, type Nivel } from "./common";
import type { DiarioObra } from "./campo";
import { isQuinzena, quinzenaDe, type Boletim } from "./medicao";

/**
 * Cadência quinzenal (documento, 3.3): nos dias 15 e 30 a quinzena é fechada e o período fica bloqueado.
 * Depois do fechamento, diários e boletins com data até o fim da quinzena não mudam mais
 * (o boletim ainda avança no financeiro: liberação e pagamento).
 */
export interface Fechamento {
  /** Fim da quinzena fechada (dia 15 ou último dia do mês). */
  quinzena: string;
  fechadoEm: string;
  por: string;
}

export const MAX_FECHAMENTOS = 200;

export function cleanFechamento(v: unknown): Fechamento | null {
  if (!isObj(v) || !isQuinzena(v.quinzena) || typeof v.fechadoEm !== "string" || Number.isNaN(Date.parse(v.fechadoEm))) return null;
  const por = text(v.por, 100);
  return por ? { quinzena: v.quinzena, fechadoEm: v.fechadoEm, por } : null;
}

/** Último dia bloqueado (fim da quinzena fechada mais recente), ou null. */
export function periodoBloqueadoAte(lista: readonly Fechamento[]): string | null {
  return lista.reduce<string | null>((m, f) => (m === null || f.quinzena > m ? f.quinzena : m), null);
}

/** O que impede fechar a quinzena: boletins da quinzena ainda no campo ou na conferência. */
export function pendenciasFechamento(quinzena: string, boletins: readonly Boletim[]): string[] {
  return boletins
    .filter((b) => b.quinzena === quinzena && (b.status === "rascunho" || b.status === "enviado" || b.status === "devolvido"))
    .map((b) => `${b.id} (${b.trechoId}) ainda ${b.status === "enviado" ? "em conferência" : "no campo"}`);
}

export function fecharQuinzena(lista: readonly Fechamento[], quinzena: string, boletins: readonly Boletim[], por: string, agoraIso: string): Fechamento[] {
  if (!isQuinzena(quinzena)) throw new PmoError("Escolha o fim de uma quinzena (dia 15 ou último dia do mês).");
  if (quinzena >= agoraIso.slice(0, 10)) throw new PmoError("A quinzena ainda não terminou.");
  if (lista.some((f) => f.quinzena === quinzena)) throw new PmoError(`A quinzena de ${dataBr(quinzena)} já está fechada.`);
  const ate = periodoBloqueadoAte(lista);
  if (ate && quinzena < ate) throw new PmoError(`Já há fechamento posterior (${dataBr(ate)}).`);
  const p = pendenciasFechamento(quinzena, boletins);
  if (p.length) throw new PmoError(`Antes de fechar: ${p.join("; ")}.`);
  return [...lista, { quinzena, fechadoEm: agoraIso, por: por.trim().slice(0, 100) || "—" }];
}

/** Próxima quinzena a fechar (a última encerrada antes de hoje) e o nível do atraso (D+3 = prazo da conferência). */
export function quinzenaAFechar(lista: readonly Fechamento[], hoje: string): { quinzena: string; nivel: Nivel; mensagem: string } | null {
  // Fim da quinzena anterior à atual.
  const atual = quinzenaDe(hoje);
  const inicioAtual = atual.slice(8) === "15" ? `${atual.slice(0, 8)}01` : `${atual.slice(0, 8)}16`;
  const anterior = addDays(inicioAtual, -1);
  if (lista.some((f) => f.quinzena >= anterior)) return null;
  const atraso = Math.round((Date.parse(hoje) - Date.parse(addDays(anterior, 3))) / 86_400_000);
  return atraso > 0
    ? { quinzena: anterior, nivel: atraso > 7 ? "vermelho" : "amarelo", mensagem: `Quinzena de ${dataBr(anterior)} sem fechamento há ${atraso} dia(s) além do prazo (D+3).` }
    : { quinzena: anterior, nivel: "verde", mensagem: `Fechar a quinzena de ${dataBr(anterior)} até ${dataBr(addDays(anterior, 3))}.` };
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Campos do boletim que continuam mudando depois do fechamento (o financeiro). */
const conteudoBoletim = (b: Boletim) => ({ fornecedorId: b.fornecedorId, trechoId: b.trechoId, frente: b.frente, quinzena: b.quinzena, itens: b.itens, fotoIds: b.fotoIds, saldoContrato: b.saldoContrato, conferido: b.conferido });

/** Mudanças que ferem o período fechado (null = nenhuma). Usado ao gravar o estado. */
export function violacaoFechamento(ate: string | null, antes: { diarios: readonly DiarioObra[]; boletins: readonly Boletim[] }, depois: { diarios: readonly DiarioObra[]; boletins: readonly Boletim[] }): string | null {
  if (!ate || !isIsoDate(ate)) return null;
  const da = new Map(antes.diarios.map((d) => [d.data, d]));
  const dd = new Map(depois.diarios.map((d) => [d.data, d]));
  for (const k of new Set([...da.keys(), ...dd.keys()])) if (k <= ate && !igual(da.get(k), dd.get(k))) return `O diário de ${dataBr(k)} está num período fechado (até ${dataBr(ate)}).`;
  const ba = new Map(antes.boletins.map((b) => [b.id, b]));
  for (const b of depois.boletins) {
    const o = ba.get(b.id);
    if (b.quinzena > ate) continue;
    if (!o) return `A quinzena de ${dataBr(b.quinzena)} está fechada: não aceita boletim novo.`;
    if (!igual(conteudoBoletim(o), conteudoBoletim(b))) return `${b.id} é de quinzena fechada: só o financeiro avança.`;
  }
  for (const o of antes.boletins) if (o.quinzena <= ate && !depois.boletins.some((b) => b.id === o.id)) return `${o.id} é de quinzena fechada e não pode ser removido.`;
  return null;
}

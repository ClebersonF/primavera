import { DEFAULT_CALENDAR, workDaysBetween, type WorkCalendar } from "../cpm/calendar";
import { PmoError } from "../errors";
import { addDays, isIsoDate, isObj, nonNeg, optText, text, type Nivel } from "./common";
import { FRENTES_OBRA, FRENTE_OBRA_LABEL, type FrenteObra } from "./campo";

/**
 * Boletim de medição quinzenal por rua/trecho (documento, F5.01 a F5.04):
 * campo (dias 15 e 30, D+1) → conferência técnica (até 2 d.u., bloqueada com RNC aberta no trecho)
 * → aditivo pela Presidência quando passa do contrato → conferência fiscal/SST e retenção → pagamento.
 */

export interface ItemMedicao {
  descricao: string;
  unidade: string;
  quantidade: number;
  precoUnit: number;
}

export const STATUS_BOLETIM = ["rascunho", "enviado", "conferido", "devolvido", "liberado", "pago"] as const;
export type StatusBoletim = (typeof STATUS_BOLETIM)[number];
export const STATUS_BOLETIM_LABEL: Record<StatusBoletim, string> = {
  rascunho: "Rascunho", enviado: "Aguardando conferência técnica", conferido: "Conferido, aguardando financeiro", devolvido: "Devolvido ao campo", liberado: "Liberado para pagamento", pago: "Pago",
};

export interface Boletim {
  id: string;
  fornecedorId: string;
  trechoId: string;
  frente: FrenteObra;
  /** Atividade do cronograma: o pagamento entra no realizado dela. */
  atividadeId?: string;
  /** Fim da quinzena medida: dia 15 ou último dia do mês. */
  quinzena: string;
  itens: ItemMedicao[];
  /** Fotos do diário que comprovam o avanço (ids). */
  fotoIds: string[];
  /** Saldo do contrato antes deste boletim (R$); acima dele exige aditivo aprovado. */
  saldoContrato?: number;
  /** Solicitação de aditivo (Central de Alçadas) que cobre o excesso. */
  aditivoId?: string;
  status: StatusBoletim;
  criadoPor: string;
  enviadoEm?: string;
  conferido?: { por: string; em: string; nota?: string };
  devolucao?: { por: string; em: string; motivo: string };
  financeiro?: { nfNumero: string; nfEm: string; fiscalOk: boolean; sstOk: boolean; retencaoPct: number; por: string; em: string };
  pagoEm?: string;
}

export const MAX_BOLETINS = 2000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function valorBoletim(b: Pick<Boletim, "itens">): number {
  return r2(b.itens.reduce((s, i) => s + i.quantidade * i.precoUnit, 0));
}

export function retencaoBoletim(b: Boletim): number {
  return b.financeiro ? r2((valorBoletim(b) * b.financeiro.retencaoPct) / 100) : 0;
}

export const liquidoBoletim = (b: Boletim) => r2(valorBoletim(b) - retencaoBoletim(b));

/** Fim de quinzena válido: dia 15 ou o último dia do mês. */
export function isQuinzena(d: unknown): d is string {
  if (!isIsoDate(d)) return false;
  return d.slice(8) === "15" || addDays(d, 1).slice(8) === "01";
}

/** Quinzena em que a data cai (fim dela). */
export function quinzenaDe(data: string): string {
  if (Number(data.slice(8)) <= 15) return `${data.slice(0, 8)}15`;
  let d = data;
  while (addDays(d, 1).slice(8) !== "01") d = addDays(d, 1);
  return d;
}

const validIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function cleanBoletim(v: unknown): Boletim | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), fornecedorId = text(v.fornecedorId, 40), trechoId = text(v.trechoId, 40), criadoPor = text(v.criadoPor, 100);
  if (!id || !fornecedorId || !trechoId || !criadoPor || !isQuinzena(v.quinzena)) return null;
  if (!(FRENTES_OBRA as readonly unknown[]).includes(v.frente) || !(STATUS_BOLETIM as readonly unknown[]).includes(v.status)) return null;
  const itens = (Array.isArray(v.itens) ? v.itens : []).flatMap((i): ItemMedicao[] => {
    if (!isObj(i)) return [];
    const descricao = text(i.descricao, 200), unidade = text(i.unidade, 10);
    if (!descricao || !unidade || !nonNeg(i.quantidade) || !nonNeg(i.precoUnit)) return [];
    return [{ descricao, unidade, quantidade: i.quantidade, precoUnit: i.precoUnit }];
  });
  const b: Boletim = {
    id, fornecedorId, trechoId, frente: v.frente as FrenteObra, quinzena: v.quinzena, itens,
    fotoIds: (Array.isArray(v.fotoIds) ? v.fotoIds : []).filter((x): x is string => typeof x === "string" && x.length <= 60).slice(0, 40),
    status: v.status as StatusBoletim, criadoPor,
  };
  const at = optText(v.atividadeId, 60);
  if (at) b.atividadeId = at;
  if (nonNeg(v.saldoContrato)) b.saldoContrato = v.saldoContrato;
  const ad = optText(v.aditivoId, 20);
  if (ad) b.aditivoId = ad;
  if (validIso(v.enviadoEm)) b.enviadoEm = v.enviadoEm;
  if (isObj(v.conferido) && validIso(v.conferido.em) && text(v.conferido.por, 100)) b.conferido = { por: text(v.conferido.por, 100)!, em: v.conferido.em, ...(optText(v.conferido.nota, 500) ? { nota: optText(v.conferido.nota, 500) } : {}) };
  if (isObj(v.devolucao) && validIso(v.devolucao.em) && text(v.devolucao.por, 100) && text(v.devolucao.motivo, 500)) b.devolucao = { por: text(v.devolucao.por, 100)!, em: v.devolucao.em, motivo: text(v.devolucao.motivo, 500)! };
  if (isObj(v.financeiro)) {
    const f = v.financeiro;
    const nf = text(f.nfNumero, 40), por = text(f.por, 100);
    if (nf && por && isIsoDate(f.nfEm) && validIso(f.em) && typeof f.fiscalOk === "boolean" && typeof f.sstOk === "boolean" && nonNeg(f.retencaoPct) && f.retencaoPct <= 30) {
      b.financeiro = { nfNumero: nf, nfEm: f.nfEm, fiscalOk: f.fiscalOk, sstOk: f.sstOk, retencaoPct: f.retencaoPct, por, em: f.em };
    }
  }
  if (isIsoDate(v.pagoEm)) b.pagoEm = v.pagoEm;
  return b;
}

export function nextBoletimId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, "")) || 0), 0);
  return `BM-${String(n + 1).padStart(3, "0")}`;
}

export function novoBoletim(p: { id: string; fornecedorId: string; trechoId: string; frente: FrenteObra; quinzena: string; criadoPor: string; atividadeId?: string; saldoContrato?: number }): Boletim {
  const b = cleanBoletim({ ...p, itens: [], fotoIds: [], status: "rascunho" });
  if (!b) throw new PmoError("Boletim inválido: fornecedor, trecho, frente e quinzena (dia 15 ou último dia do mês) são obrigatórios.");
  return b;
}

/** Excede o saldo do contrato? Então só segue com aditivo aprovado na Central de Alçadas. */
export const excedeContrato = (b: Boletim) => b.saldoContrato !== undefined && valorBoletim(b) > b.saldoContrato + 0.005;

export function enviarBoletim(b: Boletim, emIso: string): Boletim {
  if (b.status !== "rascunho" && b.status !== "devolvido") throw new PmoError("Só rascunho ou boletim devolvido pode ser enviado.");
  if (b.itens.length === 0) throw new PmoError("Inclua ao menos um item medido.");
  if (b.fotoIds.length === 0) throw new PmoError("Vincule ao menos uma foto do diário de obra (regra F5.01).");
  return { ...b, status: "enviado", enviadoEm: emIso };
}

export interface ContextoConferencia {
  /** RNC abertas no trecho/frente do boletim. */
  rncAbertas: number;
  /** O aditivo citado está aprovado na Central de Alçadas? */
  aditivoAprovado?: boolean;
}

/** Conferência técnica: bloqueio automático com RNC aberta no trecho e excesso sem aditivo aprovado. */
export function travasConferencia(b: Boletim, c: ContextoConferencia): string[] {
  const t: string[] = [];
  if (c.rncAbertas > 0) t.push(`${c.rncAbertas} RNC aberta(s) no trecho ${b.trechoId}: medição bloqueada até a validação da correção`);
  if (excedeContrato(b) && !(b.aditivoId && c.aditivoAprovado)) t.push("Valor acima do saldo do contrato: exige aditivo aprovado pela Presidência");
  return t;
}

export function conferirBoletim(b: Boletim, c: ContextoConferencia, por: string, emIso: string, nota?: string): Boletim {
  if (b.status !== "enviado") throw new PmoError("O boletim não está aguardando conferência.");
  const t = travasConferencia(b, c);
  if (t.length) throw new PmoError(t.join(". ") + ".");
  return { ...b, status: "conferido", conferido: { por: por.trim().slice(0, 100) || "—", em: emIso, ...(nota?.trim() ? { nota: nota.trim().slice(0, 500) } : {}) } };
}

export function devolverBoletim(b: Boletim, por: string, emIso: string, motivo: string): Boletim {
  if (b.status !== "enviado" && b.status !== "conferido") throw new PmoError("Só boletim em conferência pode ser devolvido.");
  if (motivo.trim().length < 5) throw new PmoError("Informe o motivo da devolução.");
  const { conferido: _c, ...resto } = b;
  void _c;
  return { ...resto, status: "devolvido", devolucao: { por: por.trim().slice(0, 100) || "—", em: emIso, motivo: motivo.trim().slice(0, 500) } };
}

/** Conferência fiscal/SST e retenção técnica (CFO). Sem as duas conferências, não libera. */
export function liberarPagamento(b: Boletim, f: { nfNumero: string; nfEm: string; fiscalOk: boolean; sstOk: boolean; retencaoPct: number }, por: string, emIso: string): Boletim {
  if (b.status !== "conferido") throw new PmoError("O boletim precisa da conferência técnica antes do financeiro.");
  if (!f.nfNumero.trim() || !isIsoDate(f.nfEm)) throw new PmoError("Informe o número e a data da nota fiscal.");
  if (!f.fiscalOk) throw new PmoError("Conferência fiscal pendente.");
  if (!f.sstOk) throw new PmoError("Regularidade trabalhista/SST pendente: não libera o pagamento.");
  if (!(f.retencaoPct >= 0 && f.retencaoPct <= 30)) throw new PmoError("Retenção técnica deve ficar entre 0% e 30%.");
  return { ...b, status: "liberado", financeiro: { ...f, nfNumero: f.nfNumero.trim().slice(0, 40), por: por.trim().slice(0, 100) || "—", em: emIso } };
}

export function pagarBoletim(b: Boletim, em: string): Boletim {
  if (b.status !== "liberado" || !b.financeiro) throw new PmoError("O boletim não está liberado para pagamento.");
  if (!isIsoDate(em) || em < b.financeiro.nfEm) throw new PmoError("Data de pagamento inválida (antes da nota fiscal).");
  return { ...b, status: "pago", pagoEm: em };
}

/** Prazo da etapa em que o boletim está: envio D+1, conferência 2 d.u., pagamento até 10 d.u. pós-NF. */
export function prazoBoletim(b: Boletim, hoje: string, cal: WorkCalendar = DEFAULT_CALENDAR): { nivel: Nivel; mensagem: string } {
  if (b.status === "pago") return { nivel: "verde", mensagem: `Pago em ${b.pagoEm}.` };
  if (b.status === "rascunho" || b.status === "devolvido") {
    const limite = addDays(b.quinzena, 1);
    return hoje > limite ? { nivel: "amarelo", mensagem: `Envio do campo vencido em ${limite} (D+1 da quinzena).` } : { nivel: "verde", mensagem: `Enviar até ${limite}.` };
  }
  if (b.status === "enviado") {
    const du = workDaysBetween(b.enviadoEm!.slice(0, 10), hoje, cal);
    return du > 2 ? { nivel: "amarelo", mensagem: `Conferência técnica há ${du} dias úteis (limite 2).` } : { nivel: "verde", mensagem: `Em conferência há ${du} dia(s) útil(eis).` };
  }
  if (b.status === "liberado" && b.financeiro) {
    const du = workDaysBetween(b.financeiro.nfEm, hoje, cal);
    return du > 10 ? { nivel: "vermelho", mensagem: `Pagamento atrasado: ${du} dias úteis após a NF (limite 10).` } : { nivel: "verde", mensagem: `${du} dia(s) útil(eis) após a NF.` };
  }
  return { nivel: "verde", mensagem: STATUS_BOLETIM_LABEL[b.status] + "." };
}

/** Realizado por atividade a partir das medições pagas (valor bruto: a retenção também é custo). */
export function realizadoMedicoes(lista: readonly Boletim[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of lista) if (b.status === "pago" && b.atividadeId) out[b.atividadeId] = r2((out[b.atividadeId] ?? 0) + valorBoletim(b));
  return out;
}

export const rotuloBoletim = (b: Boletim) => `${b.id} · ${b.trechoId} · ${FRENTE_OBRA_LABEL[b.frente].slice(4)} · quinzena ${b.quinzena}`;

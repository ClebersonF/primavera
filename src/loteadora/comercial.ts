import { PmoError } from "../errors";
import { isValidCnpj } from "../tax/cnpj";
import { daysBetween, isIsoDate, isObj, nonNeg, optText, text, type Nivel } from "./common";
import type { Lote } from "./cadastro";
import type { Cartorio } from "./regulatorio";
import { travaCaucao, type Caucao } from "./garantias";

/**
 * Fase 3 — comercial (documento, F6.01 a F6.07): tabela de vendas com trava legal do R-01,
 * reserva de 48 h ligada a CPF/CNPJ, proposta com análise de crédito e exceção de tabela pela
 * Presidência, compromisso de compra e venda com baixa da entrada, carteira, VSO, breakeven,
 * inadimplência e entrega do lote com termo assinado.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const validIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/* ---------------------------------- Documento ---------------------------------- */

export function isValidCpf(v: string): boolean {
  const d = v.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export const docValido = (v: string) => isValidCpf(v) || isValidCnpj(v);

export interface Comprador {
  /** CPF ou CNPJ, só dígitos. */
  doc: string;
  nome: string;
  contato?: string;
}

function cleanComprador(v: unknown): Comprador | null {
  if (!isObj(v)) return null;
  const doc = typeof v.doc === "string" ? v.doc.replace(/\D/g, "") : "";
  const nome = text(v.nome, 160);
  if (!docValido(doc) || !nome) return null;
  const contato = optText(v.contato, 160);
  return { doc, nome, ...(contato ? { contato } : {}) };
}

/** CPF/CNPJ mascarado para telas e listas (***.456.789-** ). */
export function docMascarado(doc: string): string {
  return doc.length === 11 ? `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**` : `**.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-**`;
}

/* ------------------------------- Tabela de vendas ------------------------------- */

export interface TabelaVendas {
  publicadaEm: string;
  publicadaPor: string;
  /** Preço base por m² (R$). */
  precoM2: number;
  /** Ajuste por quadra (fração: 0,1 = +10%). */
  ajusteQuadra: Record<string, number>;
  /** Preço fechado por lote, quando houver (sobrepõe o cálculo). */
  precoLote: Record<string, number>;
  /** Entrada mínima (fração do preço). */
  entradaMin: number;
  parcelasMax: number;
  /** Juros ao mês (fração) para o financiamento direto. */
  jurosMes: number;
}

export function cleanTabela(v: unknown): TabelaVendas | null {
  if (!isObj(v)) return null;
  const por = text(v.publicadaPor, 100);
  if (!isIsoDate(v.publicadaEm) || !por || !nonNeg(v.precoM2) || v.precoM2 <= 0) return null;
  if (!nonNeg(v.entradaMin) || v.entradaMin > 1 || !nonNeg(v.parcelasMax) || !Number.isInteger(v.parcelasMax) || v.parcelasMax > 360 || !nonNeg(v.jurosMes) || v.jurosMes > 0.1) return null;
  const ajusteQuadra: Record<string, number> = {};
  if (isObj(v.ajusteQuadra)) for (const [q, a] of Object.entries(v.ajusteQuadra)) if (typeof a === "number" && a > -1 && a < 5 && q.length <= 10) ajusteQuadra[q.toUpperCase()] = a;
  const precoLote: Record<string, number> = {};
  if (isObj(v.precoLote)) for (const [l, p] of Object.entries(v.precoLote)) if (nonNeg(p) && p > 0 && l.length <= 20) precoLote[l] = p;
  return { publicadaEm: v.publicadaEm, publicadaPor: por, precoM2: v.precoM2, ajusteQuadra, precoLote, entradaMin: v.entradaMin, parcelasMax: v.parcelasMax, jurosMes: v.jurosMes };
}

export function precoTabela(lote: Lote, t: TabelaVendas): number {
  if (Object.prototype.hasOwnProperty.call(t.precoLote, lote.id)) return t.precoLote[lote.id]!;
  return r2(lote.areaM2 * t.precoM2 * (1 + (t.ajusteQuadra[lote.quadra.toUpperCase()] ?? 0)));
}

/** Trava legal (F6.01): sem registro do loteamento (R-01) e matrícula do lote, não reserva nem vende. */
export function travaR01(lote: Lote, cartorio?: Cartorio): string | null {
  if (!cartorio?.registradoEm) return "Loteamento sem registro em cartório (R-01): venda proibida (Lei 6.766, art. 37)";
  if (!lote.matricula) return `Lote ${lote.id} sem matrícula individualizada`;
  return null;
}

/* ----------------------------------- Reservas ----------------------------------- */

export interface Reserva {
  id: string;
  loteId: string;
  comprador: Comprador;
  corretor: string;
  criadaEm: string;
  /** criadaEm + 48 h (ISO). */
  expiraEm: string;
  canceladaEm?: string;
  /** Proposta que nasceu da reserva (congela a expiração enquanto em análise). */
  propostaId?: string;
}

export const RESERVA_HORAS = 48;
export const MAX_RESERVAS = 5000;

export function cleanReserva(v: unknown): Reserva | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), loteId = text(v.loteId, 20), corretor = text(v.corretor, 100);
  const comprador = cleanComprador(v.comprador);
  if (!id || !loteId || !corretor || !comprador || !validIso(v.criadaEm) || !validIso(v.expiraEm)) return null;
  const r: Reserva = { id, loteId, comprador, corretor, criadaEm: v.criadaEm, expiraEm: v.expiraEm };
  if (validIso(v.canceladaEm)) r.canceladaEm = v.canceladaEm;
  const p = optText(v.propostaId, 20);
  if (p) r.propostaId = p;
  return r;
}

export type StatusReserva = "ativa" | "em_proposta" | "expirada" | "cancelada";
export function statusReserva(r: Reserva, agoraIso: string): StatusReserva {
  if (r.canceladaEm) return "cancelada";
  if (r.propostaId) return "em_proposta";
  return Date.parse(agoraIso) > Date.parse(r.expiraEm) ? "expirada" : "ativa";
}

const nextId = (prefixo: string, list: readonly { id: string }[], casas = 4) =>
  `${prefixo}-${String(list.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, "")) || 0), 0) + 1).padStart(casas, "0")}`;
export const nextReservaId = (l: readonly { id: string }[]) => nextId("RS", l);
export const nextPropostaId = (l: readonly { id: string }[]) => nextId("PP", l);
export const nextVendaId = (l: readonly { id: string }[]) => nextId("CV", l);

/* ----------------------------------- Propostas ----------------------------------- */

export interface PropostaVenda {
  id: string;
  reservaId: string;
  loteId: string;
  comprador: Comprador;
  valorTabela: number;
  valor: number;
  entrada: number;
  parcelas: number;
  criadaEm: string;
  criadaPor: string;
  credito?: { aprovado: boolean; por: string; em: string; nota?: string };
  /** v1.1 (F6.03) — dupla chancela: análise documental do comprador e minuta pelo Jurídico. */
  chancelaJuridica?: { aprovado: boolean; por: string; em: string; nota?: string };
  /** Alçada de exceção de tabela (Presidência), quando a proposta foge da tabela. */
  solicitacaoId?: string;
  desistenciaEm?: string;
}

export const MAX_PROPOSTAS = 5000;

export function cleanProposta(v: unknown): PropostaVenda | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), reservaId = text(v.reservaId, 20), loteId = text(v.loteId, 20), criadaPor = text(v.criadaPor, 100);
  const comprador = cleanComprador(v.comprador);
  if (!id || !reservaId || !loteId || !criadaPor || !comprador || !validIso(v.criadaEm)) return null;
  if (!nonNeg(v.valorTabela) || !nonNeg(v.valor) || v.valor <= 0 || !nonNeg(v.entrada) || v.entrada > v.valor || !nonNeg(v.parcelas) || !Number.isInteger(v.parcelas) || v.parcelas > 360) return null;
  const p: PropostaVenda = { id, reservaId, loteId, comprador, valorTabela: v.valorTabela, valor: v.valor, entrada: v.entrada, parcelas: v.parcelas, criadaEm: v.criadaEm, criadaPor };
  if (isObj(v.credito) && typeof v.credito.aprovado === "boolean" && text(v.credito.por, 100) && validIso(v.credito.em)) {
    p.credito = { aprovado: v.credito.aprovado, por: text(v.credito.por, 100)!, em: v.credito.em, ...(optText(v.credito.nota, 500) ? { nota: optText(v.credito.nota, 500) } : {}) };
  }
  if (isObj(v.chancelaJuridica) && typeof v.chancelaJuridica.aprovado === "boolean" && text(v.chancelaJuridica.por, 100) && validIso(v.chancelaJuridica.em)) {
    p.chancelaJuridica = { aprovado: v.chancelaJuridica.aprovado, por: text(v.chancelaJuridica.por, 100)!, em: v.chancelaJuridica.em, ...(optText(v.chancelaJuridica.nota, 500) ? { nota: optText(v.chancelaJuridica.nota, 500) } : {}) };
  }
  const s = optText(v.solicitacaoId, 20);
  if (s) p.solicitacaoId = s;
  if (validIso(v.desistenciaEm)) p.desistenciaEm = v.desistenciaEm;
  return p;
}

/** Desvios da tabela que exigem a exceção aprovada pela Presidência. */
export function excecoesTabela(p: Pick<PropostaVenda, "valor" | "valorTabela" | "entrada" | "parcelas">, t: TabelaVendas): string[] {
  const out: string[] = [];
  if (p.valor + 0.005 < p.valorTabela) out.push(`Desconto de ${(((p.valorTabela - p.valor) / p.valorTabela) * 100).toFixed(1).replace(".", ",")}% sobre a tabela`);
  if (p.entrada + 0.005 < p.valor * t.entradaMin) out.push(`Entrada abaixo de ${(t.entradaMin * 100).toFixed(0)}%`);
  if (p.parcelas > t.parcelasMax) out.push(`${p.parcelas} parcelas (máximo ${t.parcelasMax})`);
  return out;
}

/** Parcela fixa (Price) do saldo financiado. */
export function parcelaPrice(saldo: number, n: number, juros: number): number {
  if (n <= 0) return 0;
  if (juros <= 0) return r2(saldo / n);
  return r2((saldo * juros) / (1 - (1 + juros) ** -n));
}

/* ------------------------------------- Vendas ------------------------------------- */

export interface Parcela {
  venc: string;
  valor: number;
  pagoEm?: string;
}

export interface Venda {
  id: string;
  propostaId: string;
  loteId: string;
  comprador: Comprador;
  valor: number;
  entrada: number;
  entradaPagaEm?: string;
  parcelas: Parcela[];
  /** Assinatura do compromisso de compra e venda. */
  assinadoEm: string;
  distratoEm?: string;
  entrega?: { em: string; recebidoPor: string; termoAssinado: boolean; assinatura?: string; termoHash?: string };
}

export const MAX_VENDAS = 5000;

export function cleanVenda(v: unknown): Venda | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), propostaId = text(v.propostaId, 20), loteId = text(v.loteId, 20);
  const comprador = cleanComprador(v.comprador);
  if (!id || !propostaId || !loteId || !comprador || !isIsoDate(v.assinadoEm) || !nonNeg(v.valor) || !nonNeg(v.entrada)) return null;
  const parcelas = (Array.isArray(v.parcelas) ? v.parcelas : []).flatMap((p): Parcela[] =>
    isObj(p) && isIsoDate(p.venc) && nonNeg(p.valor) ? [{ venc: p.venc, valor: p.valor, ...(isIsoDate(p.pagoEm) ? { pagoEm: p.pagoEm } : {}) }] : [],
  ).slice(0, 360);
  const venda: Venda = { id, propostaId, loteId, comprador, valor: v.valor, entrada: v.entrada, parcelas, assinadoEm: v.assinadoEm };
  if (isIsoDate(v.entradaPagaEm)) venda.entradaPagaEm = v.entradaPagaEm;
  if (isIsoDate(v.distratoEm)) venda.distratoEm = v.distratoEm;
  if (isObj(v.entrega) && isIsoDate(v.entrega.em) && text(v.entrega.recebidoPor, 160) && typeof v.entrega.termoAssinado === "boolean") {
    const ass = typeof v.entrega.assinatura === "string" && v.entrega.assinatura.startsWith("data:image/") && v.entrega.assinatura.length <= 30_000 ? v.entrega.assinatura : undefined;
    const th = typeof v.entrega.termoHash === "string" && /^[0-9a-f]{64}$/.test(v.entrega.termoHash) ? v.entrega.termoHash : undefined;
    venda.entrega = { em: v.entrega.em, recebidoPor: text(v.entrega.recebidoPor, 160)!, termoAssinado: v.entrega.termoAssinado, ...(ass ? { assinatura: ass } : {}), ...(th ? { termoHash: th } : {}) };
  }
  return venda;
}

export const vendaAtiva = (v: Venda) => !v.distratoEm;

/** Gera as parcelas mensais a partir do mês seguinte à assinatura (dia do vencimento = dia da assinatura, limitado a 28). */
export function gerarParcelas(saldo: number, n: number, juros: number, assinadoEm: string): Parcela[] {
  const valor = parcelaPrice(saldo, n, juros);
  const [y, m, d] = assinadoEm.split("-").map(Number) as [number, number, number];
  const dia = Math.min(d, 28);
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1 + i + 1, dia));
    return { venc: t.toISOString().slice(0, 10), valor };
  });
}

/* --------------------------- Estado comercial e transições --------------------------- */

export interface Comercial {
  tabela?: TabelaVendas;
  reservas: Reserva[];
  propostas: PropostaVenda[];
  vendas: Venda[];
  /** Lotes vendidos para atingir o breakeven (padrão do documento: 80). */
  breakevenLotes?: number;
}

export const EMPTY_COMERCIAL: Comercial = Object.freeze({ reservas: [], propostas: [], vendas: [] }) as Comercial;

export function cleanComercial(v: unknown): Comercial {
  if (!isObj(v)) return { reservas: [], propostas: [], vendas: [] };
  const uniq = <T extends { id: string }>(l: T[], max: number) => {
    const s = new Set<string>();
    return l.filter((x) => (s.has(x.id) ? false : (s.add(x.id), true))).slice(0, max);
  };
  const c: Comercial = {
    reservas: uniq((Array.isArray(v.reservas) ? v.reservas : []).flatMap((x) => cleanReserva(x) ?? []), MAX_RESERVAS),
    propostas: uniq((Array.isArray(v.propostas) ? v.propostas : []).flatMap((x) => cleanProposta(x) ?? []), MAX_PROPOSTAS),
    vendas: uniq((Array.isArray(v.vendas) ? v.vendas : []).flatMap((x) => cleanVenda(x) ?? []), MAX_VENDAS),
  };
  const t = cleanTabela(v.tabela);
  if (t) c.tabela = t;
  if (nonNeg(v.breakevenLotes) && Number.isInteger(v.breakevenLotes) && v.breakevenLotes > 0) c.breakevenLotes = v.breakevenLotes;
  return c;
}

/** Ocupação atual do lote pelo comercial: venda ativa, proposta em curso ou reserva válida. */
export function ocupacaoLote(c: Comercial, loteId: string, agoraIso: string): { tipo: "venda" | "proposta" | "reserva"; id: string } | null {
  const v = c.vendas.find((x) => x.loteId === loteId && vendaAtiva(x));
  if (v) return { tipo: "venda", id: v.id };
  const p = c.propostas.find((x) => x.loteId === loteId && !x.desistenciaEm && !c.vendas.some((y) => y.propostaId === x.id) && !(x.credito && !x.credito.aprovado));
  if (p) return { tipo: "proposta", id: p.id };
  const r = c.reservas.find((x) => x.loteId === loteId && statusReserva(x, agoraIso) === "ativa");
  return r ? { tipo: "reserva", id: r.id } : null;
}

/** Situação comercial que o espelho mostra (a partir do comercial, não do campo manual). */
export function statusEspelho(lote: Lote, c: Comercial, agoraIso: string, caucao?: Caucao): Lote["comercial"] {
  const oc = ocupacaoLote(c, lote.id, agoraIso);
  if (oc?.tipo === "venda") return "vendido";
  if (oc) return "reservado";
  if (lote.comercial === "caucionado" || travaCaucao(lote.id, caucao)) return "caucionado";
  return lote.comercial === "bloqueado" ? "bloqueado" : "disponivel";
}

export function reservar(c: Comercial, lote: Lote, cartorio: Cartorio | undefined, comprador: Comprador, corretor: string, agoraIso: string, caucao?: Caucao): Comercial {
  const trava = travaR01(lote, cartorio);
  if (trava) throw new PmoError(`Trava legal: ${trava}.`);
  const tc = travaCaucao(lote.id, caucao);
  if (tc) throw new PmoError(`${tc}.`);
  if (lote.comercial === "bloqueado") throw new PmoError(`Lote ${lote.id} bloqueado para venda.`);
  if (lote.comercial === "caucionado") throw new PmoError(`Lote ${lote.id} em caução da Prefeitura: venda bloqueada até a liberação.`);
  if (!c.tabela) throw new PmoError("Publique a tabela de vendas antes de reservar.");
  const oc = ocupacaoLote(c, lote.id, agoraIso);
  if (oc) throw new PmoError(`Lote ${lote.id} já está em ${oc.tipo} (${oc.id}).`);
  const comp = cleanComprador(comprador);
  if (!comp) throw new PmoError("CPF/CNPJ inválido ou nome em branco.");
  const r: Reserva = { id: nextReservaId(c.reservas), loteId: lote.id, comprador: comp, corretor: corretor.trim().slice(0, 100) || "—", criadaEm: agoraIso, expiraEm: new Date(Date.parse(agoraIso) + RESERVA_HORAS * 3_600_000).toISOString() };
  return { ...c, reservas: [...c.reservas, r] };
}

export function cancelarReserva(c: Comercial, reservaId: string, agoraIso: string): Comercial {
  const r = c.reservas.find((x) => x.id === reservaId);
  if (!r || statusReserva(r, agoraIso) !== "ativa") throw new PmoError("Só reserva ativa pode ser cancelada.");
  return { ...c, reservas: c.reservas.map((x) => (x.id === reservaId ? { ...x, canceladaEm: agoraIso } : x)) };
}

export function proporFromReserva(c: Comercial, reservaId: string, lote: Lote, cond: { valor: number; entrada: number; parcelas: number }, por: string, agoraIso: string): Comercial {
  const r = c.reservas.find((x) => x.id === reservaId);
  if (!r || statusReserva(r, agoraIso) !== "ativa") throw new PmoError("A reserva expirou ou não está ativa: faça uma nova reserva.");
  if (!c.tabela) throw new PmoError("Sem tabela de vendas publicada.");
  const p = cleanProposta({ id: nextPropostaId(c.propostas), reservaId, loteId: r.loteId, comprador: r.comprador, valorTabela: precoTabela(lote, c.tabela), ...cond, criadaEm: agoraIso, criadaPor: por });
  if (!p) throw new PmoError("Proposta inválida: valor maior que zero, entrada até o valor e parcelas inteiras.");
  return { ...c, propostas: [...c.propostas, p], reservas: c.reservas.map((x) => (x.id === reservaId ? { ...x, propostaId: p.id } : x)) };
}

export function analisarCredito(c: Comercial, propostaId: string, aprovado: boolean, por: string, agoraIso: string, nota?: string): Comercial {
  const p = c.propostas.find((x) => x.id === propostaId);
  if (!p || p.desistenciaEm) throw new PmoError("Proposta inexistente ou encerrada.");
  if (p.credito) throw new PmoError("A análise de crédito já foi registrada.");
  if (!aprovado && (nota?.trim().length ?? 0) < 5) throw new PmoError("Informe o motivo da reprovação do crédito.");
  return { ...c, propostas: c.propostas.map((x) => (x.id === propostaId ? { ...x, credito: { aprovado, por: por.trim().slice(0, 100) || "—", em: agoraIso, ...(nota?.trim() ? { nota: nota.trim().slice(0, 500) } : {}) } } : x)) };
}

/** F6.03 — chancela do Jurídico (segunda chancela, além do crédito pelo Financeiro). */
export function chancelarJuridico(c: Comercial, propostaId: string, aprovado: boolean, por: string, agoraIso: string, nota?: string): Comercial {
  const p = c.propostas.find((x) => x.id === propostaId);
  if (!p || p.desistenciaEm) throw new PmoError("Proposta inexistente ou encerrada.");
  if (p.chancelaJuridica) throw new PmoError("A chancela jurídica já foi registrada.");
  if (!aprovado && (nota?.trim().length ?? 0) < 5) throw new PmoError("Informe o motivo da recusa jurídica.");
  return { ...c, propostas: c.propostas.map((x) => (x.id === propostaId ? { ...x, chancelaJuridica: { aprovado, por: por.trim().slice(0, 100) || "—", em: agoraIso, ...(nota?.trim() ? { nota: nota.trim().slice(0, 500) } : {}) } } : x)) };
}

export interface ContextoContrato {
  lote: Lote;
  cartorio?: Cartorio;
  /** Caução municipal (v1.1): lote caucionado não vende. */
  caucao?: Caucao;
  /** A alçada de exceção (se houver) está aprovada? */
  excecaoAprovada: boolean;
}

/** O que impede assinar o compromisso de compra e venda. */
export function travasContrato(c: Comercial, p: PropostaVenda, x: ContextoContrato): string[] {
  const t: string[] = [];
  const r01 = travaR01(x.lote, x.cartorio);
  if (r01) t.push(r01);
  const tc = travaCaucao(x.lote.id, x.caucao) ?? (x.lote.comercial === "caucionado" ? `Lote ${x.lote.id} em caução da Prefeitura` : null);
  if (tc) t.push(tc);
  if (!p.chancelaJuridica) t.push("Chancela jurídica pendente (análise documental e minuta)");
  else if (!p.chancelaJuridica.aprovado) t.push("Chancela jurídica negada");
  if (!p.credito) t.push("Análise de crédito pendente");
  else if (!p.credito.aprovado) t.push("Crédito reprovado");
  if (c.tabela && excecoesTabela(p, c.tabela).length && !x.excecaoAprovada) t.push("Exceção de tabela sem aprovação da Presidência");
  if (p.desistenciaEm) t.push("Proposta encerrada");
  if (c.vendas.some((v) => v.propostaId === p.id)) t.push("Contrato já assinado");
  return t;
}

export function assinarContrato(c: Comercial, propostaId: string, x: ContextoContrato, assinadoEm: string): Comercial {
  const p = c.propostas.find((y) => y.id === propostaId);
  if (!p) throw new PmoError("Proposta inexistente.");
  if (!isIsoDate(assinadoEm)) throw new PmoError("Data de assinatura inválida.");
  const t = travasContrato(c, p, x);
  if (t.length) throw new PmoError(t.join(". ") + ".");
  const juros = c.tabela?.jurosMes ?? 0;
  const v: Venda = { id: nextVendaId(c.vendas), propostaId, loteId: p.loteId, comprador: p.comprador, valor: p.valor, entrada: p.entrada, parcelas: gerarParcelas(p.valor - p.entrada, p.parcelas, juros, assinadoEm), assinadoEm };
  return { ...c, vendas: [...c.vendas, v] };
}

export function baixarEntrada(c: Comercial, vendaId: string, em: string): Comercial {
  const v = c.vendas.find((x) => x.id === vendaId);
  if (!v || !vendaAtiva(v)) throw new PmoError("Venda inexistente ou distratada.");
  if (v.entradaPagaEm) throw new PmoError("Entrada já baixada.");
  if (!isIsoDate(em) || em < v.assinadoEm) throw new PmoError("Data da baixa inválida.");
  return { ...c, vendas: c.vendas.map((x) => (x.id === vendaId ? { ...x, entradaPagaEm: em } : x)) };
}

export function baixarParcela(c: Comercial, vendaId: string, indice: number, em: string): Comercial {
  const v = c.vendas.find((x) => x.id === vendaId);
  if (!v || !vendaAtiva(v)) throw new PmoError("Venda inexistente ou distratada.");
  if (!v.parcelas[indice] || v.parcelas[indice]!.pagoEm) throw new PmoError("Parcela inexistente ou já paga.");
  if (!isIsoDate(em)) throw new PmoError("Data inválida.");
  return { ...c, vendas: c.vendas.map((x) => (x.id === vendaId ? { ...x, parcelas: x.parcelas.map((p, i) => (i === indice ? { ...p, pagoEm: em } : p)) } : x)) };
}

/** Entrega com termo de vistoria assinado: exige entrada paga e infraestrutura do lote concluída. */
export function entregarLote(c: Comercial, vendaId: string, lote: Lote, e: { em: string; recebidoPor: string; termoAssinado: boolean; assinatura?: string; termoHash?: string }): Comercial {
  const v = c.vendas.find((x) => x.id === vendaId);
  if (!v || !vendaAtiva(v)) throw new PmoError("Venda inexistente ou distratada.");
  if (v.entrega) throw new PmoError("Lote já entregue.");
  if (!v.entradaPagaEm) throw new PmoError("Entrada não baixada.");
  if (lote.fisico !== "infra_concluida" && lote.fisico !== "entregue") throw new PmoError("Infraestrutura do lote ainda não concluída.");
  if (!e.termoAssinado) throw new PmoError("O termo de vistoria precisa estar assinado.");
  if (!isIsoDate(e.em) || !e.recebidoPor.trim()) throw new PmoError("Informe a data e quem recebeu.");
  return { ...c, vendas: c.vendas.map((x) => (x.id === vendaId ? { ...x, entrega: { em: e.em, recebidoPor: e.recebidoPor.trim().slice(0, 160), termoAssinado: true, ...(e.assinatura ? { assinatura: e.assinatura } : {}), ...(e.termoHash ? { termoHash: e.termoHash } : {}) } } : x)) };
}

/* ---------------------------------- Indicadores ---------------------------------- */

export interface IndicadoresComerciais {
  vgvTabela: number;
  vgvVendido: number;
  lotesVendidos: number;
  lotesDisponiveis: number;
  breakevenLotes: number;
  /** 0..1 */
  progressoBreakeven: number;
  /** Vendas do mês ÷ estoque disponível no início do mês. */
  vsoMes: number | null;
  carteira: number;
  recebido: number;
  vencidoNaoPago: number;
  /** Vencido não pago há mais de 30 dias ÷ carteira vencida. */
  inadimplencia: number | null;
}

export function indicadoresComerciais(lotes: readonly Lote[], c: Comercial, hoje: string, agoraIso: string, breakevenPadrao = 80): IndicadoresComerciais {
  const ativas = c.vendas.filter(vendaAtiva);
  const vgvTabela = c.tabela ? r2(lotes.reduce((s, l) => s + precoTabela(l, c.tabela!), 0)) : 0;
  const vgvVendido = r2(ativas.reduce((s, v) => s + v.valor, 0));
  const mes = hoje.slice(0, 7);
  const vendasMes = ativas.filter((v) => v.assinadoEm.slice(0, 7) === mes).length;
  const vendidosAntes = ativas.filter((v) => v.assinadoEm.slice(0, 7) < mes).length;
  const vendaveis = lotes.filter((l) => l.comercial !== "bloqueado" && l.comercial !== "caucionado").length;
  const estoqueInicio = vendaveis - vendidosAntes;
  let recebido = 0, vencido = 0, vencido30 = 0, venceu = 0;
  for (const v of ativas) {
    if (v.entradaPagaEm) recebido += v.entrada;
    for (const p of v.parcelas) {
      if (p.pagoEm) recebido += p.valor;
      if (p.venc < hoje) {
        venceu += p.valor;
        if (!p.pagoEm) {
          vencido += p.valor;
          if (daysBetween(p.venc, hoje) > 30) vencido30 += p.valor;
        }
      }
    }
  }
  const carteira = r2(ativas.reduce((s, v) => s + v.valor, 0) - recebido);
  const be = c.breakevenLotes ?? breakevenPadrao;
  return {
    vgvTabela, vgvVendido, lotesVendidos: ativas.length,
    lotesDisponiveis: lotes.filter((l) => statusEspelho(l, c, agoraIso) === "disponivel").length,
    breakevenLotes: be, progressoBreakeven: Math.min(1, ativas.length / be),
    vsoMes: estoqueInicio > 0 ? vendasMes / estoqueInicio : null,
    carteira, recebido: r2(recebido), vencidoNaoPago: r2(vencido),
    inadimplencia: venceu > 0 ? vencido30 / venceu : null,
  };
}

/** Reserva perto de expirar (até 6 h) vira alerta amarelo para o comercial. */
export function prazoReserva(r: Reserva, agoraIso: string): { nivel: Nivel; mensagem: string } {
  const st = statusReserva(r, agoraIso);
  if (st !== "ativa") return { nivel: "verde", mensagem: st };
  const horas = (Date.parse(r.expiraEm) - Date.parse(agoraIso)) / 3_600_000;
  return horas <= 6 ? { nivel: "amarelo", mensagem: `Reserva do lote ${r.loteId} expira em ${Math.max(0, Math.floor(horas))} h.` } : { nivel: "verde", mensagem: `Expira em ${Math.floor(horas)} h.` };
}

/* ------------------------------ Fluxo de caixa integrado ------------------------------ */

export interface MovimentoCaixa {
  data: string;
  valor: number;
  /** realizado (pago/recebido) ou previsto. */
  realizado: boolean;
}

export interface LinhaFluxo {
  mes: string;
  entradasRealizadas: number;
  entradasPrevistas: number;
  saidasRealizadas: number;
  saidasPrevistas: number;
  saldoMes: number;
  saldoAcumulado: number;
}

/** Recebíveis das vendas (entrada e parcelas) como movimentos de caixa. */
export function recebiveis(c: Comercial): MovimentoCaixa[] {
  const out: MovimentoCaixa[] = [];
  for (const v of c.vendas.filter(vendaAtiva)) {
    out.push({ data: v.entradaPagaEm ?? v.assinadoEm, valor: v.entrada, realizado: !!v.entradaPagaEm });
    for (const p of v.parcelas) out.push({ data: p.pagoEm ?? p.venc, valor: p.valor, realizado: !!p.pagoEm });
  }
  return out;
}

/** Fluxo mensal único: obras (saídas) e vendas (entradas), realizado e previsto. */
export function fluxoIntegrado(entradas: readonly MovimentoCaixa[], saidas: readonly MovimentoCaixa[], meses?: number): LinhaFluxo[] {
  const map = new Map<string, LinhaFluxo>();
  const linha = (mes: string) => map.get(mes) ?? (map.set(mes, { mes, entradasRealizadas: 0, entradasPrevistas: 0, saidasRealizadas: 0, saidasPrevistas: 0, saldoMes: 0, saldoAcumulado: 0 }), map.get(mes)!);
  for (const e of entradas) { const l = linha(e.data.slice(0, 7)); if (e.realizado) l.entradasRealizadas += e.valor; else l.entradasPrevistas += e.valor; }
  for (const s of saidas) { const l = linha(s.data.slice(0, 7)); if (s.realizado) l.saidasRealizadas += s.valor; else l.saidasPrevistas += s.valor; }
  let acc = 0;
  const out = [...map.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map((l) => {
    const saldoMes = r2(l.entradasRealizadas + l.entradasPrevistas - l.saidasRealizadas - l.saidasPrevistas);
    acc = r2(acc + saldoMes);
    return { ...l, entradasRealizadas: r2(l.entradasRealizadas), entradasPrevistas: r2(l.entradasPrevistas), saidasRealizadas: r2(l.saidasRealizadas), saidasPrevistas: r2(l.saidasPrevistas), saldoMes, saldoAcumulado: acc };
  });
  return meses ? out.slice(0, meses) : out;
}

/**
 * VGV para a margem (5.6): com tabela publicada, o vendido de fato mais o estoque (todos os demais lotes) pelo preço de tabela;
 * sem tabela, o VGV de referência informado em Custos.
 */
export function vgvReferencia(lotes: readonly Lote[], c: Comercial, vgvManual?: number): { valor: number | undefined; fonte: "vendas" | "referencia" | "nenhum" } {
  if (c.tabela && lotes.length) {
    const vendidos = new Map(c.vendas.filter(vendaAtiva).map((v) => [v.loteId, v.valor]));
    const valor = lotes.reduce((s, l) => s + (vendidos.has(l.id) ? vendidos.get(l.id)! : precoTabela(l, c.tabela!)), 0);
    return { valor: r2(valor), fonte: "vendas" };
  }
  return vgvManual && vgvManual > 0 ? { valor: vgvManual, fonte: "referencia" } : { valor: undefined, fonte: "nenhum" };
}

/** Texto do termo de vistoria e entrega: o hash dele fica gravado com a assinatura (6.7). */
export function textoTermoEntrega(v: Venda, lote: Lote, em: string, recebidoPor: string): string {
  return [
    "TERMO DE VISTORIA E ENTREGA DE LOTE",
    `Contrato ${v.id} · Lote ${lote.id} (quadra ${lote.quadra}, nº ${lote.numero}, ${lote.areaM2} m², matrícula ${lote.matricula ?? "—"})`,
    `Comprador: ${v.comprador.nome} (doc. ${v.comprador.doc})`,
    `Recebido por: ${recebidoPor} em ${em}`,
    "O comprador declara ter vistoriado o lote, com infraestrutura concluída, e recebê-lo nas condições do compromisso de compra e venda.",
  ].join("\n");
}

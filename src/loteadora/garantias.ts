import { PmoError } from "../errors";
import { addDays, daysBetween, isIsoDate, isObj, nonNeg, optText, text } from "./common";
import { FRENTE_OBRA_LABEL, FRENTES_OBRA, type FrenteObra, type FrenteTrecho } from "./campo";

/**
 * Versão 1.1 do documento — Garantias de serviços de terceiros e caução de obras junto à Prefeitura
 * (Seção 1, RACI 4/5/10, F3.01–F3.05, F4.05, Gate 8 e Módulo 4).
 *
 * Garantia: todo serviço prestado por terceiro (5 anos do Código Civil, art. 618, para obra civil;
 * 24 meses para plantio; prazo do fabricante para equipamentos; retenção técnica em medição).
 * Caução: garantia de execução das obras dada à Prefeitura (lotes caucionados, seguro, fiança ou
 * depósito), com cronograma de liberações até o TVO. Lote caucionado não pode ser vendido.
 */

export const TIPOS_GARANTIA = ["obra_civil", "plantio", "equipamento", "retencao", "outra"] as const;
export type TipoGarantia = (typeof TIPOS_GARANTIA)[number];
export const TIPO_GARANTIA_LABEL: Record<TipoGarantia, string> = {
  obra_civil: "Obra civil — 5 anos (Código Civil, art. 618)",
  plantio: "Plantio — 24 meses (CETESB)",
  equipamento: "Equipamento eletromecânico",
  retencao: "Retenção técnica em medição",
  outra: "Outra garantia contratual",
};
/** Prazo padrão (meses) de cada tipo; o contrato pode fixar outro. */
export const PRAZO_PADRAO_MESES: Record<TipoGarantia, number> = { obra_civil: 60, plantio: 24, equipamento: 12, retencao: 12, outra: 12 };

export interface AcionamentoGarantia {
  em: string;
  descricao: string;
  rncId?: string;
  resolvidoEm?: string;
  por: string;
}

export interface Garantia {
  id: string;
  tipo: TipoGarantia;
  /** Empreiteiro ou fabricante (nome) e, se houver, o fornecedor homologado. */
  fornecedor: string;
  fornecedorId?: string;
  servico: string;
  /** Frente de obra coberta e trecho (sem trecho = obra inteira). */
  frente?: FrenteObra;
  trechoId?: string;
  contrato?: string;
  /** Início da garantia (recebimento do serviço) e prazo em meses. */
  inicio: string;
  prazoMeses: number;
  /** Valor retido ou garantido (R$), quando houver. */
  valor?: number;
  documento?: string;
  acionamentos: AcionamentoGarantia[];
  encerradaEm?: string;
}

export const MAX_GARANTIAS = 2000;

function addMeses(d: string, meses: number): string {
  const [y, m, dia] = d.split("-").map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export const vencimentoGarantia = (g: Garantia) => addMeses(g.inicio, g.prazoMeses);
export const acionamentoAberto = (g: Garantia) => g.acionamentos.find((a) => !a.resolvidoEm);

export type StatusGarantia = "ativa" | "vencendo" | "acionada" | "vencida" | "encerrada";
export const STATUS_GARANTIA_LABEL: Record<StatusGarantia, string> = { ativa: "Ativa", vencendo: "Vence em até 90 dias", acionada: "Acionada", vencida: "Vencida", encerrada: "Encerrada" };

export function statusGarantia(g: Garantia, hoje: string): StatusGarantia {
  if (g.encerradaEm) return "encerrada";
  if (acionamentoAberto(g)) return "acionada";
  const venc = vencimentoGarantia(g);
  if (venc < hoje) return "vencida";
  return daysBetween(hoje, venc) <= 90 ? "vencendo" : "ativa";
}

export const garantiaVigente = (g: Garantia, hoje: string) => ["ativa", "vencendo", "acionada"].includes(statusGarantia(g, hoje));

export function cleanGarantia(v: unknown): Garantia | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), fornecedor = text(v.fornecedor, 160), servico = text(v.servico, 300);
  if (!id || !fornecedor || !servico || !(TIPOS_GARANTIA as readonly unknown[]).includes(v.tipo) || !isIsoDate(v.inicio)) return null;
  if (typeof v.prazoMeses !== "number" || !Number.isInteger(v.prazoMeses) || v.prazoMeses < 1 || v.prazoMeses > 240) return null;
  const g: Garantia = { id, tipo: v.tipo as TipoGarantia, fornecedor, servico, inicio: v.inicio, prazoMeses: v.prazoMeses, acionamentos: [] };
  const fid = optText(v.fornecedorId, 40);
  if (fid) g.fornecedorId = fid;
  if ((FRENTES_OBRA as readonly unknown[]).includes(v.frente)) g.frente = v.frente as FrenteObra;
  const t = optText(v.trechoId, 40);
  if (t) g.trechoId = t;
  const c = optText(v.contrato, 80);
  if (c) g.contrato = c;
  if (nonNeg(v.valor)) g.valor = v.valor;
  const doc = optText(v.documento, 400);
  if (doc) g.documento = doc;
  if (isIsoDate(v.encerradaEm)) g.encerradaEm = v.encerradaEm;
  g.acionamentos = (Array.isArray(v.acionamentos) ? v.acionamentos : []).flatMap((a): AcionamentoGarantia[] => {
    if (!isObj(a) || !isIsoDate(a.em)) return [];
    const descricao = text(a.descricao, 1000), por = text(a.por, 100);
    if (!descricao || !por) return [];
    const r: AcionamentoGarantia = { em: a.em, descricao, por };
    const rnc = optText(a.rncId, 20);
    if (rnc) r.rncId = rnc;
    if (isIsoDate(a.resolvidoEm)) r.resolvidoEm = a.resolvidoEm;
    return [r];
  }).slice(0, 50);
  return g;
}

export const nextGarantiaId = (lista: readonly Garantia[]) => `GAR-${String(lista.reduce((m, g) => Math.max(m, Number(g.id.replace(/\D/g, "")) || 0), 0) + 1).padStart(3, "0")}`;

export function novaGarantia(lista: readonly Garantia[], dados: Omit<Garantia, "id" | "acionamentos" | "prazoMeses"> & { prazoMeses?: number }): Garantia[] {
  const g = cleanGarantia({ ...dados, id: nextGarantiaId(lista), prazoMeses: dados.prazoMeses ?? PRAZO_PADRAO_MESES[dados.tipo], acionamentos: [] });
  if (!g) throw new PmoError("Garantia inválida: informe fornecedor, serviço, tipo, início e prazo em meses.");
  return [...lista, g];
}

/** F5.05: acionar a garantia (refação pelo empreiteiro). Trava a retenção do fornecedor até a solução. */
export function acionarGarantia(lista: readonly Garantia[], id: string, descricao: string, por: string, em: string, rncId?: string): Garantia[] {
  const g = lista.find((x) => x.id === id);
  if (!g || g.encerradaEm) throw new PmoError("Garantia inexistente ou encerrada.");
  if (!isIsoDate(em) || em > vencimentoGarantia(g)) throw new PmoError("A garantia já estava vencida nessa data.");
  if (acionamentoAberto(g)) throw new PmoError("Já existe um acionamento aberto nesta garantia.");
  if (descricao.trim().length < 5) throw new PmoError("Descreva o defeito.");
  return lista.map((x) => (x.id === id ? { ...x, acionamentos: [...x.acionamentos, { em, descricao: descricao.trim().slice(0, 1000), por: por.trim().slice(0, 100) || "—", ...(rncId ? { rncId } : {}) }] } : x));
}

export function resolverAcionamento(lista: readonly Garantia[], id: string, em: string): Garantia[] {
  const g = lista.find((x) => x.id === id);
  const aberto = g && acionamentoAberto(g);
  if (!g || !aberto) throw new PmoError("Sem acionamento aberto nesta garantia.");
  if (!isIsoDate(em) || em < aberto.em) throw new PmoError("Data de solução inválida.");
  return lista.map((x) => (x.id === id ? { ...x, acionamentos: x.acionamentos.map((a) => (a === aberto ? { ...a, resolvidoEm: em } : a)) } : x));
}

/** Fornecedores com garantia acionada em aberto: a retenção técnica deles não pode ser liberada (3.4, item 3). */
export function retencaoTravada(garantias: readonly Garantia[], fornecedor: string): string | null {
  const g = garantias.find((x) => !x.encerradaEm && acionamentoAberto(x) && (x.fornecedorId === fornecedor || x.fornecedor.toLowerCase() === fornecedor.toLowerCase()));
  return g ? `Garantia ${g.id} acionada desde ${acionamentoAberto(g)!.em}: retenção travada até a validação técnica` : null;
}

/**
 * Gate 8 (TVO): dossiê de garantias ativo. Cada frente concluída no trecho precisa de uma garantia
 * vigente da frente (no trecho ou na obra inteira). Devolve o que falta.
 */
export function pendenciasGarantiaTrecho(garantias: readonly Garantia[], frentes: readonly FrenteTrecho[], trechoId: string, hoje: string): string[] {
  const concluidas = frentes.filter((f) => f.trechoId === trechoId && f.concluidaEm && f.frente !== "tvo").map((f) => f.frente);
  const vig = garantias.filter((g) => garantiaVigente(g, hoje) && (!g.trechoId || g.trechoId === trechoId));
  return concluidas.filter((fr) => !vig.some((g) => g.frente === fr)).map((fr) => `Sem garantia vigente de ${FRENTE_OBRA_LABEL[fr].slice(4).toLowerCase()}`);
}

/** KPI 6.1 (Qualidade & Garantia): % de garantias exigidas que estão ativas. */
export function indiceGarantias(garantias: readonly Garantia[], frentes: readonly FrenteTrecho[], hoje: string): { exigidas: number; cobertas: number; pct: number | null } {
  const concluidas = frentes.filter((f) => f.concluidaEm && f.frente !== "tvo");
  const cobertas = concluidas.filter((f) => garantias.some((g) => garantiaVigente(g, hoje) && g.frente === f.frente && (!g.trechoId || g.trechoId === f.trechoId))).length;
  return { exigidas: concluidas.length, cobertas, pct: concluidas.length ? cobertas / concluidas.length : null };
}

/* ------------------------------- Caução municipal ------------------------------- */

export const TIPOS_CAUCAO = ["lotes", "seguro_garantia", "fianca", "deposito"] as const;
export type TipoCaucao = (typeof TIPOS_CAUCAO)[number];
export const TIPO_CAUCAO_LABEL: Record<TipoCaucao, string> = { lotes: "Lotes caucionados (hipoteca)", seguro_garantia: "Seguro-garantia", fianca: "Fiança bancária", deposito: "Depósito em dinheiro" };

export interface MarcoCaucao {
  id: string;
  /** Etapa da obra que libera parte da caução (ex.: "Drenagem e água concluídas", "TVO"). */
  descricao: string;
  previstoEm: string;
  liberadoEm?: string;
  /** Lotes liberados nesse marco (quando a caução é em lotes). */
  lotes: string[];
  valor?: number;
  /** Gatilho físico (validação v2): frente de obra e avanço mínimo (%) nos trechos do marco (ou na obra). */
  frente?: FrenteObra;
  avancoMinPct?: number;
  trechos?: string[];
  /** Termo de Vistoria Parcial da Prefeitura e validação do Jurídico: os dois são exigidos para liberar. */
  termoVistoriaParcial?: string;
  validadoJuridicoPor?: string;
  validadoJuridicoEm?: string;
}

export interface Caucao {
  tipo: TipoCaucao;
  termo: string;
  /** Data do termo de caução (F3.01) e prazo de execução das obras perante a Prefeitura. */
  firmadoEm: string;
  prazoObrasAte: string;
  valor?: number;
  /** Lotes dados em caução (ids do cadastro). */
  lotes: string[];
  averbadaEm?: string;
  marcos: MarcoCaucao[];
  /** Liberação total (descaucionamento) após o TVO. */
  descaucionadaEm?: string;
}

export function cleanCaucao(v: unknown): Caucao | undefined {
  if (!isObj(v) || !(TIPOS_CAUCAO as readonly unknown[]).includes(v.tipo)) return undefined;
  const termo = text(v.termo, 120);
  if (!termo || !isIsoDate(v.firmadoEm) || !isIsoDate(v.prazoObrasAte)) return undefined;
  const ids = (x: unknown) => [...new Set((Array.isArray(x) ? x : []).flatMap((l) => text(l, 20) ?? []))].slice(0, 3000);
  const c: Caucao = { tipo: v.tipo as TipoCaucao, termo, firmadoEm: v.firmadoEm, prazoObrasAte: v.prazoObrasAte, lotes: ids(v.lotes), marcos: [] };
  if (nonNeg(v.valor)) c.valor = v.valor;
  if (isIsoDate(v.averbadaEm)) c.averbadaEm = v.averbadaEm;
  if (isIsoDate(v.descaucionadaEm)) c.descaucionadaEm = v.descaucionadaEm;
  c.marcos = (Array.isArray(v.marcos) ? v.marcos : []).flatMap((m): MarcoCaucao[] => {
    if (!isObj(m)) return [];
    const id = text(m.id, 20), descricao = text(m.descricao, 200);
    if (!id || !descricao || !isIsoDate(m.previstoEm)) return [];
    const r: MarcoCaucao = { id, descricao, previstoEm: m.previstoEm, lotes: ids(m.lotes) };
    if (isIsoDate(m.liberadoEm)) r.liberadoEm = m.liberadoEm;
    if (nonNeg(m.valor)) r.valor = m.valor;
    if ((FRENTES_OBRA as readonly unknown[]).includes(m.frente)) r.frente = m.frente as FrenteObra;
    if (nonNeg(m.avancoMinPct) && m.avancoMinPct <= 100) r.avancoMinPct = m.avancoMinPct;
    const tr = ids(m.trechos);
    if (tr.length) r.trechos = tr;
    const tv = optText(m.termoVistoriaParcial, 120);
    if (tv) r.termoVistoriaParcial = tv;
    const vj = optText(m.validadoJuridicoPor, 100);
    if (vj && isIsoDate(m.validadoJuridicoEm)) {
      r.validadoJuridicoPor = vj;
      r.validadoJuridicoEm = m.validadoJuridicoEm;
    }
    return [r];
  }).slice(0, 50);
  return c;
}

/** Lotes ainda presos na caução (dados em caução e não liberados por nenhum marco nem pelo descaucionamento). */
export function lotesCaucionados(c?: Caucao): Set<string> {
  if (!c || c.descaucionadaEm) return new Set();
  const liberados = new Set(c.marcos.filter((m) => m.liberadoEm).flatMap((m) => m.lotes));
  return new Set(c.lotes.filter((l) => !liberados.has(l)));
}

/** Trava F3.05/F6.01: lote em caução municipal não reserva nem vende. */
export function travaCaucao(loteId: string, c?: Caucao): string | null {
  return lotesCaucionados(c).has(loteId) ? `Lote ${loteId} em caução municipal (termo ${c!.termo}): venda bloqueada até a liberação` : null;
}

/** Avanço médio (%) da frente nos trechos do marco (ou em todos os trechos com a frente cadastrada). */
export function avancoDoMarco(m: MarcoCaucao, frentes: readonly FrenteTrecho[]): number | null {
  if (!m.frente) return null;
  const lista = frentes.filter((f) => f.frente === m.frente && (!m.trechos?.length || m.trechos.includes(f.trechoId)));
  const base = m.trechos?.length ? m.trechos.length : lista.length;
  if (!base) return 0;
  return Math.round((lista.reduce((s, f) => s + (f.concluidaEm ? 100 : f.percent), 0) / base) * 10) / 10;
}

/**
 * O que falta para liberar o marco (F3.05, validação v2): avanço físico da frente, Termo de Vistoria
 * Parcial da Prefeitura e validação do Jurídico.
 */
export function travasLiberacaoMarco(m: MarcoCaucao, frentes: readonly FrenteTrecho[]): string[] {
  const t: string[] = [];
  if (m.frente) {
    const av = avancoDoMarco(m, frentes) ?? 0;
    const min = m.avancoMinPct ?? 100;
    if (av < min) t.push(`${FRENTE_OBRA_LABEL[m.frente].slice(4)} em ${String(av).replace(".", ",")}% (mínimo ${min}%)`);
  }
  if (!m.termoVistoriaParcial) t.push("Termo de Vistoria Parcial da Prefeitura não registrado");
  if (!m.validadoJuridicoPor) t.push("Validação do Jurídico pendente");
  return t;
}

/** Jurídico valida o marco (documentação da liberação conferida). */
export function validarMarcoJuridico(c: Caucao, marcoId: string, por: string, em: string): Caucao {
  const m = c.marcos.find((x) => x.id === marcoId);
  if (!m || m.liberadoEm) throw new PmoError("Marco inexistente ou já liberado.");
  if (!isIsoDate(em) || !por.trim()) throw new PmoError("Informe quem validou e a data.");
  return { ...c, marcos: c.marcos.map((x) => (x.id === marcoId ? { ...x, validadoJuridicoPor: por.trim().slice(0, 100), validadoJuridicoEm: em } : x)) };
}

/** Libera o marco: lotes saem de "caucionado" para "disponível". Com `frentes`, exige as travas do marco. */
export function liberarMarco(c: Caucao, marcoId: string, em: string, frentes?: readonly FrenteTrecho[]): Caucao {
  const m = c.marcos.find((x) => x.id === marcoId);
  if (!m) throw new PmoError("Marco de caução inexistente.");
  if (m.liberadoEm) throw new PmoError("Marco já liberado.");
  if (!isIsoDate(em)) throw new PmoError("Data de liberação inválida.");
  if (frentes) {
    const t = travasLiberacaoMarco(m, frentes);
    if (t.length) throw new PmoError(`Liberação travada: ${t.join("; ")}.`);
  }
  return { ...c, marcos: c.marcos.map((x) => (x.id === marcoId ? { ...x, liberadoEm: em } : x)) };
}

/** Situação do cronograma de caução para o painel (F3 e Gate 8). */
export function situacaoCaucao(c: Caucao | undefined, hoje: string): { presos: number; marcosVencidos: MarcoCaucao[]; diasPrazo: number | null } {
  if (!c) return { presos: 0, marcosVencidos: [], diasPrazo: null };
  return {
    presos: lotesCaucionados(c).size,
    marcosVencidos: c.marcos.filter((m) => !m.liberadoEm && m.previstoEm < hoje),
    diasPrazo: c.descaucionadaEm ? null : daysBetween(hoje, c.prazoObrasAte),
  };
}

export const nextMarcoId = (c: Caucao) => `MC-${String(c.marcos.length + 1).padStart(2, "0")}`;
export const proximoMarco = (c: Caucao, hoje: string) => c.marcos.filter((m) => !m.liberadoEm).sort((a, b) => a.previstoEm.localeCompare(b.previstoEm)).find((m) => m.previstoEm >= addDays(hoje, -3650));

/* ---------------------------------------------------------------------------
 * Fundo de retenção técnica por fornecedor (validação v2, Pendência 7).
 * ------------------------------------------------------------------------- */

export interface LiberacaoRetencao {
  id: string;
  fornecedorId: string;
  valor: number;
  em: string;
  por: string;
}

export const MAX_LIBERACOES_RETENCAO = 500;

export function cleanLiberacaoRetencao(v: unknown): LiberacaoRetencao | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), fornecedorId = text(v.fornecedorId, 40), por = text(v.por, 100);
  if (!id || !fornecedorId || !por || !nonNeg(v.valor) || v.valor <= 0 || !isIsoDate(v.em)) return null;
  return { id, fornecedorId, valor: v.valor, em: v.em, por };
}

export interface FundoFornecedor {
  fornecedorId: string;
  nome: string;
  retido: number;
  liberado: number;
  saldo: number;
  /** Garantias do fornecedor (vigência). */
  garantias: Garantia[];
  /** O que impede liberar o saldo: RNC aberta ou garantia acionada. */
  travas: string[];
}

/**
 * Quadro "Garantias de Terceiros e Fundo de Retenção": retenção acumulada nos boletins com liberação
 * financeira, o que já foi devolvido e as travas (RNC aberta do fornecedor ou garantia acionada).
 */
export function fundoRetencao(
  fornecedores: readonly { id: string; nome: string }[],
  boletins: readonly { fornecedorId: string; retido: number }[],
  liberacoes: readonly LiberacaoRetencao[],
  garantias: readonly Garantia[],
  rncsAbertas: readonly { id: string; fornecedorId?: string }[],
): FundoFornecedor[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return fornecedores
    .map((f) => {
      const retido = r2(boletins.filter((b) => b.fornecedorId === f.id).reduce((s, b) => s + b.retido, 0));
      const liberado = r2(liberacoes.filter((l) => l.fornecedorId === f.id).reduce((s, l) => s + l.valor, 0));
      const gs = garantias.filter((g) => g.fornecedorId === f.id || g.fornecedor.toLowerCase() === f.nome.toLowerCase());
      const travas: string[] = [];
      const rncs = rncsAbertas.filter((r) => r.fornecedorId === f.id);
      if (rncs.length) travas.push(`${rncs.length} RNC aberta(s): ${rncs.map((r) => r.id).join(", ")}`);
      const ac = retencaoTravada(gs, f.nome) ?? retencaoTravada(gs, f.id);
      if (ac) travas.push(ac);
      return { fornecedorId: f.id, nome: f.nome, retido, liberado, saldo: r2(retido - liberado), garantias: gs, travas };
    })
    .filter((x) => x.retido > 0 || x.garantias.length > 0);
}

export function liberarRetencao(
  lista: readonly LiberacaoRetencao[],
  fundo: FundoFornecedor,
  valor: number,
  por: string,
  em: string,
): LiberacaoRetencao[] {
  if (fundo.travas.length) throw new PmoError(`Retenção travada: ${fundo.travas.join("; ")}.`);
  if (!(valor > 0) || valor > fundo.saldo + 0.005) throw new PmoError("Valor acima do saldo retido do fornecedor.");
  if (!isIsoDate(em)) throw new PmoError("Data inválida.");
  const n = lista.reduce((m, l) => Math.max(m, Number(l.id.replace(/\D/g, "")) || 0), 0) + 1;
  return [...lista, { id: `LR-${String(n).padStart(3, "0")}`, fornecedorId: fundo.fornecedorId, valor: Math.round(valor * 100) / 100, em, por: por.trim().slice(0, 100) || "—" }];
}

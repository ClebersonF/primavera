import { PmoError } from "../errors";
import { cleanFicha, cleanLote, cleanTrecho, MAX_LOTES, MAX_TRECHOS, type FichaEmpreendimento, type Lote, type Trecho } from "./cadastro";
import { cleanCartorio, cleanParametros, cleanProcesso, MAX_PROCESSOS, type Cartorio, type ParametrosRegulatorios, type ProcessoRegulatorio } from "./regulatorio";
import { cleanMembro, cleanSolicitacao, MAX_EQUIPE, MAX_SOLICITACOES, type Membro, type Solicitacao } from "./alcadas";
import { cleanEtapa, cleanSnapshot, MAX_ETAPAS, MAX_SNAPSHOTS, type EtapaOrcamento, type SnapshotReforecast } from "./reforecast";
import { isIsoDate, isObj, nonNeg } from "./common";
import { cleanDiario, cleanFrenteTrecho, MAX_DIARIOS, MAX_FRENTES_TRECHO, MAX_MINIATURAS_OBRA, type DiarioObra, type FrenteTrecho } from "./campo";
import { cleanRnc, MAX_RNCS, type Rnc } from "./qualidade";
import { cleanBoletim, MAX_BOLETINS, type Boletim } from "./medicao";
import { cleanComercial, type Comercial } from "./comercial";
import { cleanFechamento, MAX_FECHAMENTOS, periodoBloqueadoAte, violacaoFechamento, type Fechamento } from "./fechamento";
import { cleanPlantio, MAX_PLANTIOS, type Plantio } from "./plantio";
import type { DecisaoChuva } from "./campo";
import { cleanAviso, MAX_AVISOS, type AvisoEnviado } from "./avisos";
import { cleanRegistro, eventosDeAlcada, MAX_TRILHA, registrar, trilhaSoInclusao, type Autor, type Carimbo, type RegistroTrilha } from "./trilha";
import { cleanCaucao, cleanGarantia, MAX_GARANTIAS, type Caucao, type Garantia } from "./garantias";
import { cleanCotacao, cleanFornecedor, cleanPrancha, MAX_COTACOES, MAX_FORNECEDORES, MAX_PRANCHAS, type Cotacao, type Fornecedor, type Prancha } from "./suprimentos";

/** Tudo o que a Loteadora 360º guarda por obra, dentro do planejamento da obra. */
export interface LoteadoraState {
  ficha: FichaEmpreendimento;
  trechos: Trecho[];
  lotes: Lote[];
  processos: ProcessoRegulatorio[];
  cartorio?: Cartorio;
  /** Parâmetros regulatórios próprios da obra; ausente = padrão do documento. */
  parametros?: ParametrosRegulatorios;
  equipe: Membro[];
  solicitacoes: Solicitacao[];
  etapas: EtapaOrcamento[];
  reforecasts: SnapshotReforecast[];
  /** VGV de referência (R$) e meta de margem bruta (0..1) para o controle de margem. */
  vgv?: number;
  metaMargem?: number;
  /* Fase 2 — canteiro, qualidade, medições e suprimentos. */
  frentes: FrenteTrecho[];
  diarios: DiarioObra[];
  rncs: Rnc[];
  boletins: Boletim[];
  fornecedores: Fornecedor[];
  cotacoes: Cotacao[];
  pranchas: Prancha[];
  /** A partir de quando o diário é obrigatório (início das obras). */
  inicioDiario?: string;
  /** Pluviometria (mm) a partir da qual o dia conta como perdido por chuva; padrão 10. */
  limiteChuvaMm?: number;
  /** Retenção técnica padrão das medições (%); padrão 5. */
  retencaoPct?: number;
  /* Fase 3 — comercial. */
  comercial: Comercial;
  /* Onda 1 — fechamento quinzenal, chuva no cronograma e plantio compensatório. */
  fechamentos: Fechamento[];
  /** Dia de chuva → aceito (virou dia não útil no calendário da obra) ou recusado. */
  chuvaDecisoes: Record<string, DecisaoChuva>;
  plantios: Plantio[];
  /* Onda 2 — trilha de auditoria encadeada (só inclusão). */
  trilha: RegistroTrilha[];
  /* Onda 4 — o que a rotina automática já enviou (para não repetir) e o último relatório semanal. */
  avisos: AvisoEnviado[];
  ultimoRelatorio?: string;
  /* v1.1 — garantias de terceiros e caução junto à Prefeitura. */
  garantias: Garantia[];
  caucao?: Caucao;
}

export const EMPTY_LOTEADORA: LoteadoraState = Object.freeze({ ficha: {}, trechos: [], lotes: [], processos: [], equipe: [], solicitacoes: [], etapas: [], reforecasts: [], frentes: [], diarios: [], rncs: [], boletins: [], fornecedores: [], cotacoes: [], pranchas: [], comercial: { reservas: [], propostas: [], vendas: [] }, fechamentos: [], chuvaDecisoes: {}, plantios: [], trilha: [], avisos: [], garantias: [] }) as LoteadoraState;

function uniqueBy<T extends { id: string }>(list: T[], max: number): T[] {
  return uniqueKey(list, (x) => x.id, max);
}

function uniqueKey<T>(list: T[], key: (x: T) => string, max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of list) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

const arr = (v: unknown) => (Array.isArray(v) ? v : []);

/** Lê o estado salvo descartando o que for inválido, sem falhar a obra inteira. */
export function cleanLoteadora(v: unknown): LoteadoraState | null {
  if (!isObj(v)) return null;
  const s: LoteadoraState = {
    ficha: cleanFicha(v.ficha) ?? {},
    trechos: uniqueBy(arr(v.trechos).flatMap((t) => cleanTrecho(t) ?? []), MAX_TRECHOS),
    lotes: uniqueBy(arr(v.lotes).flatMap((t) => cleanLote(t) ?? []), MAX_LOTES),
    processos: uniqueBy(arr(v.processos).flatMap((t) => cleanProcesso(t) ?? []), MAX_PROCESSOS),
    equipe: uniqueBy(arr(v.equipe).flatMap((t) => cleanMembro(t) ?? []), MAX_EQUIPE),
    solicitacoes: uniqueBy(arr(v.solicitacoes).flatMap((t) => cleanSolicitacao(t) ?? []), MAX_SOLICITACOES),
    etapas: uniqueBy(arr(v.etapas).flatMap((t) => cleanEtapa(t) ?? []), MAX_ETAPAS),
    reforecasts: [],
    frentes: [],
    diarios: [],
    rncs: uniqueBy(arr(v.rncs).flatMap((t) => cleanRnc(t) ?? []), MAX_RNCS),
    boletins: uniqueBy(arr(v.boletins).flatMap((t) => cleanBoletim(t) ?? []), MAX_BOLETINS),
    fornecedores: uniqueBy(arr(v.fornecedores).flatMap((t) => cleanFornecedor(t) ?? []), MAX_FORNECEDORES),
    cotacoes: uniqueBy(arr(v.cotacoes).flatMap((t) => cleanCotacao(t) ?? []), MAX_COTACOES),
    comercial: cleanComercial(v.comercial),
    fechamentos: uniqueKey(arr(v.fechamentos).flatMap((t) => cleanFechamento(t) ?? []), (f) => f.quinzena, MAX_FECHAMENTOS).sort((a, b) => a.quinzena.localeCompare(b.quinzena)),
    chuvaDecisoes: {},
    plantios: uniqueBy(arr(v.plantios).flatMap((t) => cleanPlantio(t) ?? []), MAX_PLANTIOS),
    trilha: arr(v.trilha).flatMap((t) => cleanRegistro(t) ?? []).slice(0, MAX_TRILHA),
    avisos: arr(v.avisos).flatMap((t) => cleanAviso(t) ?? []).slice(-MAX_AVISOS),
    pranchas: uniqueKey(arr(v.pranchas).flatMap((t) => cleanPrancha(t) ?? []), (p) => p.codigo, MAX_PRANCHAS),
    garantias: uniqueBy(arr(v.garantias).flatMap((t) => cleanGarantia(t) ?? []), MAX_GARANTIAS),
  };
  const cau = v.caucao === undefined ? undefined : cleanCaucao(v.caucao);
  if (cau) s.caucao = cau;
  // Frentes: uma por trecho e frente.
  s.frentes = uniqueKey(arr(v.frentes).flatMap((t) => cleanFrenteTrecho(t) ?? []), (f) => `${f.trechoId}|${f.frente}`, MAX_FRENTES_TRECHO);
  // Diário: um por dia, em ordem. Miniaturas embutidas têm teto por obra (acima dele a gravação é recusada).
  s.diarios = uniqueKey(arr(v.diarios).flatMap((t) => cleanDiario(t) ?? []), (d) => d.data, MAX_DIARIOS).sort((a, b) => a.data.localeCompare(b.data));
  let mini = 0;
  for (const d of s.diarios) for (const f of d.fotos) if (f.miniatura) mini++;
  if (mini > MAX_MINIATURAS_OBRA) return null;
  if (isIsoDate(v.inicioDiario)) s.inicioDiario = v.inicioDiario;
  if (isIsoDate(v.ultimoRelatorio)) s.ultimoRelatorio = v.ultimoRelatorio;
  if (isObj(v.chuvaDecisoes)) for (const [d, x] of Object.entries(v.chuvaDecisoes)) if (isIsoDate(d) && (x === "aceito" || x === "recusado")) s.chuvaDecisoes[d] = x;
  if (nonNeg(v.limiteChuvaMm) && v.limiteChuvaMm > 0 && v.limiteChuvaMm <= 500) s.limiteChuvaMm = v.limiteChuvaMm;
  if (nonNeg(v.retencaoPct) && v.retencaoPct <= 30) s.retencaoPct = v.retencaoPct;
  const meses = new Set<string>();
  for (const r of arr(v.reforecasts).flatMap((t) => cleanSnapshot(t) ?? [])) {
    if (meses.has(r.mes)) continue;
    meses.add(r.mes);
    s.reforecasts.push(r);
  }
  s.reforecasts.sort((a, b) => a.mes.localeCompare(b.mes));
  s.reforecasts = s.reforecasts.slice(-MAX_SNAPSHOTS);
  const cart = v.cartorio === undefined ? null : cleanCartorio(v.cartorio);
  if (cart) s.cartorio = cart;
  const par = v.parametros === undefined ? null : cleanParametros(v.parametros);
  if (par) s.parametros = par;
  if (nonNeg(v.vgv) && v.vgv > 0) s.vgv = v.vgv;
  if (nonNeg(v.metaMargem) && v.metaMargem <= 1) s.metaMargem = v.metaMargem;
  return s;
}

/**
 * Aplica uma mudança ao estado e valida o resultado inteiro (nada inválido é gravado em silêncio):
 * se a limpeza descartar algum item, a mudança é recusada.
 */
export function updateLoteadora(atual: LoteadoraState | undefined, muda: (s: LoteadoraState) => LoteadoraState, autor?: Autor, agoraIso?: string, carimbo?: Carimbo): LoteadoraState {
  const base = cleanLoteadora(atual) ?? EMPTY_LOTEADORA;
  const mudado = muda(base);
  // A trilha só cresce: nada do que já foi registrado pode mudar ou sumir.
  if (!trilhaSoInclusao(base.trilha, mudado.trilha ?? [])) throw new PmoError("A trilha de auditoria é só de inclusão: registros anteriores não podem mudar.");
  // Toda gravação com autor ganha registro: decisões de alçada com justificativa e impacto; o resto, o resumo da mudança.
  let next = mudado;
  if (autor) {
    const em = agoraIso ?? new Date().toISOString();
    let t = mudado.trilha ?? [];
    const alcadas = eventosDeAlcada(base.solicitacoes, mudado.solicitacoes ?? []);
    for (const ev of alcadas) t = registrar(t, autor, em, { ...ev, ...(carimbo ? { carimbo } : {}) });
    const linhas = describeLoteadoraChange(base, { ...mudado, solicitacoes: base.solicitacoes });
    for (const l of linhas) t = registrar(t, autor, em, { acao: "alteracao", alvo: "obra", detalhe: l, ...(carimbo ? { carimbo } : {}) });
    next = { ...mudado, trilha: t };
  }
  const clean = cleanLoteadora(next);
  if (!clean) throw new PmoError(`Dados da loteadora inválidos (miniaturas de foto acima de ${MAX_MINIATURAS_OBRA} por obra?).`);
  const contar = (x: LoteadoraState) => [x.trechos.length, x.lotes.length, x.processos.length, x.equipe.length, x.solicitacoes.length, x.etapas.length, x.reforecasts.length, x.cartorio ? 1 : 0, x.frentes.length, x.diarios.length, x.rncs.length, x.boletins.length, x.fornecedores.length, x.cotacoes.length, x.pranchas.length, x.comercial.reservas.length, x.comercial.propostas.length, x.comercial.vendas.length, x.comercial.tabela ? 1 : 0, x.fechamentos.length, x.plantios.length, Object.keys(x.chuvaDecisoes).length, x.trilha.length, (x.garantias ?? []).length, x.caucao ? x.caucao.marcos.length + 1 : 0].join(",");
  if (contar(clean) !== contar(next)) throw new PmoError("Algum item ficou inválido ou repetido (id em dobro, data ou valor fora do formato). Nada foi gravado.");
  // Período fechado (fechamento quinzenal): o que está nele não muda mais.
  const v = violacaoFechamento(periodoBloqueadoAte(base.fechamentos), base, clean);
  if (v) throw new PmoError(v);
  if (clean.fechamentos.length < base.fechamentos.length || base.fechamentos.some((f) => !clean.fechamentos.some((g) => g.quinzena === f.quinzena))) throw new PmoError("Fechamentos não podem ser desfeitos.");
  return clean;
}

/** Resumo das diferenças para o histórico do planejamento. */
export function describeLoteadoraChange(prev: LoteadoraState | undefined, next: LoteadoraState | undefined): string[] {
  const a = prev ?? EMPTY_LOTEADORA, b = next ?? EMPTY_LOTEADORA;
  const out: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(a.ficha, b.ficha) || a.vgv !== b.vgv || a.metaMargem !== b.metaMargem) out.push("Ficha do empreendimento atualizada");
  if (!same(a.trechos, b.trechos)) out.push(`Trechos: ${b.trechos.length}`);
  if (!same(a.lotes, b.lotes)) out.push(`Lotes: ${b.lotes.length}`);
  if (!same(a.processos, b.processos)) out.push(`Radar regulatório atualizado (${b.processos.length} processo(s))`);
  if (!same(a.cartorio, b.cartorio)) out.push(b.cartorio ? `Registro em cartório: decreto de ${b.cartorio.decretoEm}${b.cartorio.registradoEm ? `, registrado em ${b.cartorio.registradoEm}` : ""}` : "Registro em cartório removido");
  if (!same(a.parametros, b.parametros)) out.push("Parâmetros regulatórios alterados");
  if (!same(a.equipe, b.equipe)) out.push(`Equipe e papéis: ${b.equipe.length} pessoa(s)`);
  if (!same(a.solicitacoes, b.solicitacoes)) {
    const antes = new Map(a.solicitacoes.map((s) => [s.id, s]));
    for (const s of b.solicitacoes) {
      const o = antes.get(s.id);
      if (!o) out.push(`Alçada ${s.id} aberta: ${s.titulo}`);
      else if (s.decisoes.length > o.decisoes.length) {
        const d = s.decisoes.at(-1)!;
        out.push(`Alçada ${s.id}: ${d.acao === "aprovar" ? "aprovada" : d.acao === "devolver" ? "devolvida" : "reprovada"} na etapa ${d.etapa} por ${d.nome}${d.justificativa ? ` — ${d.justificativa}` : ""}`);
      } else if (s.reenvios.length > o.reenvios.length) out.push(`Alçada ${s.id} reenviada por ${s.reenvios.at(-1)!.por}`);
    }
  }
  if (!same(a.etapas, b.etapas)) out.push(`Orçamento por etapa: ${b.etapas.length} etapa(s)`);
  const diff = (k: "frentes" | "diarios" | "rncs" | "boletins" | "fornecedores" | "cotacoes" | "pranchas", rotulo: string) => {
    if (!same(a[k], b[k])) out.push(`${rotulo}: ${b[k].length}`);
  };
  diff("frentes", "Frentes por trecho");
  if (b.diarios.length > a.diarios.length) out.push(`Diário de obra de ${b.diarios.at(-1)!.data} por ${b.diarios.at(-1)!.por}`);
  else diff("diarios", "Diários de obra");
  diff("rncs", "RNCs");
  diff("boletins", "Boletins de medição");
  diff("fornecedores", "Fornecedores homologados");
  diff("cotacoes", "Cotações");
  diff("pranchas", "Pranchas");
  if (a.inicioDiario !== b.inicioDiario || a.limiteChuvaMm !== b.limiteChuvaMm || a.retencaoPct !== b.retencaoPct) out.push("Parâmetros de campo alterados");
  const ca = a.comercial ?? { reservas: [], propostas: [], vendas: [] }, cb = b.comercial ?? { reservas: [], propostas: [], vendas: [] };
  if (!same(ca.tabela, cb.tabela)) out.push(cb.tabela ? `Tabela de vendas publicada em ${cb.tabela.publicadaEm} por ${cb.tabela.publicadaPor}` : "Tabela de vendas removida");
  if (cb.reservas.length > ca.reservas.length) out.push(`Reserva ${cb.reservas.at(-1)!.id} do lote ${cb.reservas.at(-1)!.loteId}`);
  if (cb.propostas.length > ca.propostas.length) out.push(`Proposta ${cb.propostas.at(-1)!.id} do lote ${cb.propostas.at(-1)!.loteId}`);
  if (cb.vendas.length > ca.vendas.length) out.push(`Compromisso de compra e venda ${cb.vendas.at(-1)!.id} do lote ${cb.vendas.at(-1)!.loteId}`);
  else if (!same(ca, cb)) out.push("Comercial atualizado");
  if ((b.fechamentos?.length ?? 0) > (a.fechamentos?.length ?? 0)) out.push(`Quinzena de ${b.fechamentos.at(-1)!.quinzena} fechada por ${b.fechamentos.at(-1)!.por}`);
  if (!same(a.plantios, b.plantios)) out.push(`Plantio compensatório: ${b.plantios?.length ?? 0} TCRA(s)`);
  if (!same(a.chuvaDecisoes, b.chuvaDecisoes)) out.push("Dias de chuva decididos");
  if (!same(a.garantias ?? [], b.garantias ?? [])) out.push(`Garantias de terceiros: ${b.garantias?.length ?? 0}`);
  if (!same(a.caucao, b.caucao)) out.push(b.caucao ? `Caução junto à Prefeitura (${b.caucao.termo}) atualizada` : "Caução removida");
  if (b.reforecasts.length > a.reforecasts.length) out.push(`Reforecast de ${b.reforecasts.at(-1)!.mes} congelado por ${b.reforecasts.at(-1)!.por}`);
  return out;
}

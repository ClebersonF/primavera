import { PmoError } from "../errors";
import { cleanFicha, cleanLote, cleanTrecho, MAX_LOTES, MAX_TRECHOS, type FichaEmpreendimento, type Lote, type Trecho } from "./cadastro";
import { cleanCartorio, cleanParametros, cleanProcesso, MAX_PROCESSOS, type Cartorio, type ParametrosRegulatorios, type ProcessoRegulatorio } from "./regulatorio";
import { cleanMembro, cleanSolicitacao, MAX_EQUIPE, MAX_SOLICITACOES, type Membro, type Solicitacao } from "./alcadas";
import { cleanEtapa, cleanSnapshot, MAX_ETAPAS, MAX_SNAPSHOTS, type EtapaOrcamento, type SnapshotReforecast } from "./reforecast";
import { isObj, nonNeg } from "./common";

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
}

export const EMPTY_LOTEADORA: LoteadoraState = Object.freeze({ ficha: {}, trechos: [], lotes: [], processos: [], equipe: [], solicitacoes: [], etapas: [], reforecasts: [] }) as LoteadoraState;

function uniqueBy<T extends { id: string }>(list: T[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of list) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
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
  };
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
export function updateLoteadora(atual: LoteadoraState | undefined, muda: (s: LoteadoraState) => LoteadoraState): LoteadoraState {
  const base = atual ?? EMPTY_LOTEADORA;
  const next = muda(base);
  const clean = cleanLoteadora(next);
  if (!clean) throw new PmoError("Dados da loteadora inválidos.");
  const contar = (x: LoteadoraState) => [x.trechos.length, x.lotes.length, x.processos.length, x.equipe.length, x.solicitacoes.length, x.etapas.length, x.reforecasts.length, x.cartorio ? 1 : 0].join(",");
  if (contar(clean) !== contar(next)) throw new PmoError("Algum item ficou inválido ou repetido (id em dobro, data ou valor fora do formato). Nada foi gravado.");
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
  if (b.reforecasts.length > a.reforecasts.length) out.push(`Reforecast de ${b.reforecasts.at(-1)!.mes} congelado por ${b.reforecasts.at(-1)!.por}`);
  return out;
}

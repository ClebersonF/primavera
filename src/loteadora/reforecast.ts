import { DEFAULT_CALENDAR, isWorkDay, type WorkCalendar } from "../cpm/calendar";
import { PmoError } from "../errors";
import { addDays, isObj, nonNeg, optText, text, type Nivel } from "./common";

/**
 * Módulo 5 — Orçado × Reforecast × Realizado por etapa (documento, seções 1 e 3.3).
 * O reforecast é fotografado e congelado a cada mês (fechamento até o 5º dia útil do mês seguinte);
 * um mês congelado não se reescreve: corrige-se no mês seguinte.
 */

export interface EtapaOrcamento {
  id: string;
  nome: string;
  /** Orçamento base (R$). */
  orcado: number;
  /** Atividades do cronograma da etapa: o realizado soma os pagamentos feitos nelas. */
  atividades: string[];
}

export interface SnapshotReforecast {
  /** AAAA-MM */
  mes: string;
  congeladoEm: string;
  por: string;
  /** Custo previsto ao término, por etapa (R$). */
  valores: Record<string, number>;
  nota?: string;
}

export const MAX_ETAPAS = 120;
export const MAX_SNAPSHOTS = 60;
export const isMes = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function cleanEtapa(v: unknown): EtapaOrcamento | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 40), nome = text(v.nome, 120);
  if (!id || !nome || !nonNeg(v.orcado)) return null;
  const atividades = (Array.isArray(v.atividades) ? v.atividades : []).filter((a): a is string => typeof a === "string" && a.length > 0 && a.length <= 60).slice(0, 300);
  return { id, nome, orcado: v.orcado, atividades: [...new Set(atividades)] };
}

export function cleanSnapshot(v: unknown): SnapshotReforecast | null {
  if (!isObj(v) || !isMes(v.mes) || typeof v.congeladoEm !== "string" || Number.isNaN(Date.parse(v.congeladoEm))) return null;
  const por = text(v.por, 100);
  if (!por || !isObj(v.valores)) return null;
  const valores: Record<string, number> = {};
  for (const [k, n] of Object.entries(v.valores)) if (k.length <= 40 && k !== "__proto__" && nonNeg(n)) valores[k] = n;
  const s: SnapshotReforecast = { mes: v.mes, congeladoEm: v.congeladoEm, por, valores };
  const nota = optText(v.nota, 300);
  if (nota) s.nota = nota;
  return s;
}

/** Congela o reforecast do mês. Um mês já congelado é recusado. */
export function congelarReforecast(lista: readonly SnapshotReforecast[], snap: SnapshotReforecast): SnapshotReforecast[] {
  const c = cleanSnapshot(snap);
  if (!c) throw new PmoError("Reforecast inválido: mês AAAA-MM, responsável e valores maiores ou iguais a zero.");
  if (lista.some((s) => s.mes === c.mes)) throw new PmoError(`O reforecast de ${c.mes} já foi congelado. Ajustes entram no mês seguinte.`);
  return [...lista, c].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-MAX_SNAPSHOTS);
}

/** 5º dia útil do mês seguinte ao mês de referência. */
export function prazoFechamento(mes: string, cal: WorkCalendar = DEFAULT_CALENDAR): string {
  if (!isMes(mes)) throw new PmoError("Mês inválido.");
  const [y, m] = mes.split("-").map(Number) as [number, number];
  let d = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10);
  let n = 0;
  for (let i = 0; i < 40; i++) {
    if (isWorkDay(d, cal)) n++;
    if (n === 5) return d;
    d = addDays(d, 1);
  }
  return d;
}

export interface LinhaReforecast {
  etapa: EtapaOrcamento;
  orcado: number;
  /** Último reforecast congelado; sem nenhum, o orçado. */
  reforecast: number;
  realizado: number;
  /** (reforecast − orçado) ÷ orçado; null se orçado = 0. */
  desvio: number | null;
  nivel: Nivel;
  /** Realizado ÷ reforecast. */
  consumido: number | null;
}

export interface ResumoReforecast {
  linhas: LinhaReforecast[];
  totalOrcado: number;
  totalReforecast: number;
  totalRealizado: number;
  desvioTotal: number | null;
  nivelTotal: Nivel;
  mesReforecast: string | null;
  /** (VGV − custo total reforecast) ÷ VGV; null sem VGV. */
  margemBruta: number | null;
  metaMargem: number | null;
}

/** Desvio de custo: até +3% verde, de +3% a +5% amarelo, acima de +5% vermelho (matriz 6.1). Economia é verde. */
export function nivelDesvio(desvio: number | null): Nivel {
  if (desvio === null || desvio <= 0.03) return "verde";
  return desvio <= 0.05 ? "amarelo" : "vermelho";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function compararReforecast(
  etapas: readonly EtapaOrcamento[],
  snapshots: readonly SnapshotReforecast[],
  realizadoPorAtividade: Readonly<Record<string, number>>,
  vgv?: number,
  metaMargem?: number,
): ResumoReforecast {
  const ultimo = snapshots.at(-1) ?? null;
  const linhas = etapas.map((etapa): LinhaReforecast => {
    const reforecast = ultimo && Object.prototype.hasOwnProperty.call(ultimo.valores, etapa.id) ? ultimo.valores[etapa.id]! : etapa.orcado;
    const realizado = r2(etapa.atividades.reduce((s, a) => s + (Object.prototype.hasOwnProperty.call(realizadoPorAtividade, a) ? realizadoPorAtividade[a]! : 0), 0));
    const desvio = etapa.orcado > 0 ? (reforecast - etapa.orcado) / etapa.orcado : null;
    return { etapa, orcado: etapa.orcado, reforecast, realizado, desvio, nivel: nivelDesvio(desvio), consumido: reforecast > 0 ? realizado / reforecast : null };
  });
  const totalOrcado = r2(linhas.reduce((s, l) => s + l.orcado, 0));
  const totalReforecast = r2(linhas.reduce((s, l) => s + l.reforecast, 0));
  const totalRealizado = r2(linhas.reduce((s, l) => s + l.realizado, 0));
  const desvioTotal = totalOrcado > 0 ? (totalReforecast - totalOrcado) / totalOrcado : null;
  return {
    linhas, totalOrcado, totalReforecast, totalRealizado, desvioTotal, nivelTotal: nivelDesvio(desvioTotal), mesReforecast: ultimo?.mes ?? null,
    margemBruta: vgv && vgv > 0 ? (vgv - totalReforecast) / vgv : null,
    metaMargem: metaMargem ?? null,
  };
}

export function nextEtapaId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, p) => Math.max(m, Number(/^ET-(\d+)$/.exec(p.id)?.[1] ?? 0)), 0);
  return `ET-${String(n + 1).padStart(2, "0")}`;
}

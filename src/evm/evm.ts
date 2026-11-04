import { PmoError } from "../errors";

/** Atividade (folha da EAP) com o necessário para o valor agregado. */
export interface EvmActivity {
  id: string;
  /** Custo planejado em BRL. */
  plannedCost: number;
  /** Dias úteis desde o início; fim exclusivo. */
  start: number;
  finish: number;
  /** 0..100 */
  percentComplete: number;
}

export interface EvmInput {
  activities: readonly EvmActivity[];
  /** Dia útil (desde o início) em que se mede o desempenho. */
  asOfDay: number;
  /** Custo real acumulado (BRL). Sem ele, os índices de custo ficam indisponíveis. */
  actualCost?: number | null;
}

export type ScheduleStatus = "adiantado" | "no_prazo" | "atrasado" | "sem_base";

export interface EvmResult {
  asOfDay: number;
  /** Orçamento no término. */
  bac: number;
  /** Valor planejado. */
  pv: number;
  /** Valor agregado. */
  ev: number;
  ac: number | null;
  /** EV − PV */
  sv: number;
  spi: number | null;
  cv: number | null;
  cpi: number | null;
  eac: number | null;
  etc: number | null;
  vac: number | null;
  tcpi: number | null;
  status: ScheduleStatus;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** PV/EV/AC e índices SPI/CPI/EAC/ETC/VAC/TCPI. PV distribui o custo linearmente dentro de cada atividade. */
export function computeEvm(input: EvmInput): EvmResult {
  const { activities, asOfDay } = input;
  if (!Number.isFinite(asOfDay) || asOfDay < 0) throw new PmoError("EVM: dia de medição inválido.");
  let bac = 0;
  let pv = 0;
  let ev = 0;
  for (const a of activities) {
    if (!(a.plannedCost >= 0) || !(a.percentComplete >= 0 && a.percentComplete <= 100) || a.finish < a.start) {
      throw new PmoError(`EVM: atividade "${a.id}" com custo, percentual ou datas inválidos.`);
    }
    const dur = a.finish - a.start;
    const planned = dur === 0 ? (asOfDay >= a.start ? 1 : 0) : clamp01((asOfDay - a.start) / dur);
    bac += a.plannedCost;
    pv += a.plannedCost * planned;
    ev += (a.plannedCost * a.percentComplete) / 100;
  }
  bac = r2(bac);
  pv = r2(pv);
  ev = r2(ev);

  const ac = input.actualCost ?? null;
  if (ac !== null && !(ac >= 0)) throw new PmoError("EVM: custo real inválido.");
  const spi = pv > 0 ? r2(ev / pv) : null;
  const cpi = ac !== null && ac > 0 ? r2(ev / ac) : null;
  const eac = ac !== null && cpi !== null && cpi > 0 ? r2(bac / (ev / ac)) : null;
  // Sem valor planejado, mas já com trabalho concluído: à frente do plano (SPI indefinido).
  const status: ScheduleStatus =
    spi === null ? (pv === 0 && ev > 0 ? "adiantado" : "sem_base") : spi < 0.95 ? "atrasado" : spi > 1.05 ? "adiantado" : "no_prazo";

  return {
    asOfDay,
    bac,
    pv,
    ev,
    ac,
    sv: r2(ev - pv),
    spi,
    cv: ac !== null ? r2(ev - ac) : null,
    cpi,
    eac,
    etc: eac !== null && ac !== null ? r2(eac - ac) : null,
    vac: eac !== null ? r2(bac - eac) : null,
    tcpi: ac !== null && bac - ac > 0 ? r2((bac - ev) / (bac - ac)) : null,
    status,
  };
}

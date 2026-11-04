import { DEFAULT_CALENDAR, workDayDates, type WorkCalendar } from "../cpm/calendar";
import { PmoError } from "../errors";
import { fromCents, nonNegativeCents } from "../money";

/** Atividade com custo previsto e realizado, no intervalo [start, finish) em dias úteis do projeto. */
export interface CashFlowItem {
  id: string;
  start: number;
  finish: number;
  /** Custo previsto (BRL). */
  cost: number;
  /** Custo realizado até agora (BRL); ausente = não informado. */
  actual?: number;
}

export interface CashFlowProject {
  id: string;
  /** Programa (ausente = "Sem programa", tratado por quem chama). */
  program?: string;
  /** Início do projeto (YYYY-MM-DD). */
  startDate: string;
  calendar?: WorkCalendar;
  items: readonly CashFlowItem[];
}

export interface CashFlowMonth {
  /** YYYY-MM */
  month: string;
  planned: number;
  actual: number;
  plannedCumulative: number;
  actualCumulative: number;
  /** Mês posterior ao da data de referência: o realizado ainda não existe. */
  future: boolean;
}

export interface CashFlow {
  months: CashFlowMonth[];
  totalPlanned: number;
  totalActual: number;
}

const monthOf = (iso: string) => iso.slice(0, 7);
const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

type Cents = Map<string, { planned: number; actual: number }>;

function add(map: Cents, month: string, key: "planned" | "actual", cents: number) {
  const cur = map.get(month) ?? { planned: 0, actual: 0 };
  cur[key] += cents;
  map.set(month, cur);
}

/** Espalha `cents` por `days` (centavos inteiros, sem perda) e soma por mês. */
function spread(map: Cents, days: readonly string[], cents: number, key: "planned" | "actual") {
  if (cents === 0 || days.length === 0) return;
  const base = Math.floor(cents / days.length);
  const rem = cents % days.length;
  days.forEach((d, i) => add(map, monthOf(d), key, base + (i < rem ? 1 : 0)));
}

function project(p: CashFlowProject, asOf: string, map: Cents) {
  let horizon = 0;
  for (const it of p.items) {
    if (!Number.isInteger(it.start) || !Number.isInteger(it.finish) || it.start < 0 || it.finish < it.start) {
      throw new PmoError(`Fluxo de caixa: intervalo inválido na atividade ${it.id} do projeto ${p.id}.`);
    }
    horizon = Math.max(horizon, it.finish > it.start ? it.finish : it.start + 1);
  }
  if (horizon === 0) return;
  const days = workDayDates(p.startDate, horizon, p.calendar ?? DEFAULT_CALENDAR);
  for (const it of p.items) {
    const planned = nonNegativeCents(it.cost, `Custo previsto da atividade ${it.id}`);
    const window = it.finish > it.start ? days.slice(it.start, it.finish) : [days[it.start]!];
    spread(map, window, planned, "planned");
    if (it.actual !== undefined) {
      const actual = nonNegativeCents(it.actual, `Custo realizado da atividade ${it.id}`);
      // Premissa: o realizado se distribui uniformemente pelos dias úteis previstos até a data de referência;
      // se a atividade ainda não começou no calendário, vai para o dia de referência.
      const upTo = window.filter((d) => d <= asOf);
      spread(map, upTo.length > 0 ? upTo : [asOf], actual, "actual");
    }
  }
}

function finish(map: Cents, asOf: string): CashFlow {
  if (map.size === 0) return { months: [], totalPlanned: 0, totalActual: 0 };
  const keys = [...map.keys()].sort();
  const months: CashFlowMonth[] = [];
  let pc = 0;
  let ac = 0;
  for (let m = keys[0]!; m <= keys[keys.length - 1]!; m = nextMonth(m)) {
    const v = map.get(m) ?? { planned: 0, actual: 0 };
    pc += v.planned;
    ac += v.actual;
    months.push({ month: m, planned: fromCents(v.planned), actual: fromCents(v.actual), plannedCumulative: fromCents(pc), actualCumulative: fromCents(ac), future: m > monthOf(asOf) });
  }
  return { months, totalPlanned: fromCents(pc), totalActual: fromCents(ac) };
}

/** Fluxo de caixa mensal consolidado (previsto × realizado) de vários projetos, com meses sem movimento preenchidos. */
export function consolidateCashFlow(projects: readonly CashFlowProject[], asOf: string): CashFlow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new PmoError(`Data de referência inválida: ${asOf}`);
  const map: Cents = new Map();
  for (const p of projects) project(p, asOf, map);
  return finish(map, asOf);
}

/** Um fluxo por programa (nome em `programOf`, "Sem programa" para ausente), em ordem alfabética com o grupo sem programa por último. */
export function cashFlowByProgram(projects: readonly CashFlowProject[], asOf: string, noProgram = "Sem programa"): { program: string; flow: CashFlow }[] {
  const groups = new Map<string, CashFlowProject[]>();
  for (const p of projects) {
    const key = p.program?.trim() || noProgram;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === noProgram ? 1 : b === noProgram ? -1 : a.localeCompare(b, "pt-BR")))
    .map(([program, list]) => ({ program, flow: consolidateCashFlow(list, asOf) }));
}

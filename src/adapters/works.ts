import { DEFAULT_CALENDAR, workDaysBetween, type WorkCalendar } from "../cpm/calendar";
import { addDaysIso, toLocalDate } from "../dates";
import type { WbsNodeInput } from "../wbs/wbs";

/**
 * Adaptador entre as Obras do Gestor de Galpões e a EAP. Tipos estruturais, para não depender
 * do app: qualquer `Work` do projeto é atribuível a `WorkLike`.
 */
export interface ActivityLike {
  id: string;
  title: string;
  status: "todo" | "doing" | "done" | "blocked";
  /** ISO (data ou data-hora). */
  dueDate?: string;
  completedAt?: string;
  /** Se informado, vale sobre a duração derivada das datas. */
  durationDays?: number;
  /** Se informado, substitui a dependência assumida em sequência. */
  predecessorIds?: string[];
}

export interface WorkLike {
  id: string;
  title: string;
  kickoffAt?: string;
  createdAt: string;
  budgetBRL?: number;
  activities: ActivityLike[];
}

export interface WorkSchedule {
  /** Data de início usada como dia 0 (YYYY-MM-DD). */
  startDate: string;
  inputs: WbsNodeInput[];
  /** Premissas adotadas por falta de dados; mostre ao usuário. */
  assumptions: string[];
}

const PERCENT: Record<ActivityLike["status"], number> = { todo: 0, doing: 50, done: 100, blocked: 0 };

const dateOnly = (iso: string) => toLocalDate(iso);

/**
 * Converte uma obra em EAP. Sem dados explícitos, as atividades formam uma sequência (FS) na ordem
 * da lista, a duração sai das datas (conclusão ou prazo) e o orçamento é rateado pela duração.
 * Cada premissa vira uma linha em `assumptions`.
 */
export function workToWbsInputs(
  work: WorkLike,
  cal: WorkCalendar = DEFAULT_CALENDAR,
): WorkSchedule {
  const startDate = dateOnly(work.kickoffAt ?? work.createdAt);
  const assumptions: string[] = [];
  if (work.kickoffAt === undefined) assumptions.push("Sem kickoff: o cronograma começa na data de criação da obra.");
  if (work.activities.length === 0) {
    assumptions.push("A obra ainda não tem atividades.");
    return { startDate, inputs: [], assumptions };
  }

  const rootId = `work:${work.id}`;
  let prevFinish = 0;
  let chained = false;
  let guessedPercent = false;

  const durations = work.activities.map((a) => {
    let dur: number;
    // Prazo planejado = dueDate. A conclusão só substitui quando não há prazo; usá-la como plano
    // esconderia o atraso (uma tarefa concluída tarde pareceria dentro do prazo).
    const end = a.dueDate ?? a.completedAt;
    if (a.durationDays === undefined && a.dueDate === undefined && a.completedAt !== undefined) {
      assumptions.push(`"${a.title}": sem prazo planejado; a data de conclusão foi usada como prazo (atraso não é medido).`);
    }
    if (a.durationDays !== undefined) {
      dur = a.durationDays;
    } else if (end !== undefined) {
      const finish = workDaysBetween(startDate, addDaysIso(dateOnly(end), 1), cal);
      dur = finish - prevFinish;
      if (dur < 1) {
        dur = 1;
        assumptions.push(`"${a.title}": data fora da ordem da lista; duração assumida em 1 dia útil.`);
      }
    } else {
      dur = 1;
      assumptions.push(`"${a.title}": sem data nem duração; assumido 1 dia útil.`);
    }
    prevFinish += dur;
    return dur;
  });

  // Rateio do orçamento pela duração, em centavos, com o resto na última atividade.
  const budgetCents = Math.round((work.budgetBRL ?? 0) * 100);
  const totalWeight = durations.reduce((s, d) => s + d, 0);
  const costs: number[] = [];
  let allocated = 0;
  durations.forEach((d, i) => {
    const isLast = i === durations.length - 1;
    const share = isLast
      ? budgetCents - allocated
      : Math.floor((budgetCents * (totalWeight === 0 ? 1 : d)) / (totalWeight === 0 ? durations.length : totalWeight));
    allocated += share;
    costs.push(share / 100);
  });
  if (budgetCents > 0) assumptions.push("Custo: o orçamento da obra foi rateado pela duração das atividades.");

  const leaves: WbsNodeInput[] = work.activities.map((a, i) => {
    let predecessors: WbsNodeInput["predecessors"];
    if (a.predecessorIds !== undefined) {
      predecessors = a.predecessorIds.map((id) => ({ id }));
    } else if (i > 0) {
      predecessors = [{ id: work.activities[i - 1]!.id }];
      chained = true;
    }
    if (a.status === "doing") guessedPercent = true;
    return {
      id: a.id,
      parentId: rootId,
      name: a.title,
      duration: durations[i]!,
      plannedCost: costs[i]!,
      percentComplete: PERCENT[a.status],
      predecessors,
    };
  });
  if (chained) assumptions.push("Dependências assumidas em sequência, na ordem da lista de atividades.");
  if (guessedPercent) assumptions.push('Progresso: "Em execução" conta como 50%.');

  return { startDate, inputs: [{ id: rootId, parentId: null, name: work.title }, ...leaves], assumptions };
}

import { workDaysBetween, type WorkCalendar } from "../cpm/calendar";
import { DEFAULT_CALENDAR } from "../cpm/calendar";

export interface DeadlineInput {
  id: string;
  /** Último dia de trabalho previsto (YYYY-MM-DD). */
  finishDate: string;
  /** "Terminar até" (YYYY-MM-DD). */
  deadline?: string;
  /** Término real, se a atividade já terminou. */
  actualFinish?: string;
}

export interface DeadlineCheck {
  id: string;
  deadline: string;
  /** Data comparada com o prazo: o término real, se houver; senão, o previsto. */
  finishDate: string;
  basis: "real" | "previsto";
  /** Dias úteis entre o término e o prazo: positivo = sobra; 0 = no limite; negativo = atraso. */
  slackDays: number;
  violated: boolean;
}

/**
 * "Terminar até" no estilo do Primavera (restrição Finish On or Before): não move a atividade,
 * só mostra a folga até o prazo e marca a violação. Atividades sem prazo são ignoradas.
 */
export function deadlineChecks(items: readonly DeadlineInput[], cal: WorkCalendar = DEFAULT_CALENDAR): DeadlineCheck[] {
  const out: DeadlineCheck[] = [];
  for (const it of items) {
    if (!it.deadline) continue;
    const basis = it.actualFinish ? "real" : "previsto";
    const finishDate = it.actualFinish ?? it.finishDate;
    const slackDays = finishDate <= it.deadline ? workDaysBetween(finishDate, it.deadline, cal) : -workDaysBetween(it.deadline, finishDate, cal);
    out.push({ id: it.id, deadline: it.deadline, finishDate, basis, slackDays, violated: finishDate > it.deadline });
  }
  return out;
}

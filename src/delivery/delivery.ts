import { addDaysIso, parseIsoDate } from "../dates";
import { PmoError } from "../errors";
import { fromCents, toCents } from "../money";

/**
 * Compromisso de entrega das obras de infraestrutura ao comprador do lote e tolerância contratual.
 * Fonte: conversa compartilhada do Gemini (05/11/2026) sobre a Lei do Distrato (Lei 13.786/2018) em loteamentos.
 * O texto de origem é de IA e CITA ARTIGOS que não conferem com a lei (p. ex. atribui à Lei 6.766 dispositivos da
 * Lei 4.591): trate 180 dias, 0,5% ao mês e 60 dias como PARÂMETROS EDITÁVEIS e valide a cláusula, o prazo e as
 * penalidades com o jurídico antes de usá-los em contrato ou em decisão.
 */
export interface DeliveryCommitment {
  /** Data prevista de entrega das obras (TVO/aceite da Prefeitura) assumida no contrato, YYYY-MM-DD. */
  date: string;
  /** Tolerância contratual em dias corridos (0 = sem cláusula de tolerância). */
  toleranceDays: number;
  /** Atividade/marco que representa a entrega (p. ex. o TVO); ausente = término do cronograma. */
  activityId?: string;
}

export const DEFAULT_TOLERANCE_DAYS = 180;
export const MAX_TOLERANCE_DAYS = 365;
/** Indenização mensal sobre o valor pago, após a tolerância, se o comprador mantiver o contrato (padrão da fonte). */
export const DEFAULT_DELAY_INDEMNITY_MONTHLY = 0.005;

export function validateDeliveryCommitment(c: DeliveryCommitment): void {
  parseIsoDate(c.date);
  if (c.activityId !== undefined && (typeof c.activityId !== "string" || c.activityId.length === 0 || c.activityId.length > 200)) throw new PmoError("Atividade de entrega inválida.");
  if (!Number.isInteger(c.toleranceDays) || c.toleranceDays < 0 || c.toleranceDays > MAX_TOLERANCE_DAYS) {
    throw new PmoError(`Tolerância deve ser um número inteiro de 0 a ${MAX_TOLERANCE_DAYS} dias corridos.`);
  }
}

export type DeliveryStatus = "no_prazo" | "em_tolerancia" | "estourado";

export interface DeliveryAssessment {
  status: DeliveryStatus;
  committed: string;
  /** Último dia coberto pela tolerância. */
  toleranceLimit: string;
  projected: string;
  /** Dias corridos de atraso sobre a data comprometida (0 se adiantado). */
  daysLate: number;
  /** Dias corridos além da tolerância (0 se dentro). */
  daysBeyondTolerance: number;
}

const days = (from: string, to: string) => Math.round((parseIsoDate(to) - parseIsoDate(from)) / 86_400_000);

/** Compara o término projetado das obras com o compromisso e a tolerância. */
export function assessDelivery(c: DeliveryCommitment, projectedEnd: string): DeliveryAssessment {
  validateDeliveryCommitment(c);
  const toleranceLimit = addDaysIso(c.date, c.toleranceDays);
  const late = Math.max(0, days(c.date, projectedEnd));
  const beyond = Math.max(0, days(toleranceLimit, projectedEnd));
  return {
    status: beyond > 0 ? "estourado" : late > 0 ? "em_tolerancia" : "no_prazo",
    committed: c.date,
    toleranceLimit,
    projected: projectedEnd,
    daysLate: late,
    daysBeyondTolerance: beyond,
  };
}

/** Indenização proporcional (pro rata de 30 dias) sobre o valor pago, para os dias além da tolerância. */
export function delayIndemnity(paidAmount: number, daysBeyondTolerance: number, monthlyRate = DEFAULT_DELAY_INDEMNITY_MONTHLY): number {
  const paid = toCents(paidAmount, "valor pago");
  if (paid < 0) throw new PmoError("Valor pago não pode ser negativo.");
  if (!Number.isInteger(daysBeyondTolerance) || daysBeyondTolerance < 0) throw new PmoError("Dias de atraso devem ser um inteiro ≥ 0.");
  if (!Number.isFinite(monthlyRate) || monthlyRate < 0 || monthlyRate > 1) throw new PmoError("Taxa mensal deve estar entre 0 e 1.");
  return fromCents(Math.round((paid * monthlyRate * daysBeyondTolerance) / 30));
}

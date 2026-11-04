import { PmoError } from "../errors";
import { fromCents, toCents } from "../money";

export const CONTRACT_STATUSES = ["rascunho", "vigente", "encerrado"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const PAYMENT_STATUSES = ["previsto", "pago"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const MAX_CONTRACTS = 100;
export const MAX_PAYMENTS = 1000;

/** Contrato ou compromisso de compra ligado a atividades do projeto. */
export interface Contract {
  id: string;
  name: string;
  supplier?: string;
  /** Valor contratado (BRL), antes das ordens de mudança. */
  value: number;
  status: ContractStatus;
  /** Atividades atendidas; o valor vigente é repartido igualmente entre elas na planilha de custos. */
  activityIds?: string[];
  signedOn?: string;
}

/** Pagamento (ou desembolso previsto) de um contrato, com data. */
export interface Payment {
  id: string;
  contractId: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  status: PaymentStatus;
  note?: string;
}

export interface ContractDelta {
  contractId: string;
  delta: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const safeId = (v: unknown): v is string => typeof v === "string" && v !== "" && v.length <= 40 && !["__proto__", "constructor", "prototype"].includes(v);
const validDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
};
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12;
const text = (v: unknown, max: number): string | undefined | null => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > max) return null;
  const t = v.trim();
  return t === "" ? undefined : t;
};

export function cleanContract(v: unknown): Contract | null {
  if (!isObj(v) || !safeId(v.id)) return null;
  const name = text(v.name, 120);
  const supplier = text(v.supplier, 120);
  if (!name || supplier === null || !money(v.value)) return null;
  if (typeof v.status !== "string" || !(CONTRACT_STATUSES as readonly string[]).includes(v.status)) return null;
  const c: Contract = { id: v.id, name, value: Math.round(v.value * 100) / 100, status: v.status as ContractStatus };
  if (supplier) c.supplier = supplier;
  if (v.signedOn !== undefined && v.signedOn !== "") {
    if (!validDate(v.signedOn)) return null;
    c.signedOn = v.signedOn;
  }
  if (v.activityIds !== undefined) {
    if (!Array.isArray(v.activityIds) || v.activityIds.length > 200) return null;
    const ids: string[] = [];
    for (const a of v.activityIds) {
      if (!safeId(a)) return null;
      if (!ids.includes(a)) ids.push(a);
    }
    if (ids.length > 0) c.activityIds = ids;
  }
  return c;
}

export function cleanPayment(v: unknown): Payment | null {
  if (!isObj(v) || !safeId(v.id) || !safeId(v.contractId) || !validDate(v.date) || !money(v.amount) || v.amount <= 0) return null;
  if (typeof v.status !== "string" || !(PAYMENT_STATUSES as readonly string[]).includes(v.status)) return null;
  const note = text(v.note, 200);
  if (note === null) return null;
  const p: Payment = { id: v.id, contractId: v.contractId, date: v.date, amount: Math.round(v.amount * 100) / 100, status: v.status as PaymentStatus };
  if (note) p.note = note;
  return p;
}

export function cleanContractDeltas(v: unknown): ContractDelta[] | undefined | null {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: ContractDelta[] = [];
  for (const d of v) {
    if (!isObj(d) || !safeId(d.contractId) || typeof d.delta !== "number" || !Number.isFinite(d.delta) || Math.abs(d.delta) > 1e12) return null;
    if (d.delta !== 0) out.push({ contractId: d.contractId, delta: Math.round(d.delta * 100) / 100 });
  }
  return out.length ? out : undefined;
}

export interface ContractSummary {
  contract: Contract;
  /** Ordens de mudança aprovadas que alteram o valor. */
  adjustments: number;
  /** Valor vigente = contratado + ajustes aprovados. */
  current: number;
  paid: number;
  /** Pagamentos ainda previstos. */
  scheduled: number;
  /** Vigente − pago − previsto; negativo = pagamentos acima do valor vigente. */
  balance: number;
  overCommitted: boolean;
}

/** Situação financeira de cada contrato; `approvedDeltas` vêm das ordens de mudança aprovadas. */
export function summarizeContracts(contracts: readonly Contract[], payments: readonly Payment[], approvedDeltas: readonly ContractDelta[] = []): ContractSummary[] {
  return contracts.map((contract) => {
    const adj = approvedDeltas.filter((d) => d.contractId === contract.id).reduce((s, d) => s + toCents(d.delta), 0);
    const cents = (st: PaymentStatus) => payments.filter((p) => p.contractId === contract.id && p.status === st).reduce((s, p) => s + toCents(p.amount), 0);
    const current = toCents(contract.value) + adj;
    const paid = cents("pago");
    const scheduled = cents("previsto");
    return { contract, adjustments: fromCents(adj), current: fromCents(current), paid: fromCents(paid), scheduled: fromCents(scheduled), balance: fromCents(current - paid - scheduled), overCommitted: current - paid - scheduled < 0 };
  });
}

/** Compromisso por atividade: valor vigente de contratos não encerrados repartido igualmente entre as atividades ligadas. */
export function commitmentsByActivity(summaries: readonly ContractSummary[]): Map<string, number> {
  const cents = new Map<string, number>();
  for (const s of summaries) {
    const ids = s.contract.activityIds ?? [];
    if (ids.length === 0 || s.contract.status === "rascunho") continue;
    const total = toCents(s.current);
    const base = Math.floor(total / ids.length);
    const rem = total - base * ids.length;
    ids.forEach((id, i) => cents.set(id, (cents.get(id) ?? 0) + base + (i < rem ? 1 : 0)));
  }
  return new Map([...cents].map(([k, v]) => [k, fromCents(v)]));
}

/** Pagamentos realizados por atividade (valor pago do contrato repartido como o compromisso). */
export function paidByActivity(summaries: readonly ContractSummary[]): Map<string, number> {
  const cents = new Map<string, number>();
  for (const s of summaries) {
    const ids = s.contract.activityIds ?? [];
    if (ids.length === 0) continue;
    const total = toCents(s.paid);
    const base = Math.floor(total / ids.length);
    const rem = total - base * ids.length;
    ids.forEach((id, i) => cents.set(id, (cents.get(id) ?? 0) + base + (i < rem ? 1 : 0)));
  }
  return new Map([...cents].map(([k, v]) => [k, fromCents(v)]));
}

export function validatePayment(contracts: readonly Contract[], p: Payment): void {
  if (!contracts.some((c) => c.id === p.contractId)) throw new PmoError(`Pagamento ${p.id}: contrato ${p.contractId} não existe.`);
}

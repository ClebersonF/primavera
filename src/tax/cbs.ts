import { PmoError } from "../errors";
import { fromCents, nonNegativeCents, toCents } from "../money";

/**
 * CBS no Lucro Presumido, regime não cumulativo (débito de saída − crédito de entrada).
 * Base: "Estudo de Impacto Tributário: CBS na Engenharia Agronômica e PaaS B2B".
 *
 * ATENÇÃO: as alíquotas do estudo (11,3% padrão e 30% de redução para profissão
 * regulamentada) são ESTIMADAS. Elas são parâmetros de `CbsConfig`; valide com o contador
 * antes de usar em faturamento real. A base de cálculo é o valor do item SEM a CBS ("por fora").
 */
export type RevenueKind = "servico_engenharia" | "licenca_software";

export interface CbsConfig {
  /** Alíquota padrão (0..1). */
  standardRate: number;
  /** Redução de alíquota por tipo de receita (0..1). 0,3 = 30%. */
  reduction: Record<RevenueKind, number>;
}

export const DEFAULT_CBS_CONFIG: CbsConfig = {
  standardRate: 0.113,
  reduction: { servico_engenharia: 0.3, licenca_software: 0 },
};

function assertConfig(cfg: CbsConfig): void {
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (!ok(cfg.standardRate)) throw new PmoError(`Alíquota padrão inválida: ${cfg.standardRate}`);
  for (const [k, v] of Object.entries(cfg.reduction)) {
    if (!ok(v)) throw new PmoError(`Redução inválida para ${k}: ${v}`);
  }
}

/** Alíquota efetiva = padrão × (1 − redução), arredondada em 6 casas. 11,3% com 30% → 7,91%. */
export function effectiveRate(kind: RevenueKind, cfg: CbsConfig = DEFAULT_CBS_CONFIG): number {
  assertConfig(cfg);
  if (!Object.hasOwn(cfg.reduction, kind)) throw new PmoError(`Tipo de receita desconhecido: ${String(kind)}`);
  const reduction = cfg.reduction[kind];
  return Math.round(cfg.standardRate * (1 - reduction) * 1e6) / 1e6;
}

export interface RevenueItem {
  description?: string;
  kind: RevenueKind;
  /** Valor do item sem CBS (BRL). */
  amount: number;
}

export interface RevenueLine {
  description?: string;
  kind: RevenueKind;
  base: number;
  rate: number;
  cbs: number;
}

export function cbsOnRevenue(items: readonly RevenueItem[], cfg: CbsConfig = DEFAULT_CBS_CONFIG) {
  let baseCents = 0;
  let cbsCents = 0;
  const lines: RevenueLine[] = items.map((it) => {
    const b = nonNegativeCents(it.amount, "Valor do item de receita");
    const rate = effectiveRate(it.kind, cfg);
    const c = Math.round(b * rate);
    baseCents += b;
    cbsCents += c;
    return { description: it.description, kind: it.kind, base: fromCents(b), rate, cbs: fromCents(c) };
  });
  return { lines, totalBase: fromCents(baseCents), totalCbs: fromCents(cbsCents) };
}

export type PurchaseCategory =
  | "cloud"
  | "software"
  | "api"
  | "utilidades"
  | "aluguel"
  | "combustivel"
  | "manutencao_frota"
  | "equipamento_campo"
  | "laudos_analises"
  | "folha_clt"
  | "pro_labore"
  | "rpa_autonomo"
  | "uso_pessoal"
  | "outro";

const CREDITABLE: ReadonlySet<PurchaseCategory> = new Set([
  "cloud",
  "software",
  "api",
  "utilidades",
  "aluguel",
  "combustivel",
  "manutencao_frota",
  "equipamento_campo",
  "laudos_analises",
]);

const NO_CBS: ReadonlySet<PurchaseCategory> = new Set(["folha_clt", "pro_labore", "rpa_autonomo"]);

export interface Purchase {
  description?: string;
  category: PurchaseCategory;
  /** CBS destacada na nota fiscal do fornecedor (BRL). */
  cbsDestacada: number;
  /** Fornecedor é pessoa jurídica no regime regular de CBS. */
  supplierIsRegularPJ: boolean;
  /** Para a categoria "outro": vínculo comprovado com a atividade-fim. */
  linkedToActivity?: boolean;
}

export interface PurchaseCredit {
  description?: string;
  category: PurchaseCategory;
  credit: number;
  allowed: boolean;
  /** Motivo quando não há crédito. */
  reason?: string;
}

export function creditFor(p: Purchase): PurchaseCredit {
  const cents = nonNegativeCents(p.cbsDestacada, "CBS destacada");
  const deny = (reason: string): PurchaseCredit => ({
    description: p.description,
    category: p.category,
    credit: 0,
    allowed: false,
    reason,
  });
  if (NO_CBS.has(p.category)) return deny("Sem crédito: folha, pró-labore e autônomos (RPA) não geram crédito de CBS");
  if (p.category === "uso_pessoal") return deny("Sem crédito: despesa de uso ou consumo pessoal");
  if (!p.supplierIsRegularPJ) return deny("Sem crédito: o fornecedor não é pessoa jurídica no regime regular");
  if (p.category === "outro" && p.linkedToActivity !== true) {
    return deny("Sem crédito: despesa sem vínculo comprovado com a atividade-fim");
  }
  if (!CREDITABLE.has(p.category) && p.category !== "outro") return deny("Sem crédito: categoria não reconhecida");
  if (cents === 0) return deny("Sem crédito: nota sem CBS destacada");
  return { description: p.description, category: p.category, credit: fromCents(cents), allowed: true };
}

export type CbsPosition = "a_pagar" | "saldo_credor" | "zero";

export interface CbsAssessment {
  revenue: RevenueLine[];
  purchases: PurchaseCredit[];
  debit: number;
  credit: number;
  /** Débito − crédito. */
  balance: number;
  /** max(0, saldo). */
  payable: number;
  /** Crédito excedente a transportar. */
  carryForward: number;
  position: CbsPosition;
}

/** Apuração mensal: débito sobre as receitas menos crédito das compras elegíveis. */
export function assessCbs(
  items: readonly RevenueItem[],
  purchases: readonly Purchase[],
  cfg: CbsConfig = DEFAULT_CBS_CONFIG,
): CbsAssessment {
  const rev = cbsOnRevenue(items, cfg);
  const credits = purchases.map(creditFor);
  const debitC = toCents(rev.totalCbs);
  const creditC = credits.reduce((acc, c) => acc + toCents(c.credit), 0);
  const balanceC = debitC - creditC;
  return {
    revenue: rev.lines,
    purchases: credits,
    debit: rev.totalCbs,
    credit: fromCents(creditC),
    balance: fromCents(balanceC),
    payable: fromCents(Math.max(0, balanceC)),
    carryForward: fromCents(Math.max(0, -balanceC)),
    position: balanceC > 0 ? "a_pagar" : balanceC < 0 ? "saldo_credor" : "zero",
  };
}

/**
 * Separa um contrato único em duas linhas de NF-e (serviço de engenharia e licença de software),
 * conforme a fatia de serviço acordada em aditivo. Sem perda de centavos.
 */
export function splitInvoice(
  totalBase: number,
  engineeringShare: number,
  cfg: CbsConfig = DEFAULT_CBS_CONFIG,
) {
  if (!Number.isFinite(engineeringShare) || engineeringShare < 0 || engineeringShare > 1) {
    throw new PmoError(`A fatia de engenharia deve estar entre 0 e 1 (recebido: ${engineeringShare})`);
  }
  const totalC = nonNegativeCents(totalBase, "Valor total do contrato");
  const serviceC = Math.round(totalC * engineeringShare);
  const result = cbsOnRevenue(
    [
      { description: "Serviços de engenharia agronômica", kind: "servico_engenharia", amount: fromCents(serviceC) },
      { description: "Licença e assinatura de software (PaaS)", kind: "licenca_software", amount: fromCents(totalC - serviceC) },
    ],
    cfg,
  );
  return {
    ...result,
    /** CBS total / base total; 0 se a base for 0. */
    blendedRate: totalC === 0 ? 0 : toCents(result.totalCbs) / totalC,
  };
}

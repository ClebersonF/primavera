import { PmoError } from "../errors";
import { fromCents, nonNegativeCents } from "../money";

export type CostPhase = "projeto" | "obra";

export interface DirectCost {
  name: string;
  amount: number;
  /** "projeto" = gasto durante o prazo de projeto/licenciamento; "obra" = durante a obra. */
  phase: CostPhase;
}

/** Custo indireto: valor fixo, ou percentual sobre o VGV (um dos dois). */
export interface IndirectCost {
  name: string;
  amount?: number;
  rateOfVgv?: number;
}

export interface FeasibilityInput {
  /** m² brutos da gleba. */
  grossArea: number;
  /** Fração cedida (ruas, áreas verdes e institucionais), 0..1. */
  cessionRate: number;
  /** Tamanho médio do lote (m²). */
  avgLotSize: number;
  /** Preço de venda por m² vendável (R$). */
  pricePerSqm: number;
  landCost: number;
  directCosts: DirectCost[];
  indirectCosts: IndirectCost[];
  /** Imposto sobre o lucro bruto (a planilha usa 20% para IRPJ + CSLL); 0..1. */
  profitTaxRate: number;
  /** Prazos em meses. As vendas começam no fim da obra, salvo `salesStartMonth`. */
  months: { project: number; works: number; sales: number };
  /** Mês (a partir de 0) em que as vendas começam; padrão = projeto + obra. */
  salesStartMonth?: number;
  /** Taxa de desconto anual para o VPL (ex.: 0,12). */
  annualDiscountRate: number;
}

export interface CashMonth {
  month: number;
  out: number;
  in: number;
  net: number;
  cumulative: number;
}

export interface FeasibilityResult {
  netArea: number;
  lots: number;
  pricePerLot: number;
  vgv: number;
  directTotal: number;
  indirectTotal: number;
  costTotal: number;
  grossProfit: number;
  /** Lucro bruto ÷ VGV. */
  grossMargin: number;
  profitTax: number;
  netProfit: number;
  /** Lucro líquido ÷ custo total. */
  returnOnCost: number;
  /** Lotes a vender para cobrir o custo total. */
  breakEvenLots: number;
  breakEvenShare: number;
  cashFlow: CashMonth[];
  /** Maior valor acumulado negativo (necessidade máxima de caixa), positivo. */
  peakExposure: number;
  /** Primeiro mês em que o caixa acumulado volta a ser positivo; null se nunca. */
  paybackMonth: number | null;
  /** TIR anual equivalente; null se o fluxo não troca de sinal. */
  irrAnnual: number | null;
  npv: number;
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function check(i: FeasibilityInput) {
  const pos = (n: number, name: string) => {
    if (!Number.isFinite(n) || n <= 0) throw new PmoError(`${name} deve ser maior que zero.`);
  };
  pos(i.grossArea, "Área bruta");
  pos(i.avgLotSize, "Tamanho médio do lote");
  pos(i.pricePerSqm, "Preço por m²");
  if (!(Number.isFinite(i.cessionRate) && i.cessionRate >= 0 && i.cessionRate < 1)) throw new PmoError("Cedências devem ficar entre 0% e 100% (exclusive).");
  if (!(Number.isFinite(i.profitTaxRate) && i.profitTaxRate >= 0 && i.profitTaxRate < 1)) throw new PmoError("Imposto sobre o lucro deve ficar entre 0% e 100%.");
  if (!Number.isFinite(i.annualDiscountRate) || i.annualDiscountRate <= -1) throw new PmoError("Taxa de desconto inválida.");
  nonNegativeCents(i.landCost, "Custo do terreno");
  for (const c of i.directCosts) {
    nonNegativeCents(c.amount, `Custo "${c.name}"`);
    if (c.phase !== "projeto" && c.phase !== "obra") throw new PmoError(`Fase inválida em "${c.name}".`);
  }
  for (const c of i.indirectCosts) {
    if ((c.amount === undefined) === (c.rateOfVgv === undefined)) throw new PmoError(`Custo indireto "${c.name}": informe o valor ou o percentual do VGV (um só).`);
    if (c.amount !== undefined) nonNegativeCents(c.amount, `Custo "${c.name}"`);
    else if (!(Number.isFinite(c.rateOfVgv!) && c.rateOfVgv! >= 0 && c.rateOfVgv! < 1)) throw new PmoError(`Percentual inválido em "${c.name}".`);
  }
  const { project, works, sales } = i.months;
  for (const [n, v] of [["projeto", project], ["obra", works], ["vendas", sales]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 360) throw new PmoError(`Prazo de ${n}: inteiro de 0 a 360 meses.`);
  }
  if (sales < 1) throw new PmoError("O prazo de vendas deve ter ao menos 1 mês.");
  if (i.salesStartMonth !== undefined && (!Number.isInteger(i.salesStartMonth) || i.salesStartMonth < 0)) throw new PmoError("Mês de início das vendas inválido.");
}

/**
 * TIR mensal: varre as taxas de 0 a 200% ao mês (e, se não achar, de 0 a -20%) e refina por bisecção a primeira troca de sinal
 * do VPL. Fluxos com custos depois da receita podem ter várias raízes; vale a de menor taxa em módulo. Null se não houver.
 */
export function irrMonthly(flows: readonly number[]): number | null {
  const npv = (r: number) => flows.reduce((s, f, t) => s + f / (1 + r) ** t, 0);
  const scan = (dir: 1 | -1, steps: number): number | null => {
    let prevR = 0;
    let prev = npv(0);
    if (prev === 0) return 0;
    for (let k = 1; k <= steps; k++) {
      const r = dir * k * 0.001;
      const cur = npv(r);
      if (prev * cur < 0) {
        let lo = Math.min(prevR, r);
        let hi = Math.max(prevR, r);
        const flo = npv(lo);
        for (let i = 0; i < 100; i++) {
          const mid = (lo + hi) / 2;
          if (npv(mid) * flo < 0) hi = mid;
          else lo = mid;
        }
        return (lo + hi) / 2;
      }
      prevR = r;
      prev = cur;
    }
    return null;
  };
  return scan(1, 2000) ?? scan(-1, 200);
}

/** Viabilidade de loteamento: resultado, indicadores e fluxo de caixa mensal com TIR e VPL. */
export function evaluateFeasibility(input: FeasibilityInput): FeasibilityResult {
  check(input);
  const netArea = input.grossArea * (1 - input.cessionRate);
  const lots = netArea / input.avgLotSize;
  const pricePerLot = input.avgLotSize * input.pricePerSqm;
  const vgv = netArea * input.pricePerSqm;
  const directTotal = input.directCosts.reduce((s, c) => s + c.amount, 0);
  const indirect = input.indirectCosts.map((c) => ({ ...c, value: c.amount ?? vgv * (c.rateOfVgv ?? 0) }));
  const indirectTotal = indirect.reduce((s, c) => s + c.value, 0);
  const costTotal = input.landCost + directTotal + indirectTotal;
  const grossProfit = vgv - costTotal;
  const profitTax = Math.max(0, grossProfit) * input.profitTaxRate;
  const netProfit = grossProfit - profitTax;

  const { project, works, sales } = input.months;
  const salesStart = input.salesStartMonth ?? project + works;
  const total = Math.max(project + works, salesStart + sales);
  const out = new Array<number>(total).fill(0);
  const inn = new Array<number>(total).fill(0);
  out[0]! += input.landCost;
  const spread = (amount: number, from: number, n: number) => {
    const span = Math.max(1, n);
    for (let k = 0; k < span; k++) out[Math.min(total - 1, from + k)]! += amount / span;
  };
  for (const c of input.directCosts) {
    if (c.phase === "projeto") spread(c.amount, 0, project);
    else spread(c.amount, project, works);
  }
  // Custos comerciais e impostos acompanham as vendas; o imposto sobre o lucro, também.
  for (const c of indirect) spread(c.value, salesStart, sales);
  spread(profitTax, salesStart, sales);
  for (let k = 0; k < sales; k++) inn[salesStart + k]! += vgv / sales;

  let cum = 0;
  let peak = 0;
  let payback: number | null = null;
  const cashFlow: CashMonth[] = out.map((o, month) => {
    const net = inn[month]! - o;
    cum += net;
    if (-cum > peak) peak = -cum;
    if (payback === null && month > 0 && cum >= 0 && peak > 0) payback = month;
    return { month, out: r2(o), in: r2(inn[month]!), net: r2(net), cumulative: r2(cum) };
  });
  const flows = out.map((o, m) => inn[m]! - o);
  const irrM = irrMonthly(flows);
  const monthlyRate = (1 + input.annualDiscountRate) ** (1 / 12) - 1;
  const npv = flows.reduce((s, f, t) => s + f / (1 + monthlyRate) ** t, 0);

  const warnings: string[] = [];
  if (input.cessionRate > 0.45) warnings.push(`Cedências de ${(input.cessionRate * 100).toFixed(1).replace(".", ",")}% estão acima do usual; confirme com o projeto urbanístico e a exigência municipal.`);
  if (grossProfit / vgv > 0.5) warnings.push("Margem bruta acima de 50%: confira preço por m² e custos; o resultado costuma ficar bem abaixo disso.");
  if (input.profitTaxRate > 0 && input.profitTaxRate < 0.1) warnings.push("Imposto sobre o lucro baixo: loteamentos costumam ser tributados sobre a receita (RET ou lucro presumido); confirme o regime com a contabilidade.");
  if (salesStart < project + works) warnings.push("As vendas começam antes do fim da obra: o fluxo supõe que a receita já cobre custos nesse período.");

  return {
    netArea: r2(netArea),
    lots: r2(lots),
    pricePerLot: r2(pricePerLot),
    vgv: r2(vgv),
    directTotal: fromCents(nonNegativeCents(directTotal, "Custo direto")),
    indirectTotal: r2(indirectTotal),
    costTotal: r2(costTotal),
    grossProfit: r2(grossProfit),
    grossMargin: vgv > 0 ? grossProfit / vgv : 0,
    profitTax: r2(profitTax),
    netProfit: r2(netProfit),
    returnOnCost: costTotal > 0 ? netProfit / costTotal : 0,
    breakEvenLots: r2(costTotal / pricePerLot),
    breakEvenShare: lots > 0 ? costTotal / pricePerLot / lots : 0,
    cashFlow,
    peakExposure: r2(peak),
    paybackMonth: payback,
    irrAnnual: irrM === null ? null : (1 + irrM) ** 12 - 1,
    npv: r2(npv),
    warnings,
  };
}

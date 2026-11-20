import { PmoError } from "../errors";

/**
 * Comparação de enquadramentos tributários (Simples Nacional × Lucro Presumido × Lucro Real) para empresa de SERVIÇOS,
 * já com a transição da Reforma Tributária do Consumo (CBS/IBS).
 *
 * É SIMULAÇÃO para apoiar a conversa com a contabilidade, não parecer nem apuração. Simplificações assumidas:
 *  - ano em regime constante: a receita dos últimos 12 meses é a receita anual informada;
 *  - só serviços (presunção de 32%; anexos III/V do Simples); sem ICMS, exportação, retenções nem benefícios fiscais;
 *  - FGTS, IRRF e INSS do empregado ficam de fora (iguais em todos os regimes);
 *  - no Lucro Real, o lucro tributável é informado como % da receita.
 * Parâmetros legais conferidos em 20/11/2026 (ver docs/ENQUADRAMENTO-TRIBUTARIO.md); todos editáveis em `RegimeParams`.
 */

export type RegimeYear = 2026 | 2027 | 2033;
export type RegimeId = "simples" | "presumido" | "real";

export interface RegimeInput {
  /** Receita bruta anual de serviços (R$). */
  revenue: number;
  /** Salários de 12 meses dos empregados (CLT), sem encargos patronais (R$). */
  payrollClt: number;
  /** Pró-labore de 12 meses dos sócios (R$). */
  proLabore: number;
  /** Compras anuais de bens e serviços que geram crédito de CBS/IBS (ou de PIS/COFINS no Lucro Real), sem o imposto (R$). */
  creditablePurchases: number;
  /** Lucro tributável estimado no Lucro Real, como fração da receita (0..1). */
  realProfitMargin: number;
  /** Fração da receita vendida a empresas que aproveitam o crédito de CBS/IBS (0..1). */
  b2bShare: number;
  /** Alíquota de ISS do município para o serviço (0.02 a 0.05). */
  issRate: number;
  year: RegimeYear;
  /** O Simples Nacional está ao alcance da empresa neste ano? Use `simplesWindow` para decidir. */
  simplesAvailable: boolean;
}

export interface RegimeParams {
  /** CBS cobrada em 2027 (alíquota de referência menos 0,1 p.p.). TCU calculou 11,3% em 28/10/2026; Senado ainda não fixou. */
  cbs2027: number;
  /** IBS de teste em 2027 e 2028 (0,05% estadual + 0,05% municipal). */
  ibs2027: number;
  /** CBS e IBS no regime pleno (2033). Estimativa NÃO oficial citada como do Comitê Gestor do IBS. */
  cbsFull: number;
  ibsFull: number;
  /** Contribuição patronal sobre a folha CLT fora do Simples: 20% + RAT + terceiros. */
  employerClt: number;
  /** Contribuição patronal sobre o pró-labore fora do Simples. */
  employerProLabore: number;
}

export const DEFAULT_REGIME_PARAMS: RegimeParams = Object.freeze({
  cbs2027: 0.112,
  ibs2027: 0.001,
  cbsFull: 0.0921,
  ibsFull: 0.187,
  employerClt: 0.268,
  employerProLabore: 0.2,
});

/** Anexos III e V do Simples Nacional (LC 123/2006): limite da faixa, alíquota nominal e parcela a deduzir. */
const ANEXO_III = [
  [180_000, 0.06, 0], [360_000, 0.112, 9_360], [720_000, 0.135, 17_640],
  [1_800_000, 0.16, 35_640], [3_600_000, 0.21, 125_640], [4_800_000, 0.33, 648_000],
] as const;
const ANEXO_V = [
  [180_000, 0.155, 0], [360_000, 0.18, 4_500], [720_000, 0.195, 9_900],
  [1_800_000, 0.205, 17_100], [3_600_000, 0.23, 62_100], [4_800_000, 0.305, 540_000],
] as const;

export const SIMPLES_LIMIT = 4_800_000;
export const SIMPLES_ISS_SUBLIMIT = 3_600_000;
export const FATOR_R_MIN = 0.28;
const PRESUMPTION_SERVICES = 0.32;
/** LC 224/2025: presunção 10% maior sobre a parcela da receita anual acima de R$ 5 milhões. */
const PRESUMPTION_UPLIFT_FROM = 5_000_000;
const IRPJ_SURTAX_FROM = 240_000;

const r2 = (n: number) => Math.round(n * 100) / 100;
const pos = (n: number) => Math.max(0, n);

export interface RegimeLine { label: string; amount: number }
export interface RegimeScenario {
  id: RegimeId;
  name: string;
  /** false = calculado só para referência; não entra na escolha do melhor. */
  available: boolean;
  unavailableReason?: string;
  lines: RegimeLine[];
  /** Tudo o que a empresa recolhe no ano. */
  total: number;
  /** total / receita. */
  effectiveRate: number;
  /** CBS/IBS destacados que o cliente empresa recupera como crédito (pode ir no preço sem custo para ele). */
  passThrough: number;
  /** total − passThrough: o que fica como custo da empresa se o imposto recuperável for repassado. */
  netBurden: number;
  notes: string[];
}

export interface RegimeComparison {
  scenarios: RegimeScenario[];
  /** Fator R = (folha CLT + pró-labore) / receita. */
  fatorR: number;
  /** Menor carga total entre os disponíveis. */
  lowestTotal: RegimeId | null;
  /** Menor carga líquida (com repasse do imposto recuperável) entre os disponíveis. */
  lowestNet: RegimeId | null;
}

export function validateRegimeInput(i: RegimeInput): void {
  const money: [string, number][] = [["Receita anual", i.revenue], ["Folha CLT", i.payrollClt], ["Pró-labore", i.proLabore], ["Compras com crédito", i.creditablePurchases]];
  for (const [label, v] of money) if (!Number.isFinite(v) || v < 0) throw new PmoError(`${label}: informe um valor maior ou igual a zero.`);
  if (i.revenue <= 0) throw new PmoError("Informe a receita anual para comparar os regimes.");
  if (!Number.isFinite(i.realProfitMargin) || i.realProfitMargin < -1 || i.realProfitMargin > 1) throw new PmoError("Margem de lucro do Lucro Real deve ficar entre -100% e 100%.");
  if (!Number.isFinite(i.b2bShare) || i.b2bShare < 0 || i.b2bShare > 1) throw new PmoError("A parcela vendida a empresas deve ficar entre 0% e 100%.");
  if (!Number.isFinite(i.issRate) || i.issRate < 0.02 || i.issRate > 0.05) throw new PmoError("A alíquota de ISS deve ficar entre 2% e 5%.");
  if (![2026, 2027, 2033].includes(i.year)) throw new PmoError("Ano de simulação não suportado.");
}

/** Alíquota efetiva do Simples: (RBT12 × alíquota − parcela a deduzir) / RBT12. */
export function simplesEffectiveRate(rbt12: number, annex: "III" | "V"): number {
  if (rbt12 <= 0) return 0;
  const table = annex === "III" ? ANEXO_III : ANEXO_V;
  const row = table.find(([limit]) => rbt12 <= limit) ?? table[table.length - 1]!;
  return (rbt12 * row[1] - row[2]) / rbt12;
}

/** IRPJ (15% + adicional de 10% acima de R$ 240 mil/ano) e CSLL (9%) sobre uma base anual. */
function irpjCsll(base: number): { irpj: number; csll: number } {
  const b = pos(base);
  return { irpj: 0.15 * b + 0.1 * pos(b - IRPJ_SURTAX_FROM), csll: 0.09 * b };
}

function consumption(i: RegimeInput, p: RegimeParams, regime: "presumido" | "real"): { lines: RegimeLine[]; passThrough: number; notes: string[] } {
  const lines: RegimeLine[] = [];
  const notes: string[] = [];
  let passThrough = 0;
  if (i.year === 2026) {
    if (regime === "presumido") lines.push({ label: "PIS e COFINS cumulativos (3,65%)", amount: 0.0365 * i.revenue });
    else lines.push({ label: "PIS e COFINS não cumulativos (9,25% menos créditos)", amount: 0.0925 * pos(i.revenue - i.creditablePurchases) });
    lines.push({ label: `ISS (${(i.issRate * 100).toFixed(2).replace(".", ",")}%)`, amount: i.issRate * i.revenue });
    notes.push("2026 é ano de teste: a CBS de 0,9% e o IBS de 0,1% são compensados com PIS/COFINS e não aumentam a carga.");
    return { lines, passThrough, notes };
  }
  const full = i.year === 2033;
  const cbs = full ? p.cbsFull : p.cbs2027;
  const ibs = full ? p.ibsFull : p.ibs2027;
  const debit = (cbs + ibs) * i.revenue;
  const credit = (cbs + ibs) * i.creditablePurchases;
  lines.push({ label: `CBS e IBS sobre a receita (${((cbs + ibs) * 100).toFixed(2).replace(".", ",")}%)`, amount: debit });
  lines.push({ label: "Crédito de CBS e IBS das compras", amount: -Math.min(credit, debit) });
  if (credit > debit) notes.push("Os créditos superam o débito: o excedente fica como saldo credor e não foi contado como ganho.");
  if (!full) lines.push({ label: `ISS (${(i.issRate * 100).toFixed(2).replace(".", ",")}%)`, amount: i.issRate * i.revenue });
  passThrough = debit * i.b2bShare;
  if (full) notes.push("2033: alíquotas plenas ESTIMADAS (não oficiais); ISS, PIS e COFINS já extintos. Entre 2029 e 2032 o ISS cai 10% ao ano e o IBS sobe na mesma proporção.");
  else notes.push("2027: a CBS substitui PIS e COFINS para todos os regimes fora do Simples, com crédito amplo; o ISS continua integral até 2028.");
  return { lines, passThrough, notes };
}

function employer(i: RegimeInput, p: RegimeParams): RegimeLine {
  return { label: "INSS patronal (folha e pró-labore)", amount: p.employerClt * i.payrollClt + p.employerProLabore * i.proLabore };
}

function finish(id: RegimeId, name: string, i: RegimeInput, lines: RegimeLine[], passThrough: number, notes: string[], available: boolean, reason?: string): RegimeScenario {
  const clean = lines.map((l) => ({ label: l.label, amount: r2(l.amount) }));
  const total = r2(clean.reduce((s, l) => s + l.amount, 0));
  const pass = r2(Math.min(passThrough, total));
  return { id, name, available, unavailableReason: reason, lines: clean, total, effectiveRate: total / i.revenue, passThrough: pass, netBurden: r2(total - pass), notes };
}

export function compareRegimes(input: RegimeInput, params: RegimeParams = DEFAULT_REGIME_PARAMS): RegimeComparison {
  validateRegimeInput(input);
  for (const [k, v] of Object.entries(params)) if (!Number.isFinite(v) || v < 0 || v > 1) throw new PmoError(`Parâmetro inválido: ${k}.`);
  const i = input;
  const fatorR = (i.payrollClt + i.proLabore) / i.revenue;

  // Simples Nacional
  const annex = fatorR >= FATOR_R_MIN ? "III" : "V";
  const overLimit = i.revenue > SIMPLES_LIMIT;
  const sLines: RegimeLine[] = [];
  const sNotes: string[] = [];
  if (!overLimit) {
    const eff = simplesEffectiveRate(i.revenue, annex);
    sLines.push({ label: `DAS — Anexo ${annex} (alíquota efetiva ${(eff * 100).toFixed(2).replace(".", ",")}%)`, amount: eff * i.revenue });
    if (i.revenue > SIMPLES_ISS_SUBLIMIT) {
      sLines.push({ label: "ISS fora do DAS (receita acima do sublimite de R$ 3,6 milhões)", amount: i.issRate * i.revenue });
    }
    sNotes.push(annex === "III"
      ? `Fator R de ${(fatorR * 100).toFixed(1).replace(".", ",")}% (a partir de 28%): tributação pelo Anexo III, o mais barato para software e TI.`
      : `Fator R de ${(fatorR * 100).toFixed(1).replace(".", ",")}% (abaixo de 28%): tributação pelo Anexo V. Com folha e pró-labore de ao menos ${Math.ceil(FATOR_R_MIN * i.revenue).toLocaleString("pt-BR")} por ano, passaria ao Anexo III.`);
    sNotes.push("INSS patronal já está dentro do DAS. A empresa não toma crédito de CBS/IBS das compras.");
    if (i.year !== 2026) sNotes.push("O cliente empresa só se credita do IBS/CBS efetivamente pago no DAS (valor pequeno, não calculado aqui). Há a opção semestral de recolher IBS/CBS pelo regime regular, que dá crédito integral ao cliente e não foi simulada.");
    if (i.year === 2033) sNotes.push("Tabelas do Simples de hoje aplicadas a 2033: as alíquotas podem mudar até lá.");
  }
  const simples = finish("simples", "Simples Nacional", i, sLines, 0, sNotes,
    i.simplesAvailable && !overLimit,
    overLimit ? "Receita acima do limite de R$ 4,8 milhões por ano." : i.simplesAvailable ? undefined : "Fora do alcance neste ano (ver situação da opção pelo Simples).");

  // Lucro Presumido
  const base = PRESUMPTION_SERVICES * Math.min(i.revenue, PRESUMPTION_UPLIFT_FROM) + PRESUMPTION_SERVICES * 1.1 * pos(i.revenue - PRESUMPTION_UPLIFT_FROM);
  const pTax = irpjCsll(base);
  const pCons = consumption(i, params, "presumido");
  const pNotes = ["IRPJ e CSLL sobre 32% da receita, qualquer que seja o lucro real: vantajoso quando a margem de lucro supera 32%.", ...pCons.notes];
  if (i.revenue > PRESUMPTION_UPLIFT_FROM) pNotes.push("Receita acima de R$ 5 milhões: presunção de 35,2% sobre o excedente (LC 224/2025).");
  const presumido = finish("presumido", "Lucro Presumido", i,
    [{ label: "IRPJ (15% + adicional de 10%)", amount: pTax.irpj }, { label: "CSLL (9%)", amount: pTax.csll }, ...pCons.lines, employer(i, params)],
    pCons.passThrough, pNotes, i.revenue <= 78_000_000, i.revenue > 78_000_000 ? "Receita acima de R$ 78 milhões: Lucro Real obrigatório." : undefined);

  // Lucro Real
  const profit = i.realProfitMargin * i.revenue;
  const rTax = irpjCsll(profit);
  const rCons = consumption(i, params, "real");
  const rNotes = [`IRPJ e CSLL sobre o lucro tributável informado (${(i.realProfitMargin * 100).toFixed(1).replace(".", ",")}% da receita). Exige contabilidade completa; prejuízo fiscal pode ser compensado nos anos seguintes.`, ...rCons.notes];
  const real = finish("real", "Lucro Real", i,
    [{ label: "IRPJ (15% + adicional de 10%)", amount: rTax.irpj }, { label: "CSLL (9%)", amount: rTax.csll }, ...rCons.lines, employer(i, params)],
    rCons.passThrough, rNotes, true);

  const scenarios = [simples, presumido, real];
  const best = (key: "total" | "netBurden"): RegimeId | null => {
    const ok = scenarios.filter((s) => s.available);
    return ok.length ? ok.reduce((a, b) => (b[key] < a[key] ? b : a)).id : null;
  };
  return { scenarios, fatorR, lowestTotal: best("total"), lowestNet: best("netBurden") };
}

export interface SimplesWindow {
  available: boolean;
  /** Explicação em português, pronta para a tela. */
  message: string;
}

/**
 * A empresa consegue estar no Simples no ano-alvo? Regras da opção conferidas em 20/11/2026 (Receita Federal e Ministério da Fazenda):
 * a opção para 2027 foi de 1º a 30/09/2026; empresas com CNPJ aberto entre 01/10 e 31/12/2026 optam na abertura; a partir daí,
 * a opção é em setembro do ano anterior. O caso "empresa aberta antes de outubro que perdeu setembro" não é tratado
 * expressamente pelas fontes: a conclusão de que só entra no ano seguinte é inferência e deve ser confirmada com o contador.
 */
export function simplesWindow(c: { optant: boolean; openedOn: string; targetYear: number; today: string }): SimplesWindow {
  if (c.optant) return { available: true, message: "Empresa já optante pelo Simples Nacional." };
  const y = c.targetYear;
  if (y <= Number(c.today.slice(0, 4)) && y !== 2027) {
    return { available: false, message: `Empresa não optante em ${y}: o prazo de opção deste ano já passou (para empresa nova, a opção é feita na abertura).` };
  }
  if (y === 2027) {
    if (c.openedOn >= "2026-10-01" && c.openedOn <= "2026-12-31") return { available: true, message: "CNPJ aberto entre 01/10 e 31/12/2026: a opção pelo Simples é feita na abertura e vale para 2027." };
    if (c.today <= "2026-09-30") return { available: true, message: "A opção pelo Simples para 2027 vai de 1º a 30 de setembro de 2026." };
    return { available: false, message: "Não optante, e a janela de opção para 2027 (1º a 30/09/2026) já encerrou. Pelo que as fontes oficiais descrevem, a próxima entrada é em 2028, com pedido em setembro de 2027. Confirme com o contador se há exceção para o seu caso." };
  }
  return { available: true, message: `Possível, desde que a opção seja pedida em setembro de ${y - 1} e a empresa esteja como ME ou EPP, sem pendências.` };
}

/**
 * Quanto falta de folha + pró-labore para o Fator R chegar a 28% (Anexo III) e quanto o DAS cairia.
 * A economia é só do DAS: subir pró-labore custa INSS e IRPF do sócio, que não entram nesta conta.
 */
export function fatorRGap(i: Pick<RegimeInput, "revenue" | "payrollClt" | "proLabore">): { reached: boolean; needed: number; missing: number; dasSaving: number } {
  const needed = r2(FATOR_R_MIN * i.revenue);
  const current = i.payrollClt + i.proLabore;
  const reached = i.revenue > 0 && current / i.revenue >= FATOR_R_MIN;
  if (reached || i.revenue <= 0 || i.revenue > SIMPLES_LIMIT) return { reached, needed, missing: 0, dasSaving: 0 };
  const saving = (simplesEffectiveRate(i.revenue, "V") - simplesEffectiveRate(i.revenue, "III")) * i.revenue;
  return { reached, needed, missing: r2(needed - current), dasSaving: r2(saving) };
}

/** Margem de lucro tributável abaixo da qual o IRPJ/CSLL do Lucro Real fica menor que o do Presumido (serviços). */
export function realBreakEvenMargin(revenue: number): number {
  if (!(revenue > 0)) return PRESUMPTION_SERVICES;
  return (PRESUMPTION_SERVICES * Math.min(revenue, PRESUMPTION_UPLIFT_FROM) + PRESUMPTION_SERVICES * 1.1 * pos(revenue - PRESUMPTION_UPLIFT_FROM)) / revenue;
}

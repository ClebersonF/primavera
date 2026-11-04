import { PmoError } from "../errors";

/** Limiares de alerta (gestão por limiar). Valores são convenções editáveis, não regra normativa. */
export interface ThresholdRules {
  /** SPI abaixo disto gera alerta; abaixo de `spiCritical`, alerta crítico. */
  spiWarn: number;
  spiCritical: number;
  cpiWarn: number;
  cpiCritical: number;
  /** Dias corridos até o prazo: abaixo de `deadlineWarnDays` = atenção; vencido = crítico. */
  deadlineWarnDays: number;
  /** Riscos alto/crítico ativos: a partir de `severeRisksWarn` = atenção, de `severeRisksCritical` = crítico. */
  severeRisksWarn: number;
  severeRisksCritical: number;
  /** Questões vencidas: a partir de `overdueIssuesWarn` = atenção, de `overdueIssuesCritical` = crítico. */
  overdueIssuesWarn: number;
  overdueIssuesCritical: number;
}

export const DEFAULT_THRESHOLDS: ThresholdRules = {
  spiWarn: 0.95,
  spiCritical: 0.8,
  cpiWarn: 0.95,
  cpiCritical: 0.8,
  deadlineWarnDays: 30,
  severeRisksWarn: 1,
  severeRisksCritical: 3,
  overdueIssuesWarn: 1,
  overdueIssuesCritical: 3,
};

export interface ThresholdMetrics {
  spi: number | null;
  cpi: number | null;
  /** Dias corridos até o prazo (negativo = vencido); null = sem prazo. */
  daysToDeadline: number | null;
  severeRisks: number;
  overdueIssues: number;
  /** Atividades com "terminar até" violado. */
  deadlineViolations?: number;
  /** Contratos com pagamentos (realizados + previstos) acima do valor vigente. */
  overCommittedContracts?: number;
}

export type AlertSeverity = "atencao" | "critico";
export type AlertCode = "spi" | "cpi" | "prazo" | "riscos" | "questoes" | "restricoes" | "contratos";

export interface ThresholdAlert {
  code: AlertCode;
  severity: AlertSeverity;
  message: string;
}

export function validateThresholds(r: ThresholdRules): void {
  const nums = Object.values(r);
  if (nums.some((n) => !(Number.isFinite(n) && n >= 0))) throw new PmoError("Limiares devem ser números ≥ 0.");
  if (r.spiCritical > r.spiWarn || r.cpiCritical > r.cpiWarn) throw new PmoError("Limiar crítico de índice não pode ser maior que o de atenção.");
  if (r.severeRisksCritical < r.severeRisksWarn || r.overdueIssuesCritical < r.overdueIssuesWarn) throw new PmoError("Limiar crítico de contagem não pode ser menor que o de atenção.");
}

const idx = (n: number) => n.toFixed(2).replace(".", ",");

/** Avalia as métricas de um projeto contra os limiares e devolve os alertas, críticos primeiro. */
export function evaluateThresholds(m: ThresholdMetrics, rules: ThresholdRules = DEFAULT_THRESHOLDS): ThresholdAlert[] {
  validateThresholds(rules);
  const out: ThresholdAlert[] = [];
  if (m.spi !== null && m.spi < rules.spiWarn) out.push({ code: "spi", severity: m.spi < rules.spiCritical ? "critico" : "atencao", message: `SPI ${idx(m.spi)}: prazo abaixo do planejado` });
  if (m.cpi !== null && m.cpi < rules.cpiWarn) out.push({ code: "cpi", severity: m.cpi < rules.cpiCritical ? "critico" : "atencao", message: `CPI ${idx(m.cpi)}: custo acima do previsto` });
  if (m.daysToDeadline !== null) {
    if (m.daysToDeadline < 0) out.push({ code: "prazo", severity: "critico", message: `Prazo vencido há ${-m.daysToDeadline} dia(s)` });
    else if (m.daysToDeadline <= rules.deadlineWarnDays) out.push({ code: "prazo", severity: "atencao", message: `Faltam ${m.daysToDeadline} dia(s) para o prazo` });
  }
  if (m.severeRisks >= rules.severeRisksWarn && m.severeRisks > 0) out.push({ code: "riscos", severity: m.severeRisks >= rules.severeRisksCritical ? "critico" : "atencao", message: `${m.severeRisks} risco(s) alto/crítico ativo(s)` });
  if (m.overdueIssues >= rules.overdueIssuesWarn && m.overdueIssues > 0) out.push({ code: "questoes", severity: m.overdueIssues >= rules.overdueIssuesCritical ? "critico" : "atencao", message: `${m.overdueIssues} questão(ões) com prazo vencido` });
  if ((m.deadlineViolations ?? 0) > 0) out.push({ code: "restricoes", severity: "critico", message: `${m.deadlineViolations} atividade(s) com “terminar até” violado` });
  if ((m.overCommittedContracts ?? 0) > 0) out.push({ code: "contratos", severity: "critico", message: `${m.overCommittedContracts} contrato(s) com pagamentos acima do valor vigente` });
  return out.sort((a, b) => Number(b.severity === "critico") - Number(a.severity === "critico"));
}

/** Lê limiares salvos (JSON de origem desconhecida): campos ausentes usam o padrão; inválido devolve null. */
export function parseThresholds(raw: unknown): ThresholdRules | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out = { ...DEFAULT_THRESHOLDS };
  for (const k of Object.keys(DEFAULT_THRESHOLDS) as (keyof ThresholdRules)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100_000) return null;
    out[k] = v;
  }
  try {
    validateThresholds(out);
  } catch {
    return null;
  }
  return out;
}

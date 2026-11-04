export const NO_PROGRAM = "Sem programa";

export interface ProgramInput {
  program?: string;
  budget: number;
  pv: number;
  ev: number;
  /** Índice de impacto 0..1; null/ausente = não avaliado. */
  impact?: number | null;
  hectares?: number;
  beneficiaries?: number;
  tco2e?: number;
  /** Alertas críticos do projeto. */
  criticalAlerts?: number;
}

export interface ProgramRollup {
  program: string;
  projects: number;
  budget: number;
  pv: number;
  ev: number;
  /** SPI do programa = ΣEV/ΣPV; null sem valor planejado. */
  spi: number | null;
  /** Média simples do impacto dos projetos avaliados; null se nenhum. */
  impact: number | null;
  assessed: number;
  hectares: number;
  beneficiaries: number;
  tco2e: number;
  criticalAlerts: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Consolida projetos por programa (nível acima do projeto, como a EPS do Primavera). Programas em ordem alfabética; "Sem programa" por último. */
export function rollupPrograms(items: readonly ProgramInput[]): ProgramRollup[] {
  const map = new Map<string, ProgramInput[]>();
  for (const i of items) {
    const key = i.program?.trim() || NO_PROGRAM;
    map.set(key, [...(map.get(key) ?? []), i]);
  }
  const rollups = [...map.entries()].map(([program, list]): ProgramRollup => {
    const sum = (f: (i: ProgramInput) => number) => list.reduce((t, i) => t + f(i), 0);
    const assessed = list.filter((i) => typeof i.impact === "number");
    const pv = sum((i) => i.pv);
    const ev = sum((i) => i.ev);
    return {
      program,
      projects: list.length,
      budget: r2(sum((i) => i.budget)),
      pv: r2(pv),
      ev: r2(ev),
      spi: pv > 0 ? Math.round((ev / pv) * 100) / 100 : null,
      impact: assessed.length ? assessed.reduce((t, i) => t + (i.impact as number), 0) / assessed.length : null,
      assessed: assessed.length,
      hectares: sum((i) => i.hectares ?? 0),
      beneficiaries: sum((i) => i.beneficiaries ?? 0),
      tco2e: sum((i) => i.tco2e ?? 0),
      criticalAlerts: sum((i) => i.criticalAlerts ?? 0),
    };
  });
  return rollups.sort((a, b) => (a.program === NO_PROGRAM ? 1 : b.program === NO_PROGRAM ? -1 : a.program.localeCompare(b.program, "pt-BR")));
}

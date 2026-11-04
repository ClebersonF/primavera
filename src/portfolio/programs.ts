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
  /** Responsável pelo projeto (nó da estrutura organizacional). */
  owner?: string;
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

export const PROGRAM_SEPARATOR = ">";
export const MAX_PROGRAM_DEPTH = 5;
export const MAX_PROGRAM_PATH_LENGTH = 120;

/** Normaliza um caminho de programa ("A > B > C"): níveis aparados, sem níveis vazios; devolve null se passar dos limites. */
export function normalizeProgramPath(raw: string): string | null {
  const levels = raw.split(PROGRAM_SEPARATOR).map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => l !== "");
  if (levels.length > MAX_PROGRAM_DEPTH) return null;
  const path = levels.join(` ${PROGRAM_SEPARATOR} `);
  return path.length > MAX_PROGRAM_PATH_LENGTH ? null : path;
}

export const programLevels = (path: string): string[] => path.split(PROGRAM_SEPARATOR).map((l) => l.trim()).filter((l) => l !== "");

/** O projeto de caminho `program` está dentro do nó `node` (o próprio nó ou um descendente)? */
export function inProgram(program: string | undefined, node: string): boolean {
  if (!node) return true;
  const a = programLevels(program ?? "");
  const b = programLevels(node);
  return b.length <= a.length && b.every((l, i) => a[i] === l);
}

export interface ProgramTreeRow extends ProgramRollup {
  /** Caminho completo do nó ("A > B"). */
  path: string;
  /** Último nível. */
  label: string;
  depth: number;
  /** Projetos ligados diretamente a este nó (sem contar descendentes). */
  direct: number;
  /** Responsáveis dos projetos do nó e de seus descendentes. */
  owners: string[];
}

/** Estrutura corporativa em árvore (EPS): cada nó soma os projetos dele e de todos os descendentes. Ordem em profundidade; "Sem programa" por último. */
export function rollupProgramTree(items: readonly ProgramInput[]): ProgramTreeRow[] {
  const nodes = new Map<string, ProgramInput[]>();
  const direct = new Map<string, number>();
  const unassigned: ProgramInput[] = [];
  for (const i of items) {
    const levels = programLevels(i.program ?? "");
    if (levels.length === 0) {
      unassigned.push(i);
      continue;
    }
    levels.forEach((_, d) => {
      const path = levels.slice(0, d + 1).join(` ${PROGRAM_SEPARATOR} `);
      nodes.set(path, [...(nodes.get(path) ?? []), i]);
    });
    const full = levels.join(` ${PROGRAM_SEPARATOR} `);
    direct.set(full, (direct.get(full) ?? 0) + 1);
  }
  const rows = [...nodes.entries()].map(([path, list]): ProgramTreeRow => {
    const [roll] = rollupPrograms(list.map((i) => ({ ...i, program: path })));
    const levels = programLevels(path);
    return { ...roll!, program: path, path, label: levels.at(-1)!, depth: levels.length - 1, direct: direct.get(path) ?? 0, owners: [...new Set(list.map((i) => i.owner?.trim()).filter((o): o is string => !!o))].sort((a, b) => a.localeCompare(b, "pt-BR")) };
  });
  // Ordem em profundidade: compara nível a nível, pai antes de filho.
  rows.sort((a, b) => {
    const x = programLevels(a.path);
    const y = programLevels(b.path);
    for (let k = 0; k < Math.min(x.length, y.length); k++) {
      const c = x[k]!.localeCompare(y[k]!, "pt-BR");
      if (c !== 0) return c;
    }
    return x.length - y.length;
  });
  if (unassigned.length > 0) {
    const [roll] = rollupPrograms(unassigned);
    rows.push({ ...roll!, program: NO_PROGRAM, path: NO_PROGRAM, label: NO_PROGRAM, depth: 0, direct: unassigned.length, owners: [...new Set(unassigned.map((i) => i.owner?.trim()).filter((o): o is string => !!o))].sort((a, b) => a.localeCompare(b, "pt-BR")) });
  }
  return rows;
}

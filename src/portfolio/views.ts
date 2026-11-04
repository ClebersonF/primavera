/** Visão salva do portfólio: estratégia, nó da EPS filtrado e seções do relatório. */
export const REPORT_SECTIONS = ["alertas", "programas", "fluxo", "impacto", "matriz", "tabela"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const MAX_VIEWS = 30;

export interface SavedView {
  id: string;
  name: string;
  /** Preset de estratégia ou "custom". */
  preset: "padrao" | "impacto" | "custom";
  weights: { nature: number; schedule: number; deadline: number; budget: number; impact: number };
  /** Nó da EPS ("" = todos). */
  program: string;
  sections: ReportSection[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseSavedView(v: unknown): SavedView | null {
  if (!isObj(v) || typeof v.id !== "string" || v.id === "" || v.id.length > 40 || typeof v.name !== "string") return null;
  const name = v.name.trim();
  if (!name || name.length > 60) return null;
  if (v.preset !== "padrao" && v.preset !== "impacto" && v.preset !== "custom") return null;
  if (!isObj(v.weights)) return null;
  const keys = ["nature", "schedule", "deadline", "budget", "impact"] as const;
  const w = {} as SavedView["weights"];
  for (const k of keys) {
    const x = v.weights[k];
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1) return null;
    w[k] = x;
  }
  if (keys.reduce((s, k) => s + w[k], 0) <= 0) return null;
  if (typeof v.program !== "string" || v.program.length > 120) return null;
  if (!Array.isArray(v.sections)) return null;
  const sections = REPORT_SECTIONS.filter((s) => (v.sections as unknown[]).includes(s));
  return { id: v.id, name, preset: v.preset, weights: w, program: v.program, sections };
}

/** Lê a lista salva (JSON de origem desconhecida): descarta entradas inválidas e duplicadas. */
export function parseSavedViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  for (const x of raw.slice(0, MAX_VIEWS)) {
    const v = parseSavedView(x);
    if (v && !out.some((o) => o.id === v.id)) out.push(v);
  }
  return out;
}

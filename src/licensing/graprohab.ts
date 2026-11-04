import type { CpmActivity } from "../cpm";
import { parseIsoDate } from "../dates";
import { PmoError } from "../errors";

/**
 * Modelo de licenciamento GRAPROHAB/CETESB/SEMIL.
 * Fonte: "Manual Completo do GRAPROHAB" (conversa compartilhada do Gemini, 29/10/2026).
 * O texto de origem foi gerado por IA: confirme fluxo, prazos e limites com as normas e o
 * parecer técnico antes de basear decisões ou protocolos nele.
 */

export type GraprohabStepId =
  | "protocolo"
  | "distribuicao"
  | "analise"
  | "comunique_se"
  | "reanalise"
  | "deliberacao"
  | "certificado";

export interface GraprohabStep {
  id: GraprohabStepId;
  name: string;
  owner: string;
  /** Duração padrão em dias úteis. O manual NÃO define prazos de cada etapa: são estimativas editáveis. */
  defaultDays: number;
  /** Só entra no processo quando houver Comunique-se. */
  onlyWithComuniqueSe: boolean;
}

export const GRAPROHAB_STEPS: readonly GraprohabStep[] = [
  { id: "protocolo", name: "Protocolo e triagem inicial", owner: "Empreendedor / GRAPROHAB", defaultDays: 5, onlyWithComuniqueSe: false },
  { id: "distribuicao", name: "Distribuição aos órgãos", owner: "GRAPROHAB", defaultDays: 5, onlyWithComuniqueSe: false },
  { id: "analise", name: "Análise dos órgãos técnicos (CETESB/SEMIL, concessionárias, DAEE, CDHU)", owner: "Órgãos técnicos", defaultDays: 30, onlyWithComuniqueSe: false },
  { id: "comunique_se", name: "Atendimento ao Comunique-se", owner: "Empreendedor", defaultDays: 20, onlyWithComuniqueSe: true },
  { id: "reanalise", name: "Reanálise após resposta", owner: "Órgãos técnicos", defaultDays: 15, onlyWithComuniqueSe: true },
  { id: "deliberacao", name: "Deliberação no colegiado (reunião técnica)", owner: "Colegiado GRAPROHAB", defaultDays: 10, onlyWithComuniqueSe: false },
  { id: "certificado", name: "Emissão do Certificado de Aprovação", owner: "GRAPROHAB", defaultDays: 5, onlyWithComuniqueSe: false },
];

export const GRAPROHAB_PREFIX = "graprohab.";

export interface GraprohabProcessOptions {
  /** Inclui as etapas de Comunique-se e reanálise. Padrão: false. */
  comuniqueSe?: boolean;
  /** Substitui a duração (dias úteis) de etapas específicas. */
  days?: Partial<Record<GraprohabStepId, number>>;
}

/** Gera as atividades do processo, prontas para `scheduleCpm` ou para uma EAP. */
export function buildGraprohabProcess(opts: GraprohabProcessOptions = {}): CpmActivity[] {
  const known = new Set<string>(GRAPROHAB_STEPS.map((s) => s.id));
  for (const [k, v] of Object.entries(opts.days ?? {})) {
    if (!known.has(k)) throw new PmoError(`Etapa GRAPROHAB desconhecida: ${k}`);
    if (!Number.isInteger(v) || (v as number) < 0) throw new PmoError(`Duração inválida para ${k}: ${String(v)}`);
  }
  const steps = GRAPROHAB_STEPS.filter((s) => opts.comuniqueSe === true || !s.onlyWithComuniqueSe);
  return steps.map((s, i) => ({
    id: GRAPROHAB_PREFIX + s.id,
    duration: opts.days?.[s.id] ?? s.defaultDays,
    predecessors: i === 0 ? [] : [{ id: GRAPROHAB_PREFIX + steps[i - 1]!.id }],
  }));
}

/** Prazo do Comunique-se: o manual cita "geralmente até 180 dias" (corridos), renováveis mediante justificativa. */
export function comuniqueSeDeadline(issuedOn: string, calendarDays = 180): string {
  const t = parseIsoDate(issuedOn);
  if (!Number.isInteger(calendarDays) || calendarDays < 0 || calendarDays > 36_500) {
    throw new PmoError(`Prazo inválido (0 a 36500 dias corridos): ${calendarDays}`);
  }
  return new Date(t + calendarDays * 86_400_000).toISOString().slice(0, 10);
}

export interface GraprohabDocument {
  id: string;
  category: string;
  name: string;
  evaluators: string[];
}

export const GRAPROHAB_DOCUMENTS: readonly GraprohabDocument[] = [
  { id: "urbanistico", category: "Urbanístico", name: "Planta urbanística geral (escala adequada, memorial descritivo, divisões)", evaluators: ["Todos", "CDHU", "Prefeitura"] },
  { id: "uso_solo", category: "Municipal", name: "Certidão de uso e ocupação do solo + diretrizes municipais", evaluators: ["Colegiado GRAPROHAB"] },
  { id: "saneamento", category: "Saneamento", name: "Cartas de viabilidade de água e esgoto / projetos das redes", evaluators: ["SABESP", "Concessionária", "CETESB"] },
  { id: "ambiental", category: "Ambiental", name: "Estudo ambiental (EIA/RIMA, RAP ou EAS conforme o porte) + planta de vegetação", evaluators: ["CETESB", "SEMIL"] },
  { id: "areas_contaminadas", category: "Solo", name: "Avaliação ambiental preliminar (áreas contaminadas)", evaluators: ["CETESB"] },
  { id: "planialtimetrico", category: "Recursos hídricos", name: "Levantamento planialtimétrico com demarcação de APPs, nascentes e corpos d'água", evaluators: ["CETESB", "DAEE"] },
  { id: "matricula", category: "Registro", name: "Certidão de matrícula atualizada do imóvel (com ônus e ações)", evaluators: ["Colegiado GRAPROHAB"] },
];

/** Documentos do checklist que ainda não foram apresentados. Ids desconhecidos geram erro (evita typo silencioso). */
export function missingDocuments(presentIds: Iterable<string>): GraprohabDocument[] {
  const known = new Set(GRAPROHAB_DOCUMENTS.map((d) => d.id));
  const present = new Set<string>();
  for (const id of presentIds) {
    if (!known.has(id)) throw new PmoError(`Documento desconhecido no checklist: ${id}`);
    present.add(id);
  }
  return GRAPROHAB_DOCUMENTS.filter((d) => !present.has(d.id));
}

/** Quadro de áreas em m². */
export interface AreaTable {
  total: number;
  lotes: number;
  viario: number;
  verdes: number;
  institucional: number;
  /** Demais áreas, se houver. Padrão: 0. */
  outros?: number;
}

export type AreaField = keyof AreaTable;

export interface AreaIssue {
  kind: "soma" | "divergencia";
  /** Documento onde o problema aparece (ex.: "planta", "memorial", "sabesp"). */
  source: string;
  field: AreaField | "soma";
  expected: number;
  found: number;
}

const AREA_FIELDS: AreaField[] = ["total", "lotes", "viario", "verdes", "institucional", "outros"];

/**
 * Verifica a padronização do quadro de áreas: (1) as parcelas somam o total em cada documento;
 * (2) todos os documentos trazem os mesmos valores do primeiro. Incoerência entre disciplinas é
 * a principal causa de atraso apontada no manual.
 */
export function checkAreaTableConsistency(tables: Record<string, AreaTable>, toleranceSqm = 0.01): AreaIssue[] {
  const entries = Object.entries(tables);
  const issues: AreaIssue[] = [];
  for (const [source, t] of entries) {
    // Campo ausente (JSON incompleto) conta como 0, de forma consistente na soma e na comparação.
    const v = (f: AreaField) => {
      const x = t[f] ?? 0;
      if (!Number.isFinite(x) || x < 0) throw new PmoError(`Área inválida em ${source}.${f}: ${String(x)}`);
      return x;
    };
    for (const f of AREA_FIELDS) v(f);
    const parts = v("lotes") + v("viario") + v("verdes") + v("institucional") + v("outros");
    if (Math.abs(parts - v("total")) > toleranceSqm) {
      issues.push({ kind: "soma", source, field: "soma", expected: v("total"), found: parts });
    }
  }
  const ref = entries[0];
  if (ref) {
    for (const [source, t] of entries.slice(1)) {
      for (const f of AREA_FIELDS) {
        const expected = ref[1][f] ?? 0;
        const found = t[f] ?? 0;
        if (Math.abs(found - expected) > toleranceSqm) {
          issues.push({ kind: "divergencia", source, field: f, expected, found });
        }
      }
    }
  }
  return issues;
}

/**
 * Faixa de APP de curso d'água natural (Lei 12.651/2012, art. 4º, I), em metros, pela largura do leito.
 * Em limites exatos (10, 50, 200, 600 m) adota-se a faixa maior (mais protetora).
 */
export function appBufferMeters(riverWidthM: number): number {
  if (!Number.isFinite(riverWidthM) || riverWidthM < 0) throw new PmoError(`Largura inválida: ${riverWidthM}`);
  if (riverWidthM < 10) return 30;
  if (riverWidthM < 50) return 50;
  if (riverWidthM < 200) return 100;
  if (riverWidthM < 600) return 200;
  return 500;
}

/** Raio mínimo de APP de nascentes e olhos d'água, em metros. */
export const NASCENTE_RADIUS_M = 50;
/** Faixa não edificável mínima junto a rodovias e ferrovias, segundo o manual, em metros. */
export const FAIXA_NAO_EDIFICAVEL_M = 15;

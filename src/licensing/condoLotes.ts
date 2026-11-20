import { parseIsoDate } from "../dates";
import { PmoError } from "../errors";

/**
 * Condomínio de lotes (art. 1.358-A do Código Civil) — parâmetros da lei municipal.
 * Fonte: resumo e checklist gerados pelo Microsoft Copilot (conversa compartilhada, 20/11/2026) sobre a
 * LEI 1.849/2026 do Município de Pedro de Toledo. O texto de origem é de IA e não foi conferido com a lei:
 * os valores abaixo são PADRÕES EDITÁVEIS e cada município tem os seus. Confirme no texto da lei do município
 * do empreendimento antes de protocolar ou de projetar.
 */
export interface CondoLotesRules {
  /** Altura mínima do muro ou alambrado de fechamento, em metros. */
  fenceMinHeightM: number;
  /** Largura mínima da pista de rolamento, em metros. */
  roadMinWidthM: number;
  /** Largura mínima do passeio em cada lado da via, em metros. */
  sidewalkMinWidthM: number;
  /** Diâmetro mínimo do bolsão de retorno das vias sem saída, em metros. */
  culDeSacMinDiameterM: number;
  /** Idade máxima da certidão de matrícula, em dias corridos. */
  registryMaxAgeDays: number;
}

export const CONDO_LOTES_DEFAULT_RULES: CondoLotesRules = Object.freeze({
  fenceMinHeightM: 1.8,
  roadMinWidthM: 7,
  sidewalkMinWidthM: 1.2,
  culDeSacMinDiameterM: 12,
  registryMaxAgeDays: 30,
});

export interface CondoLotesDesign {
  fenceHeightM?: number;
  roadWidthM?: number;
  sidewalkWidthM?: number;
  /** Informe só se houver via sem saída. */
  culDeSacDiameterM?: number;
  /** Data de emissão da certidão de matrícula (YYYY-MM-DD). */
  registryIssuedOn?: string;
  /** Data de referência (hoje) para a idade da certidão. */
  asOf: string;
}

export interface CondoLotesIssue {
  field: "fence" | "road" | "sidewalk" | "culDeSac" | "registry";
  kind: "abaixo_do_minimo" | "matricula_vencida";
  message: string;
  found: number;
  required: number;
}

const fmt = (n: number) => n.toFixed(2).replace(".", ",");

export function validateCondoLotesRules(r: CondoLotesRules): void {
  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1000) throw new PmoError(`Parâmetro inválido em ${k}: ${String(v)}`);
  }
}

/** Confere o projeto contra os mínimos da lei municipal. Campos não informados não geram pendência. */
export function checkCondoLotesDesign(d: CondoLotesDesign, rules: CondoLotesRules = CONDO_LOTES_DEFAULT_RULES): CondoLotesIssue[] {
  validateCondoLotesRules(rules);
  const out: CondoLotesIssue[] = [];
  const min = (field: CondoLotesIssue["field"], found: number | undefined, required: number, label: string) => {
    if (found === undefined) return;
    if (!Number.isFinite(found) || found < 0) throw new PmoError(`${label} inválido: ${String(found)}`);
    if (found < required) out.push({ field, kind: "abaixo_do_minimo", found, required, message: `${label} de ${fmt(found)} m abaixo do mínimo de ${fmt(required)} m` });
  };
  min("fence", d.fenceHeightM, rules.fenceMinHeightM, "Muro/alambrado");
  min("road", d.roadWidthM, rules.roadMinWidthM, "Pista de rolamento");
  min("sidewalk", d.sidewalkWidthM, rules.sidewalkMinWidthM, "Passeio");
  min("culDeSac", d.culDeSacDiameterM, rules.culDeSacMinDiameterM, "Bolsão de retorno");
  if (d.registryIssuedOn !== undefined && d.registryIssuedOn !== "") {
    const age = Math.round((parseIsoDate(d.asOf) - parseIsoDate(d.registryIssuedOn)) / 86_400_000);
    if (age < 0) throw new PmoError("A certidão de matrícula não pode ser emitida depois da data de referência.");
    if (age > rules.registryMaxAgeDays) out.push({ field: "registry", kind: "matricula_vencida", found: age, required: rules.registryMaxAgeDays, message: `Certidão de matrícula com ${age} dias (máximo ${rules.registryMaxAgeDays})` });
  }
  return out;
}

/** Marcos de aprovação do condomínio de lotes (G1–G8), na ordem do processo. */
export const CONDO_LOTES_GATES: readonly { id: string; name: string }[] = [
  { id: "G1", name: "Imóvel regular e compatível com a legislação urbanística" },
  { id: "G2", name: "Projetos técnicos concluídos e ART/RRT emitidas" },
  { id: "G3", name: "Aprovação municipal obtida" },
  { id: "G4", name: "Alvará de infraestrutura emitido" },
  { id: "G5", name: "Infraestrutura executada conforme projeto aprovado" },
  { id: "G6", name: "Habite-se das áreas comuns emitido" },
  { id: "G7", name: "Incorporação registrada em cartório" },
  { id: "G8", name: "Condomínio apto à operação e comercialização" },
];

/** Mínimos por município. A chave é o nome normalizado (sem acento, minúsculo); o valor guarda o nome de exibição. */
export interface MunicipalRulesEntry {
  name: string;
  rules: CondoLotesRules;
  /** Lei ou decreto de onde os valores foram conferidos (texto livre; vazio = não conferido). */
  source: string;
}
export type MunicipalRulesTable = Readonly<Record<string, MunicipalRulesEntry>>;

export const municipalityKey = (name: string): string =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toLowerCase();

/** Cadastra ou atualiza os mínimos de um município, sem alterar a tabela original. */
export function withMunicipalRules(table: MunicipalRulesTable, name: string, rules: CondoLotesRules, source = ""): MunicipalRulesTable {
  const key = municipalityKey(name);
  if (key === "") throw new PmoError("Informe o nome do município.");
  if (key === "__proto__" || key === "constructor" || key === "prototype") throw new PmoError("Nome de município inválido.");
  validateCondoLotesRules(rules);
  return { ...table, [key]: { name: name.trim().replace(/\s+/g, " "), rules: { ...rules }, source: source.trim() } };
}

export function withoutMunicipalRules(table: MunicipalRulesTable, name: string): MunicipalRulesTable {
  const key = municipalityKey(name);
  const next: Record<string, MunicipalRulesEntry> = {};
  for (const [k, v] of Object.entries(table)) if (k !== key) next[k] = v;
  return next;
}

/** Regras do município; sem cadastro, os padrões — e `isDefault` avisa que o valor não foi conferido para o município. */
export function resolveMunicipalRules(table: MunicipalRulesTable, name: string): { rules: CondoLotesRules; isDefault: boolean; source: string } {
  const e = Object.prototype.hasOwnProperty.call(table, municipalityKey(name)) ? table[municipalityKey(name)] : undefined;
  return e ? { rules: e.rules, isDefault: false, source: e.source } : { rules: CONDO_LOTES_DEFAULT_RULES, isDefault: true, source: "" };
}

/** Lê uma tabela salva (ex.: do navegador) descartando entradas inválidas em vez de falhar. */
export function parseMunicipalRulesTable(raw: unknown): MunicipalRulesTable {
  let table: MunicipalRulesTable = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return table;
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const e = v as Record<string, unknown>;
    if (typeof e.name !== "string" || typeof e.rules !== "object" || e.rules === null) continue;
    const r = e.rules as Record<string, unknown>;
    const rules = { fenceMinHeightM: r.fenceMinHeightM, roadMinWidthM: r.roadMinWidthM, sidewalkMinWidthM: r.sidewalkMinWidthM, culDeSacMinDiameterM: r.culDeSacMinDiameterM, registryMaxAgeDays: r.registryMaxAgeDays } as CondoLotesRules;
    try {
      table = withMunicipalRules(table, e.name, rules, typeof e.source === "string" ? e.source : "");
    } catch {
      /* entrada inválida: ignorada */
    }
  }
  return table;
}

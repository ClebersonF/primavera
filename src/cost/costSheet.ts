import { PmoError } from "../errors";
import { fromCents, nonNegativeCents } from "../money";

/** Código de custo (estrutura analítica de custos), em árvore. */
export interface CostCode {
  id: string;
  parentId: string | null;
  name: string;
}

export interface CostLine {
  id: string;
  codeId: string;
  description?: string;
  /** Orçado. */
  budget: number;
  /** Comprometido (contratos/pedidos firmados). */
  committed?: number;
  /** Realizado (medido/pago). */
  actual?: number;
  /** Estimativa para terminar. Se omitida, a previsão é max(orçado, comprometido, realizado). */
  etc?: number;
}

export interface CostSheetRow {
  codeId: string;
  name: string;
  level: number;
  budget: number;
  committed: number;
  actual: number;
  /** Previsão no término (EAC). */
  forecast: number;
  /** Orçado − previsão. Negativo = estouro previsto. */
  variance: number;
}

export interface CostSheet {
  /** Pré-ordem. Cada linha já inclui os valores dos descendentes. */
  rows: CostSheetRow[];
  totals: Omit<CostSheetRow, "codeId" | "name" | "level">;
}

interface Cents {
  budget: number;
  committed: number;
  actual: number;
  forecast: number;
}

const zero = (): Cents => ({ budget: 0, committed: 0, actual: 0, forecast: 0 });

function add(a: Cents, b: Cents): Cents {
  return {
    budget: a.budget + b.budget,
    committed: a.committed + b.committed,
    actual: a.actual + b.actual,
    forecast: a.forecast + b.forecast,
  };
}

function lineCents(l: CostLine): Cents {
  const budget = nonNegativeCents(l.budget, `Orçado da linha ${l.id}`);
  const committed = nonNegativeCents(l.committed ?? 0, `Comprometido da linha ${l.id}`);
  const actual = nonNegativeCents(l.actual ?? 0, `Realizado da linha ${l.id}`);
  const forecast =
    l.etc !== undefined
      ? actual + nonNegativeCents(l.etc, `ETC da linha ${l.id}`)
      : Math.max(budget, committed, actual);
  return { budget, committed, actual, forecast };
}

function toRow(
  code: { id: string; name: string },
  level: number,
  c: Cents,
): CostSheetRow {
  return {
    codeId: code.id,
    name: code.name,
    level,
    budget: fromCents(c.budget),
    committed: fromCents(c.committed),
    actual: fromCents(c.actual),
    forecast: fromCents(c.forecast),
    variance: fromCents(c.budget - c.forecast),
  };
}

/** Monta o cost sheet: rollup de orçado, comprometido, realizado e previsão por código de custo. */
export function buildCostSheet(codes: readonly CostCode[], lines: readonly CostLine[]): CostSheet {
  const byId = new Map<string, CostCode>();
  for (const c of codes) {
    if (c.id === "") throw new PmoError("Todo código de custo precisa de id não vazio");
    if (byId.has(c.id)) throw new PmoError(`Código de custo duplicado: ${c.id}`);
    byId.set(c.id, c);
  }
  const children = new Map<string, string[]>(codes.map((c) => [c.id, []]));
  const roots: string[] = [];
  for (const c of codes) {
    if (c.parentId === null) roots.push(c.id);
    else {
      if (!byId.has(c.parentId)) throw new PmoError(`Código ${c.id} aponta para pai inexistente: ${c.parentId}`);
      children.get(c.parentId)!.push(c.id);
    }
  }
  for (const c of codes) {
    const seen = new Set<string>([c.id]);
    let cur = c;
    while (cur.parentId !== null) {
      if (seen.has(cur.parentId)) throw new PmoError(`Ciclo na estrutura de custos envolvendo ${cur.parentId}`);
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId)!;
    }
  }

  const own = new Map<string, Cents>(codes.map((c) => [c.id, zero()]));
  for (const l of lines) {
    if (!byId.has(l.codeId)) throw new PmoError(`Linha ${l.id} usa código de custo inexistente: ${l.codeId}`);
    own.set(l.codeId, add(own.get(l.codeId)!, lineCents(l)));
  }

  const rows: CostSheetRow[] = [];
  const walk = (id: string, level: number): Cents => {
    const code = byId.get(id)!;
    const slot = rows.length;
    rows.push(toRow(code, level, zero())); // reserva a posição em pré-ordem
    let total = own.get(id)!;
    for (const kid of children.get(id)!) total = add(total, walk(kid, level + 1));
    rows[slot] = toRow(code, level, total);
    return total;
  };

  let grand = zero();
  for (const r of roots) grand = add(grand, walk(r, 0));
  const { codeId: _c, name: _n, level: _l, ...totals } = toRow({ id: "", name: "" }, 0, grand);
  return { rows, totals };
}

import { PmoError } from "../errors";

/** Linha importada de uma planilha de acompanhamento de obra. */
export interface ImportedActivity {
  code: string;
  group: string;
  title: string;
  status: "todo" | "doing" | "done";
  /** 0..100 */
  percent: number;
  /** YYYY-MM-DD ou "" */
  start: string;
  finish: string;
  owner: string;
  notes: string;
}

export interface ImportResult {
  rows: ImportedActivity[];
  /** Linhas que não puderam ser lidas, com o motivo (número da linha no arquivo). */
  errors: { line: number; message: string }[];
}

export const MAX_IMPORT_ROWS = 500;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const HEADERS: Record<string, string[]> = {
  code: ["codigo", "cod", "id"],
  group: ["etapa", "grupo", "fase"],
  title: ["descricao", "descricao do servico", "atividade", "servico", "titulo"],
  status: ["status", "situacao"],
  percent: ["% execucao", "execucao", "% execucao fisica", "percentual", "% concluido", "avanco"],
  start: ["data inicio", "inicio", "data de inicio"],
  finish: ["data termino", "termino", "data de termino", "fim"],
  owner: ["responsavel", "executor"],
  notes: ["observacoes", "observacao", "obs"],
};

/** Divide uma linha de CSV respeitando aspas; o separador é detectado (; , ou tab). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Situação em português → status do app. Desconhecida = null. */
export function parseStatus(raw: string): "todo" | "doing" | "done" | null {
  const s = norm(raw);
  if (s === "") return null;
  if (/^(concluid|conclui|finalizad|entregue|100)/.test(s)) return "done";
  if (/^(parcialmente|em andamento|andamento|continuo|em execucao|iniciad)/.test(s)) return "doing";
  if (/^(pendente|nao iniciad|a iniciar|verificar|planejad|aguardando)/.test(s)) return "todo";
  return null;
}

/** "60%", "0,6", "0.6", "60" → 0..100 (valores de 0 a 1 contam como fração; 1 = 100%). Inválido = null. */
export function parsePercent(raw: string): number | null {
  const t = raw.trim().replace("%", "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  const hadPercent = raw.includes("%");
  const v = !hadPercent && n <= 1 ? n * 100 : n;
  return v > 100 ? null : Math.round(v * 100) / 100;
}

/** "2024-03-01", "2024-03-01 00:00:00" ou "01/03/2024" → YYYY-MM-DD. Vazio = ""; inválido = null. */
export function parseDate(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "";
  let y = "";
  let m = "";
  let d = "";
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (a) {
    y = a[1] ?? "";
    m = a[2] ?? "";
    d = a[3] ?? "";
  } else {
    const b = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (!b) return null;
    d = b[1] ?? "";
    m = b[2] ?? "";
    y = b[3] ?? "";
  }
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * Lê o CSV exportado de uma planilha de acompanhamento (colunas: código, etapa, descrição, status, % execução,
 * data início, data término, responsável, observações). Linhas em branco são ignoradas; o cabeçalho é reconhecido por nome.
 */
export function parseActivityCsv(text: string): ImportResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = lines.find((l) => l.trim() !== "");
  if (!first) throw new PmoError("Arquivo vazio.");
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const headerIdx = lines.indexOf(first);
  const head = splitLine(first, sep).map(norm);
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  if (col.title === undefined) throw new PmoError('Não encontrei a coluna "Descrição" (ou "Atividade") no cabeçalho.');
  const rows: ImportedActivity[] = [];
  const errors: ImportResult["errors"] = [];
  const get = (cells: string[], k: string) => (col[k] === undefined ? "" : (cells[col[k]!] ?? ""));
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || /^[;,\t\s]*$/.test(line)) continue;
    const cells = splitLine(line, sep);
    const title = get(cells, "title");
    if (title === "") {
      errors.push({ line: i + 1, message: "Linha sem descrição." });
      continue;
    }
    if (title.length > 200) {
      errors.push({ line: i + 1, message: "Descrição acima de 200 caracteres." });
      continue;
    }
    const statusRaw = get(cells, "status");
    let status = parseStatus(statusRaw);
    if (statusRaw !== "" && status === null) {
      errors.push({ line: i + 1, message: `Situação desconhecida: "${statusRaw}".` });
      continue;
    }
    const pctRaw = get(cells, "percent");
    const pct = pctRaw === "" ? null : parsePercent(pctRaw);
    if (pctRaw !== "" && pct === null) {
      errors.push({ line: i + 1, message: `Percentual inválido: "${pctRaw}".` });
      continue;
    }
    const start = parseDate(get(cells, "start"));
    const finish = parseDate(get(cells, "finish"));
    if (start === null || finish === null) {
      errors.push({ line: i + 1, message: "Data inválida (use AAAA-MM-DD ou DD/MM/AAAA)." });
      continue;
    }
    if (start && finish && finish < start) {
      errors.push({ line: i + 1, message: "O término é anterior ao início." });
      continue;
    }
    let percent = pct ?? (status === "done" ? 100 : 0);
    if (status === null) status = percent >= 100 ? "done" : percent > 0 ? "doing" : "todo";
    if (status === "done") percent = 100;
    else if (status === "todo") percent = 0;
    else if (percent >= 100) percent = 99; // "em andamento" nunca fecha a atividade sozinho
    rows.push({ code: get(cells, "code"), group: get(cells, "group"), title, status, percent, start, finish, owner: get(cells, "owner"), notes: get(cells, "notes") });
    if (rows.length > MAX_IMPORT_ROWS) throw new PmoError(`No máximo ${MAX_IMPORT_ROWS} atividades por importação.`);
  }
  return { rows, errors };
}

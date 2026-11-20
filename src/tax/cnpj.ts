/** CNPJ numérico: validação dos dígitos verificadores, formatação e leitura do cadastro público (formato BrasilAPI). */

export const cnpjDigits = (v: string): string => v.replace(/\D/g, "");

export function isValidCnpj(v: string): boolean {
  const d = cnpjDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (len: number) => {
    let sum = 0;
    let w = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * w;
      w = w === 2 ? 9 : w - 1;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

export function formatCnpj(v: string): string {
  const d = cnpjDigits(v);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v;
}

export interface CompanyProfile {
  cnpj: string;
  name: string;
  tradeName: string;
  /** Situação cadastral (ex.: ATIVA). */
  status: string;
  /** YYYY-MM-DD ou "". */
  openedOn: string;
  city: string;
  uf: string;
  legalNature: string;
  /** Porte declarado: MICRO EMPRESA, EMPRESA DE PEQUENO PORTE ou DEMAIS. */
  size: string;
  mainActivity: { code: string; description: string };
  secondaryActivities: { code: string; description: string }[];
  /** true/false quando o cadastro informa; null quando não informa (tratado como não optante). */
  simplesOptant: boolean | null;
  mei: boolean | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Lê a resposta da consulta pública de CNPJ sem inventar campo: o que não vier fica vazio ou null. */
export function parseCompanyProfile(raw: unknown): CompanyProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const cnpj = cnpjDigits(str(o.cnpj));
  const name = str(o.razao_social);
  if (!name) return null;
  const sec = Array.isArray(o.cnaes_secundarios) ? o.cnaes_secundarios : [];
  return {
    cnpj,
    name,
    tradeName: str(o.nome_fantasia),
    status: str(o.descricao_situacao_cadastral),
    openedOn: /^\d{4}-\d{2}-\d{2}/.test(str(o.data_inicio_atividade)) ? str(o.data_inicio_atividade).slice(0, 10) : "",
    city: str(o.municipio),
    uf: str(o.uf),
    legalNature: str(o.natureza_juridica),
    size: str(o.porte),
    mainActivity: { code: str(o.cnae_fiscal), description: str(o.cnae_fiscal_descricao) },
    secondaryActivities: sec
      .map((c) => (typeof c === "object" && c !== null ? { code: str((c as Record<string, unknown>).codigo), description: str((c as Record<string, unknown>).descricao) } : null))
      .filter((c): c is { code: string; description: string } => c !== null && c.code !== "" && c.code !== "0"),
    simplesOptant: bool(o.opcao_pelo_simples),
    mei: bool(o.opcao_pelo_mei),
  };
}

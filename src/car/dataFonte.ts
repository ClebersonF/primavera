/**
 * Formatador único de datas vindas de fontes oficiais (portado do CronosSuite).
 * A fonte mistura `2015-06-11`, `11/06/2015` e ISO com hora; `new Date(...)` direto confunde dd/mm e mm/dd.
 */
const NA = "N/A";

/** Interpreta respeitando o formato brasileiro dd/mm/aaaa. */
export const parseDataFonte = (valor: string | null | undefined): Date | null => {
  if (!valor) return null;
  const t = String(valor).trim();
  if (!t) return null;
  const br = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const [a, m, d] = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
  const date = a && m && d ? new Date(Number(a), Number(m) - 1, Number(d)) : new Date(t);
  // Rejeita datas "roladas" (31/02 virando 03/03).
  if (a && m && d && (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d))) return null;
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatarDataFonte = (valor: string | null | undefined): string => {
  if (!valor) return NA;
  const d = parseDataFonte(valor);
  return d ? d.toLocaleDateString("pt-BR") : String(valor);
};

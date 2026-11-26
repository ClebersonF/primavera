import { cleanLoteadora, EMPTY_LOTEADORA, type LoteadoraState } from "./state";

/**
 * Onda 3 — dados por registro.
 *
 * O estado da Loteadora deixa de ser um JSON único gravado inteiro a cada clique: cada lote, trecho,
 * processo, alçada, diário, RNC, boletim, fornecedor, reserva, proposta, venda (e demais listas) vira
 * um registro próprio no Odoo, com versão. Os campos soltos (ficha, cartório, parâmetros, caução…)
 * viram um registro por campo na coleção "obra". A biblioteca de regras não muda: o estado é montado
 * a partir dos registros e quebrado de volta neles, e só o que mudou é gravado.
 */

export interface Registro {
  colecao: string;
  chave: string;
  /** Posição na lista (a ordem da tela). */
  ordem: number;
  dados: unknown;
}

type Lista = { campo: string; chave: (x: never) => string };

/** Listas do estado e a chave natural de cada item (única na obra). */
export const LISTAS: readonly Lista[] = [
  { campo: "trechos", chave: (x: { id: string }) => x.id },
  { campo: "lotes", chave: (x: { id: string }) => x.id },
  { campo: "processos", chave: (x: { id: string }) => x.id },
  { campo: "equipe", chave: (x: { id: string }) => x.id },
  { campo: "solicitacoes", chave: (x: { id: string }) => x.id },
  { campo: "etapas", chave: (x: { id: string }) => x.id },
  { campo: "reforecasts", chave: (x: { mes: string }) => x.mes },
  { campo: "frentes", chave: (x: { trechoId: string; frente: string }) => `${x.trechoId}|${x.frente}` },
  { campo: "diarios", chave: (x: { data: string }) => x.data },
  { campo: "rncs", chave: (x: { id: string }) => x.id },
  { campo: "boletins", chave: (x: { id: string }) => x.id },
  { campo: "fornecedores", chave: (x: { id: string }) => x.id },
  { campo: "cotacoes", chave: (x: { id: string }) => x.id },
  { campo: "pranchas", chave: (x: { codigo: string }) => x.codigo },
  { campo: "fechamentos", chave: (x: { quinzena: string }) => x.quinzena },
  { campo: "plantios", chave: (x: { id: string }) => x.id },
  { campo: "trilha", chave: (x: { seq: number }) => String(x.seq).padStart(6, "0") },
  { campo: "avisos", chave: (x: { chave: string; em: string }) => `${x.chave}|${x.em}` },
  { campo: "garantias", chave: (x: { id: string }) => x.id },
  { campo: "retencoesLiberadas", chave: (x: { id: string }) => x.id },
] as unknown as readonly Lista[];

/** Listas do comercial (reservas, propostas e vendas), cada item um registro. */
export const LISTAS_COMERCIAL = ["reservas", "propostas", "vendas"] as const;

/** Coleções que guardam dados pessoais de compradores (CPF/CNPJ): acesso restrito no Odoo. */
export const COLECOES_PESSOAIS = new Set(["comercial.reservas", "comercial.propostas", "comercial.vendas"]);

const OBRA = "obra";
const COMERCIAL_CAMPOS = "comercial";

/** Quebra o estado em registros (uma chamada por obra). */
export function particionar(s: LoteadoraState): Registro[] {
  const out: Registro[] = [];
  const st = s as unknown as Record<string, unknown>;
  const listas = new Set(LISTAS.map((l) => l.campo));
  for (const l of LISTAS) {
    const arr = (st[l.campo] as unknown[] | undefined) ?? [];
    arr.forEach((item, i) => out.push({ colecao: l.campo, chave: (l.chave as (x: unknown) => string)(item), ordem: i, dados: item }));
  }
  const c = s.comercial ?? { reservas: [], propostas: [], vendas: [] };
  for (const k of LISTAS_COMERCIAL)
    (c[k] as { id: string }[]).forEach((item, i) => out.push({ colecao: `comercial.${k}`, chave: item.id, ordem: i, dados: item }));
  // Campos soltos do comercial (tabela, breakeven…) e da obra: um registro por campo.
  for (const [k, v] of Object.entries(c)) {
    if ((LISTAS_COMERCIAL as readonly string[]).includes(k) || v === undefined) continue;
    out.push({ colecao: COMERCIAL_CAMPOS, chave: k, ordem: 0, dados: v });
  }
  for (const [k, v] of Object.entries(st)) {
    if (listas.has(k) || k === "comercial" || v === undefined) continue;
    out.push({ colecao: OBRA, chave: k, ordem: 0, dados: v });
  }
  return out;
}

/** Monta o estado a partir dos registros (o inverso de `particionar`), validado pela mesma limpeza. */
export function montar(regs: readonly Registro[]): LoteadoraState {
  const bruto: Record<string, unknown> = { ...EMPTY_LOTEADORA, comercial: { reservas: [], propostas: [], vendas: [] } };
  const porColecao = new Map<string, Registro[]>();
  for (const r of regs) {
    const l = porColecao.get(r.colecao);
    if (l) l.push(r);
    else porColecao.set(r.colecao, [r]);
  }
  const ordenar = (l: Registro[]) => [...l].sort((a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave));
  for (const l of LISTAS) bruto[l.campo] = ordenar(porColecao.get(l.campo) ?? []).map((r) => r.dados);
  const comercial: Record<string, unknown> = { reservas: [], propostas: [], vendas: [] };
  for (const k of LISTAS_COMERCIAL) comercial[k] = ordenar(porColecao.get(`comercial.${k}`) ?? []).map((r) => r.dados);
  for (const r of porColecao.get(COMERCIAL_CAMPOS) ?? []) comercial[r.chave] = r.dados;
  bruto.comercial = comercial;
  for (const r of porColecao.get(OBRA) ?? []) bruto[r.chave] = r.dados;
  return cleanLoteadora(bruto) ?? EMPTY_LOTEADORA;
}

export const chaveRegistro = (r: { colecao: string; chave: string }) => `${r.colecao}|${r.chave}`;

/** Só o que mudou entre dois estados: registros a gravar (novos ou alterados) e a apagar. */
export function diferencas(antes: LoteadoraState | undefined, depois: LoteadoraState): { gravar: Registro[]; apagar: { colecao: string; chave: string }[] } {
  const a = new Map(particionar(antes ?? EMPTY_LOTEADORA).map((r) => [chaveRegistro(r), r]));
  const d = particionar(depois);
  const gravar: Registro[] = [];
  const vistos = new Set<string>();
  for (const r of d) {
    const k = chaveRegistro(r);
    vistos.add(k);
    const o = a.get(k);
    if (!o || o.ordem !== r.ordem || JSON.stringify(o.dados) !== JSON.stringify(r.dados)) gravar.push(r);
  }
  const apagar = [...a.values()].filter((r) => !vistos.has(chaveRegistro(r))).map(({ colecao, chave }) => ({ colecao, chave }));
  return { gravar, apagar };
}

/** Contagens por coleção, para conferir a migração (JSON × registros). */
export function contagens(s: LoteadoraState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of particionar(s)) out[r.colecao] = (out[r.colecao] ?? 0) + 1;
  return out;
}

/** Conferência da migração: as contagens e o conteúdo montado de volta batem com o original? */
export function conferirMigracao(original: LoteadoraState, migrado: LoteadoraState): { ok: boolean; divergencias: string[] } {
  const a = contagens(original), b = contagens(migrado);
  const divergencias: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if ((a[k] ?? 0) !== (b[k] ?? 0)) divergencias.push(`${k}: ${a[k] ?? 0} no JSON × ${b[k] ?? 0} nos registros`);
  if (!divergencias.length && JSON.stringify(cleanLoteadora(original)) !== JSON.stringify(migrado)) divergencias.push("conteúdo diferente com as mesmas contagens");
  return { ok: divergencias.length === 0, divergencias };
}

import { PmoError } from "../errors";

/**
 * Integração com as calculadoras oficiais da Receita Federal (RTC — Reforma Tributária do Consumo, LC 214/2025):
 *  - calculadora-rtc-regime-regular  → CBS, IBS e Imposto Seletivo (regime geral) + base de cálculo unificada
 *  - calculadora-rtc-simples-nacional → CBS e IBS no Simples Nacional
 *  - calculadora-rtc-gerador-danfse   → DANFSe em PDF a partir do XML da NFS-e
 * São serviços HTTP que a própria empresa hospeda (Java 25 / Go); este módulo só monta as entradas, chama e lê as respostas.
 * O cálculo é da Receita: não reimplemente alíquota, redução nem base aqui. Resultado "CALCULO_SIMULADO" = com alíquotas
 * informadas por quem chama (obrigatório a partir de 2027); confira com a contabilidade antes de emitir ou provisionar.
 */

export type RtcService = "regime" | "simples" | "danfse";

export type EstadoItem = "CALCULADO" | "CALCULO_SIMULADO" | "INCONSISTENCIA_ENTRADA" | "NAO_IMPLEMENTADO" | "FALHA_TECNICA";

export interface RtcAliquotasNominais {
  /** Em pontos percentuais (8.8 = 8,8%). */
  cbs: number;
  ibsEstadual: number;
  ibsMunicipal: number;
  impostoSeletivo?: { adValorem?: number; especifica?: number };
}

export interface RtcItemInput {
  numero: number;
  /** Bem: NCM. Serviço: NBS. Informe exatamente um. */
  ncm?: string;
  nbs?: string;
  cst: string;
  cClassTrib: string;
  baseCalculo?: number;
  quantidade?: number;
  unidade?: string;
  aliquotasNominais?: RtcAliquotasNominais;
  impostoSeletivo?: { cst: string; cClassTrib: string; baseCalculo: number; quantidade?: number; unidade?: string; impostoInformado?: number };
}

export interface RtcOperacaoRegimeGeral {
  id: string;
  versao: string;
  /** ISO 8601 com fuso, ex.: 2027-03-10T10:00:00-03:00. */
  dhFatoGerador: string;
  /** Código IBGE do município (7 dígitos). */
  municipio: number;
  uf: string;
  itens: RtcItemInput[];
}

const onlyDigits = (s: string) => /^\d+$/.test(s);

/** Valida o que a API rejeitaria de qualquer forma, para falhar antes da chamada de rede e com mensagem em português. */
export function validateRtcOperacao(op: RtcOperacaoRegimeGeral): void {
  if (!op.id.trim()) throw new PmoError("Operação sem identificador.");
  if (Number.isNaN(Date.parse(op.dhFatoGerador)) || !/T\d{2}:\d{2}/.test(op.dhFatoGerador)) throw new PmoError("Data do fato gerador inválida: use o formato AAAA-MM-DDThh:mm:ss-03:00.");
  if (!Number.isInteger(op.municipio) || String(op.municipio).length !== 7) throw new PmoError("Município não informado: escolha a UF e o município da lista.");
  if (!/^[A-Z]{2}$/.test(op.uf)) throw new PmoError("UF inválida.");
  if (op.itens.length === 0) throw new PmoError("Informe ao menos um item.");
  const seen = new Set<number>();
  for (const it of op.itens) {
    if (!Number.isInteger(it.numero) || it.numero < 1 || seen.has(it.numero)) throw new PmoError(`Número de item inválido ou repetido: ${it.numero}.`);
    seen.add(it.numero);
    if (it.ncm && it.nbs) throw new PmoError(`Item ${it.numero}: informe só o NCM (bem) ou só o NBS (serviço), não os dois.`);
    if (it.ncm === "") throw new PmoError(`Item ${it.numero}: falta o NCM do bem (8 dígitos). Ele vem na nota do fornecedor.`);
    if (!it.ncm && !it.nbs) throw new PmoError(`Item ${it.numero}: falta o NBS do serviço (9 dígitos). Use “Localizar” para buscar pela descrição.`);
    if (!/^\d{6}$/.test(it.cClassTrib)) throw new PmoError(`Item ${it.numero}: falta a classificação tributária (cClassTrib, 6 dígitos). Depois de escolher o serviço em “Localizar”, escolha a classificação.`);
    if (!/^\d{3}$/.test(it.cst)) throw new PmoError(`Item ${it.numero}: CST deve ter 3 dígitos (os 3 primeiros do cClassTrib).`);
    if (it.ncm !== undefined && !(onlyDigits(it.ncm) && it.ncm.length === 8)) throw new PmoError(`Item ${it.numero}: NCM deve ter 8 dígitos.`);
    if (it.nbs !== undefined && !(onlyDigits(it.nbs) && it.nbs.length === 9)) throw new PmoError(`Item ${it.numero}: NBS deve ter 9 dígitos.`);
    if (it.baseCalculo !== undefined && !(Number.isFinite(it.baseCalculo) && it.baseCalculo >= 0)) throw new PmoError(`Item ${it.numero}: informe a base de cálculo em reais (valor da operação sem CBS e IBS).`);
    const a = it.aliquotasNominais;
    if (a) for (const [k, v] of [["cbs", a.cbs], ["ibsEstadual", a.ibsEstadual], ["ibsMunicipal", a.ibsMunicipal]] as const) {
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new PmoError(`Item ${it.numero}: alíquota ${k} fora de 0 a 100.`);
    }
  }
}

/** Alíquotas de referência por pontos percentuais; sem valor oficial vigente, deixe o chamador informar (editável na tela). */
export function buildRtcOperacao(p: { id: string; dhFatoGerador: string; municipio: number; uf: string; itens: RtcItemInput[]; versao?: string }): RtcOperacaoRegimeGeral {
  const op = { id: p.id, versao: p.versao ?? "1.0.0", dhFatoGerador: p.dhFatoGerador, municipio: p.municipio, uf: p.uf, itens: p.itens };
  validateRtcOperacao(op);
  return op;
}

export interface RtcErro { code: string; title: string; pointer?: string; detail?: string }
export interface RtcItemResultado {
  numero: number;
  estado: EstadoItem;
  vCBS: number;
  vIBS: number;
  vIS: number;
  erros: RtcErro[];
}
export interface RtcResumo {
  itens: RtcItemResultado[];
  vCBS: number;
  vIBS: number;
  vIS: number;
  /** Algum item não foi calculado (inconsistência, falha ou não implementado): o total NÃO é da operação inteira. */
  incompleto: boolean;
  /** Algum item usou alíquotas informadas por quem chamou. */
  simulado: boolean;
}

const money = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const cents = (n: number) => Math.round(n * 100) / 100;
const ESTADOS: EstadoItem[] = ["CALCULADO", "CALCULO_SIMULADO", "INCONSISTENCIA_ENTRADA", "NAO_IMPLEMENTADO", "FALHA_TECNICA"];

/** Resume a resposta de `/observabilidade/regime-geral`. Lê de forma defensiva: campo ausente não vira erro nem inventa valor. */
export function summarizeRtcResponse(resp: unknown): RtcResumo {
  const raiz = obj(resp);
  const objetos = Array.isArray(raiz.objetos) ? raiz.objetos : [];
  const itens: RtcItemResultado[] = objetos.map((o) => {
    const x = obj(o);
    const trib = obj(x.tribCalc);
    const g = obj(obj(obj(trib.IBSCBS).gIBSCBS));
    const estadoBruto = String(x.estadoItem ?? "");
    const estado = (ESTADOS as string[]).includes(estadoBruto) ? (estadoBruto as EstadoItem) : "FALHA_TECNICA";
    const erros = (Array.isArray(x.erros) ? x.erros : []).map((e): RtcErro => {
      const r = obj(e);
      return { code: String(r.code ?? ""), title: String(r.title ?? ""), pointer: r.pointer === undefined ? undefined : String(r.pointer), detail: r.detail === undefined ? undefined : String(r.detail) };
    });
    return {
      numero: money(x.nObj),
      estado,
      vCBS: money(obj(g.gCBS).vCBS),
      vIBS: money(g.vIBS),
      vIS: money(obj(trib.IS).vIS),
      erros,
    };
  });
  const calculados = itens.filter((i) => i.estado === "CALCULADO" || i.estado === "CALCULO_SIMULADO");
  return {
    itens,
    vCBS: cents(calculados.reduce((s, i) => s + i.vCBS, 0)),
    vIBS: cents(calculados.reduce((s, i) => s + i.vIBS, 0)),
    vIS: cents(calculados.reduce((s, i) => s + i.vIS, 0)),
    incompleto: itens.length === 0 || itens.some((i) => i.estado !== "CALCULADO" && i.estado !== "CALCULO_SIMULADO"),
    simulado: itens.some((i) => i.estado === "CALCULO_SIMULADO"),
  };
}

/** Caminhos aceitos de cada serviço. Lista fechada: nada fora dela é encaminhado (evita usar o proxy para chamar outro destino). */
export const RTC_ACTIONS = {
  "regime-geral": { service: "regime", method: "POST", path: "/api/calculadora/observabilidade/regime-geral" },
  "regime-geral-estrito": { service: "regime", method: "POST", path: "/api/calculadora/regime-geral" },
  "base-calculo": { service: "regime", method: "POST", path: "/api/calculadora/base-calculo/base-calculo-unificada" },
  "base-calculo-nfse": { service: "regime", method: "POST", path: "/api/calculadora/base-calculo/base-calculo-unificada-nfse" },
  "simples-nacional": { service: "simples", method: "POST", path: "/api/calculadora/observabilidade/simples-nacional" },
  "atividades-simples": { service: "simples", method: "GET", path: "/api/calculadora/simples-nacional/atividades" },
  "aliquota-uniao": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/aliquota-uniao" },
  "aliquota-uf": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/aliquota-uf" },
  "aliquota-municipio": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/aliquota-municipio" },
  "classificacoes-cbs-ibs": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/situacoes-tributarias/cbs-ibs" },
  "ncm": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/ncm" },
  "nbs": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/nbs" },
  "municipios": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/ufs/municipios" },
  "nbs-lista": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/nbs/lista" },
  "classificacoes-lista": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/classificacoes-tributarias/cbs-ibs" },
  "classificacoes-por-nbs": { service: "regime", method: "GET", path: "/api/calculadora/dados-abertos/classificacoes-tributarias/nbs" },
  "danfse": { service: "danfse", method: "POST", path: "/api/danfse" },
} as const satisfies Record<string, { service: RtcService; method: "GET" | "POST"; path: string }>;
export type RtcAction = keyof typeof RTC_ACTIONS;
export const isRtcAction = (a: unknown): a is RtcAction => typeof a === "string" && Object.prototype.hasOwnProperty.call(RTC_ACTIONS, a);

/** Monta a URL final de uma ação a partir da base do serviço (sem barra final) e de parâmetros de consulta simples. */
export function rtcUrl(baseUrl: string, action: RtcAction, query: Record<string, string | number | boolean | undefined> = {}): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new PmoError("URL do serviço RTC inválida.");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new PmoError("URL do serviço RTC deve ser http(s).");
  const url = new URL(base.origin + base.pathname.replace(/\/+$/, "") + RTC_ACTIONS[action].path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url.toString();
}

/** O CST é o prefixo de 3 dígitos da classificação tributária (cClassTrib 200028 → CST 200). */
export const cstFromClassTrib = (cClassTrib: string): string => (/^\d{6}$/.test(cClassTrib) ? cClassTrib.slice(0, 3) : "");

const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Busca por código ou por todas as palavras da descrição, sem acento nem caixa. Sem termo, devolve os primeiros. */
export function searchRtcCatalog<T extends { codigo: string | number; descricao?: string; nome?: string }>(items: readonly T[], term: string, limit = 30): T[] {
  const words = fold(term).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items.slice(0, limit);
  const out: T[] = [];
  for (const it of items) {
    const hay = fold(`${it.codigo} ${it.descricao ?? ""} ${it.nome ?? ""}`);
    if (words.every((w) => hay.includes(w))) out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

/** Siglas das 27 unidades da federação, em ordem alfabética. */
export const UFS_BR = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"] as const;

/** Item cujo nome é exatamente o digitado (sem acento, caixa nem espaços sobrando). Nome parcial ou ambíguo → null. */
export function matchRtcByName<T extends { nome: string }>(items: readonly T[], typed: string): T | null {
  const alvo = fold(typed).trim().replace(/\s+/g, " ");
  if (alvo === "") return null;
  const iguais = items.filter((i) => fold(i.nome).trim().replace(/\s+/g, " ") === alvo);
  return iguais.length === 1 ? iguais[0]! : null;
}

/**
 * Instância pública da calculadora mantida pela Receita Federal (ambiente piloto da Reforma Tributária).
 * Responde sem autenticação ao cálculo do regime geral e às tabelas oficiais; verificado em 20/11/2026 (app 1.7.2).
 * Não tem Simples Nacional nem DANFSe conhecidos, e a Receita pode mudar ou restringir o acesso sem aviso.
 */
export const RTC_PUBLIC_REGIME_URL = "https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo";

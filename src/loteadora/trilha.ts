import { PmoError } from "../errors";
import { ETAPA_LABEL, PAPEIS, TIPO_LABEL, type Papel, type Solicitacao } from "./alcadas";
import { isObj, nonNeg, optText, text } from "./common";
import { sha256Hex } from "./sha256";

/**
 * Trilha obrigatória (documento, 2.2): data e hora, usuário, papel, ação, justificativa e impacto no
 * reforecast. Só de inclusão e encadeada por SHA-256: cada registro carrega o hash do anterior, então
 * qualquer edição ou remoção no meio quebra a corrente e aparece na verificação.
 */

export interface Autor {
  usuario: string;
  email?: string;
  papel?: Papel;
  /** Login real no servidor (true) ou perfil genérico / demonstração (false). */
  autenticado: boolean;
}

/** Carimbo do servidor: hora e usuário conferidos lá, assinados (HMAC) para não serem forjados no navegador. */
export interface Carimbo {
  em: string;
  userId: string;
  email: string;
  assinatura: string;
}

export interface RegistroTrilha {
  seq: number;
  em: string;
  usuario: string;
  email?: string;
  papel?: Papel;
  autenticado: boolean;
  acao: string;
  alvo: string;
  detalhe: string;
  justificativa?: string;
  impacto?: number;
  carimbo?: Carimbo;
  anterior: string;
  hash: string;
}

export const MAX_TRILHA = 20_000;
const GENESIS = "0".repeat(64);

/** Conteúdo que entra no hash (ordem fixa de campos). */
function conteudo(r: Omit<RegistroTrilha, "hash">): string {
  return JSON.stringify([r.seq, r.em, r.usuario, r.email ?? "", r.papel ?? "", r.autenticado, r.acao, r.alvo, r.detalhe, r.justificativa ?? "", r.impacto ?? null, r.carimbo ?? null, r.anterior]);
}

export function cleanRegistro(v: unknown): RegistroTrilha | null {
  if (!isObj(v) || !nonNeg(v.seq) || !Number.isInteger(v.seq) || typeof v.em !== "string" || Number.isNaN(Date.parse(v.em))) return null;
  const usuario = text(v.usuario, 160), acao = text(v.acao, 60), alvo = text(v.alvo, 80), detalhe = text(v.detalhe, 1000);
  if (!usuario || !acao || !alvo || !detalhe || typeof v.autenticado !== "boolean") return null;
  if (typeof v.hash !== "string" || !/^[0-9a-f]{64}$/.test(v.hash) || typeof v.anterior !== "string" || !/^[0-9a-f]{64}$/.test(v.anterior)) return null;
  const r: RegistroTrilha = { seq: v.seq, em: v.em, usuario, autenticado: v.autenticado, acao, alvo, detalhe, anterior: v.anterior, hash: v.hash };
  const email = optText(v.email, 160);
  if (email) r.email = email;
  if ((PAPEIS as readonly unknown[]).includes(v.papel)) r.papel = v.papel as Papel;
  const j = optText(v.justificativa, 1000);
  if (j) r.justificativa = j;
  if (typeof v.impacto === "number" && Number.isFinite(v.impacto)) r.impacto = v.impacto;
  if (isObj(v.carimbo) && typeof v.carimbo.em === "string" && typeof v.carimbo.userId === "string" && typeof v.carimbo.email === "string" && typeof v.carimbo.assinatura === "string") {
    r.carimbo = { em: v.carimbo.em, userId: v.carimbo.userId.slice(0, 64), email: v.carimbo.email.slice(0, 160), assinatura: v.carimbo.assinatura.slice(0, 128) };
  }
  return r;
}

export function registrar(trilha: readonly RegistroTrilha[], autor: Autor, agoraIso: string, e: { acao: string; alvo: string; detalhe: string; justificativa?: string; impacto?: number; carimbo?: Carimbo }): RegistroTrilha[] {
  if (trilha.length >= MAX_TRILHA) throw new PmoError("Trilha cheia nesta obra: migre os dados para o Odoo (Onda 3).");
  const ult = trilha.at(-1);
  const base: Omit<RegistroTrilha, "hash"> = {
    seq: (ult?.seq ?? 0) + 1,
    em: agoraIso,
    usuario: autor.usuario.trim().slice(0, 160) || "—",
    ...(autor.email ? { email: autor.email.slice(0, 160) } : {}),
    ...(autor.papel ? { papel: autor.papel } : {}),
    autenticado: autor.autenticado,
    acao: e.acao.slice(0, 60),
    alvo: e.alvo.slice(0, 80),
    detalhe: e.detalhe.slice(0, 1000),
    ...(e.justificativa ? { justificativa: e.justificativa.slice(0, 1000) } : {}),
    ...(e.impacto !== undefined ? { impacto: e.impacto } : {}),
    ...(e.carimbo ? { carimbo: e.carimbo } : {}),
    anterior: ult?.hash ?? GENESIS,
  };
  return [...trilha, { ...base, hash: sha256Hex(conteudo(base)) }];
}

/** Confere a corrente inteira. `quebraEm` = primeiro registro adulterado ou fora de ordem. */
export function verificarTrilha(trilha: readonly RegistroTrilha[]): { integra: boolean; quebraEm?: number; total: number } {
  let anterior = GENESIS;
  for (let i = 0; i < trilha.length; i++) {
    const r = trilha[i]!;
    const { hash, ...sem } = r;
    if (r.seq !== i + 1 || r.anterior !== anterior || sha256Hex(conteudo(sem)) !== hash) return { integra: false, quebraEm: r.seq, total: trilha.length };
    anterior = hash;
  }
  return { integra: true, total: trilha.length };
}

/** A nova trilha precisa conter a anterior intacta no começo (só inclusão). */
export function trilhaSoInclusao(antes: readonly RegistroTrilha[], depois: readonly RegistroTrilha[]): boolean {
  if (depois.length < antes.length) return false;
  for (let i = 0; i < antes.length; i++) if (JSON.stringify(antes[i]) !== JSON.stringify(depois[i])) return false;
  return true;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ACAO_TXT = { aprovar: "aprovada", devolver: "devolvida", reprovar: "reprovada" } as const;

/** Registros de decisões de alçada novas entre dois estados (com justificativa e impacto no reforecast). */
export function eventosDeAlcada(antes: readonly Solicitacao[], depois: readonly Solicitacao[]): { acao: string; alvo: string; detalhe: string; justificativa?: string; impacto?: number }[] {
  const mapa = new Map(antes.map((s) => [s.id, s]));
  const out: { acao: string; alvo: string; detalhe: string; justificativa?: string; impacto?: number }[] = [];
  for (const s of depois) {
    const o = mapa.get(s.id);
    if (!o) out.push({ acao: "alcada_aberta", alvo: s.id, detalhe: `${s.titulo} (${TIPO_LABEL[s.tipo]}, ${brl(s.valor)})`, ...(s.impactoReforecast !== undefined ? { impacto: s.impactoReforecast } : {}) });
    for (const d of s.decisoes.slice(o?.decisoes.length ?? 0)) {
      out.push({ acao: `alcada_${d.acao}`, alvo: s.id, detalhe: `${ETAPA_LABEL[d.etapa]}: ${ACAO_TXT[d.acao]} por ${d.nome}`, ...(d.justificativa ? { justificativa: d.justificativa } : {}), ...(s.impactoReforecast !== undefined ? { impacto: s.impactoReforecast } : {}) });
    }
    for (const r of s.reenvios.slice(o?.reenvios.length ?? 0)) out.push({ acao: "alcada_reenviada", alvo: s.id, detalhe: `Reenviada por ${r.por}`, justificativa: r.ajuste });
  }
  return out;
}

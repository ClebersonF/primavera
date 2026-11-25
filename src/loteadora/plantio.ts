import { PmoError } from "../errors";
import { dataBr, isIsoDate, isObj, nonNeg, optText, text, type Nivel } from "./common";

/**
 * Plantio compensatório (TCRA da CETESB): mudas exigidas, vistoria mensal com contagem de vivas,
 * índice de pega e manutenção por 24 meses a partir do plantio.
 */
export interface VistoriaPlantio {
  /** AAAA-MM */
  mes: string;
  vivas: number;
  replantadas: number;
  em: string;
  por: string;
  nota?: string;
}

export interface Plantio {
  id: string;
  tcra: string;
  local: string;
  exigidas: number;
  plantioEm: string;
  /** Meses de manutenção exigidos (padrão 24). */
  meses: number;
  /** Índice de pega mínimo aceito (padrão 0,85). */
  metaPega: number;
  vistorias: VistoriaPlantio[];
}

export const MAX_PLANTIOS = 40;
const isMes = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function cleanPlantio(v: unknown): Plantio | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), tcra = text(v.tcra, 60), local = text(v.local, 160);
  if (!id || !tcra || !local || !nonNeg(v.exigidas) || !Number.isInteger(v.exigidas) || v.exigidas <= 0 || !isIsoDate(v.plantioEm)) return null;
  const meses = nonNeg(v.meses) && Number.isInteger(v.meses) && v.meses > 0 && v.meses <= 120 ? v.meses : 24;
  const metaPega = nonNeg(v.metaPega) && v.metaPega <= 1 ? v.metaPega : 0.85;
  const vistos = new Set<string>();
  const vistorias = (Array.isArray(v.vistorias) ? v.vistorias : []).flatMap((x): VistoriaPlantio[] => {
    if (!isObj(x) || !isMes(x.mes) || vistos.has(x.mes) || !nonNeg(x.vivas) || !Number.isInteger(x.vivas) || !nonNeg(x.replantadas) || !Number.isInteger(x.replantadas)) return [];
    const por = text(x.por, 100);
    if (!por || typeof x.em !== "string" || Number.isNaN(Date.parse(x.em))) return [];
    vistos.add(x.mes);
    const nota = optText(x.nota, 500);
    return [{ mes: x.mes, vivas: x.vivas, replantadas: x.replantadas, em: x.em, por, ...(nota ? { nota } : {}) }];
  }).sort((a, b) => a.mes.localeCompare(b.mes));
  return { id, tcra, local, exigidas: v.exigidas, plantioEm: v.plantioEm, meses, metaPega, vistorias };
}

export function nextPlantioId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, "")) || 0), 0);
  return `PL-${String(n + 1).padStart(2, "0")}`;
}

const mesDe = (d: string) => d.slice(0, 7);
const mesesEntre = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const mesAnterior = (m: string) => {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`;
};

export function registrarVistoria(p: Plantio, v: { mes: string; vivas: number; replantadas: number; nota?: string }, por: string, agoraIso: string): Plantio {
  if (!isMes(v.mes)) throw new PmoError("Mês inválido (AAAA-MM).");
  if (v.mes < mesDe(p.plantioEm)) throw new PmoError("Vistoria antes do plantio.");
  if (v.mes > mesDe(agoraIso.slice(0, 10))) throw new PmoError("Vistoria de mês futuro.");
  if (!(Number.isInteger(v.vivas) && v.vivas >= 0 && v.vivas <= p.exigidas + v.replantadas)) throw new PmoError("Contagem de mudas vivas inválida.");
  if (!(Number.isInteger(v.replantadas) && v.replantadas >= 0)) throw new PmoError("Replantio inválido.");
  const nova: VistoriaPlantio = { mes: v.mes, vivas: v.vivas, replantadas: v.replantadas, em: agoraIso, por: por.trim().slice(0, 100) || "—", ...(v.nota?.trim() ? { nota: v.nota.trim().slice(0, 500) } : {}) };
  return { ...p, vistorias: [...p.vistorias.filter((x) => x.mes !== v.mes), nova].sort((a, b) => a.mes.localeCompare(b.mes)) };
}

/** Índice de pega = vivas na última vistoria ÷ exigidas (pode passar de 1 com replantio). */
export const indicePega = (p: Plantio): number | null => (p.vistorias.length ? p.vistorias.at(-1)!.vivas / p.exigidas : null);

export function statusPlantio(p: Plantio, hoje: string): { nivel: Nivel; mensagem: string; mes: number; encerrado: boolean } {
  const mes = Math.max(0, mesesEntre(mesDe(p.plantioEm), mesDe(hoje)));
  const pega = indicePega(p);
  const pegaTxt = pega === null ? "sem vistoria" : `pega de ${(pega * 100).toFixed(0)}%`;
  if (mes > p.meses && pega !== null && pega >= p.metaPega) return { nivel: "verde", mensagem: `${p.meses} meses de manutenção cumpridos (${pegaTxt}): pronto para o termo de quitação.`, mes, encerrado: true };
  if (pega !== null && pega < p.metaPega) return { nivel: pega < p.metaPega - 0.15 ? "vermelho" : "amarelo", mensagem: `${p.tcra}: ${pegaTxt}, abaixo da meta de ${(p.metaPega * 100).toFixed(0)}%: programar replantio.`, mes, encerrado: false };
  // Vistoria mensal: a do mês anterior precisa existir depois do dia 10.
  const anterior = mesAnterior(mesDe(hoje));
  if (anterior >= mesDe(p.plantioEm) && Number(hoje.slice(8)) > 10 && !p.vistorias.some((x) => x.mes === anterior)) {
    return { nivel: "amarelo", mensagem: `${p.tcra}: vistoria de ${anterior.slice(5)}/${anterior.slice(0, 4)} não registrada (mês ${mes} de ${p.meses}).`, mes, encerrado: false };
  }
  return { nivel: "verde", mensagem: `Mês ${mes} de ${p.meses} · ${pegaTxt} · plantio em ${dataBr(p.plantioEm)}.`, mes, encerrado: false };
}

import { workDaysBetween, type WorkCalendar, DEFAULT_CALENDAR } from "../cpm/calendar";
import { PmoError } from "../errors";
import { addDays, addYears, daysBetween, isIsoDate, isObj, optText, text, type Nivel } from "./common";
import { csvColuna, csvFold, csvTabela } from "./cadastro";

/**
 * Módulo 2 — Radar Regulatório. Prazos do Documento Operacional da Sol Maior (v1.0), como PARÂMETROS editáveis:
 * a fonte é o documento do cliente, não a norma; confirme com o jurídico antes de usar como prazo legal.
 */

export const FRENTES = ["municipal", "ambiental", "saneamento", "rodoviario", "outro"] as const;
export type Frente = (typeof FRENTES)[number];
export const FRENTE_LABEL: Record<Frente, string> = {
  municipal: "A · SDUH / Prefeitura (urbanismo, Lei 6.766/79)",
  ambiental: "B · CETESB (LP/LI/LO, fauna e flora, APP)",
  saneamento: "C · SP Águas / DAEE / SABESP",
  rodoviario: "D · DER / ARTESP (acessos e faixa não edificável)",
  outro: "Outro órgão",
};

export const SITUACOES = ["em_elaboracao", "protocolado", "em_analise", "ret_aberto", "aprovado", "indeferido", "arquivado"] as const;
export type Situacao = (typeof SITUACOES)[number];
export const SITUACAO_LABEL: Record<Situacao, string> = {
  em_elaboracao: "Em elaboração", protocolado: "Protocolado", em_analise: "Em análise no órgão", ret_aberto: "Exigência (RET) em aberto",
  aprovado: "Aprovado", indeferido: "Indeferido", arquivado: "Arquivado",
};
const ENCERRADAS: readonly Situacao[] = ["aprovado", "indeferido", "arquivado"];

/** Com quem está o processo depois do evento: define se o tempo conta como SLA interno ou como tempo de órgão. */
export type ComQuem = "interno" | "orgao";
export interface EventoProcesso {
  data: string;
  descricao: string;
  com: ComQuem;
}

export interface Ret {
  emitidoEm: string;
  /** Data em que a petição de prorrogação foi protocolada. */
  prorrogacaoEm?: string;
  /** Data em que a resposta à exigência foi protocolada. */
  respondidoEm?: string;
}

export interface Certificado {
  emitidoEm: string;
  validadeAnos: number;
  renovadoEm?: string;
}

export interface ProcessoRegulatorio {
  id: string;
  frente: Frente;
  orgao: string;
  assunto: string;
  protocolo?: string;
  situacao: Situacao;
  eventos: EventoProcesso[];
  ret?: Ret;
  certificado?: Certificado;
  /** v1.1 (F2.02/F2.03) — Matriz de Risco do licenciamento, revista a cada check-in. */
  riscos?: RiscoLicenciamento[];
}

/** Item da Matriz de Risco do licenciamento (probabilidade × impacto, 1 a 5). */
export interface RiscoLicenciamento {
  id: string;
  descricao: string;
  probabilidade: number;
  impacto: number;
  mitigacao?: string;
  responsavel?: string;
  revisadoEm: string;
  encerrado?: boolean;
  /** Categoria do risco (validação v2). */
  categoria?: CategoriaRisco;
  /** Quem validou o plano de mitigação (gestão regulatória e engenharia). */
  validadoPor?: string;
}

export const CATEGORIAS_RISCO = ["prazo_orgao", "exigencia_tecnica", "ambiental", "fundiario_juridico", "projeto", "custo_taxas", "outro"] as const;
export type CategoriaRisco = (typeof CATEGORIAS_RISCO)[number];
export const CATEGORIA_RISCO_LABEL: Record<CategoriaRisco, string> = {
  prazo_orgao: "Prazo do órgão",
  exigencia_tecnica: "Exigência técnica (RET)",
  ambiental: "Ambiental (APP, fauna, flora, compensação)",
  fundiario_juridico: "Fundiário / jurídico",
  projeto: "Projeto / compatibilização",
  custo_taxas: "Custo e taxas",
  outro: "Outro",
};

export const scoreRisco = (r: RiscoLicenciamento) => r.probabilidade * r.impacto;
/** Faixa do risco: até 6 baixo, até 14 médio, a partir de 15 alto. */
export const faixaRisco = (r: RiscoLicenciamento): "baixo" | "medio" | "alto" => (scoreRisco(r) >= 15 ? "alto" : scoreRisco(r) >= 7 ? "medio" : "baixo");

function cleanRisco(v: unknown): RiscoLicenciamento | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 20), descricao = text(v.descricao, 400);
  const nota = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
  if (!id || !descricao || !nota(v.probabilidade) || !nota(v.impacto) || !isIsoDate(v.revisadoEm)) return null;
  const r: RiscoLicenciamento = { id, descricao, probabilidade: v.probabilidade as number, impacto: v.impacto as number, revisadoEm: v.revisadoEm };
  const m = optText(v.mitigacao, 600);
  if (m) r.mitigacao = m;
  const resp = optText(v.responsavel, 100);
  if (resp) r.responsavel = resp;
  if ((CATEGORIAS_RISCO as readonly unknown[]).includes(v.categoria)) r.categoria = v.categoria as CategoriaRisco;
  const val = optText(v.validadoPor, 100);
  if (val) r.validadoPor = val;
  if (v.encerrado === true) r.encerrado = true;
  return r;
}

export function incluirRisco(proc: ProcessoRegulatorio, dados: Omit<RiscoLicenciamento, "id">): ProcessoRegulatorio {
  const lista = proc.riscos ?? [];
  const r = cleanRisco({ ...dados, id: `R${lista.length + 1}` });
  if (!r) throw new PmoError("Risco inválido: descreva o risco e dê probabilidade e impacto de 1 a 5.");
  if (faixaRisco(r) === "alto" && !r.mitigacao) throw new PmoError("Risco alto exige plano de mitigação.");
  return { ...proc, riscos: [...lista, r] };
}

/** Pendências da Matriz de Risco do processo: obrigatória (F2.02) e revista no check-in semanal (F2.03). */
export function pendenciasMatriz(proc: ProcessoRegulatorio, hoje: string, checkinDias = 7): string[] {
  if (processoEncerrado(proc)) return [];
  const ativos = (proc.riscos ?? []).filter((r) => !r.encerrado);
  const out: string[] = [];
  if (!ativos.length) out.push("sem Matriz de Risco");
  else {
    const ultima = ativos.reduce((m, r) => (r.revisadoEm > m ? r.revisadoEm : m), "");
    if (proc.situacao !== "em_elaboracao" && daysBetween(ultima, hoje) > checkinDias) out.push(`Matriz de Risco sem revisão há ${daysBetween(ultima, hoje)} dias`);
    const altos = ativos.filter((r) => faixaRisco(r) === "alto" && !r.mitigacao);
    if (altos.length) out.push(`${altos.length} risco(s) alto(s) sem mitigação`);
  }
  return out;
}

/**
 * Travas para protocolar (F2.01/F2.02): Matriz de Risco montada e, na frente municipal, a análise do
 * Plano Diretor concluída e conforme (v1.1). `planoDiretor` vem de `conformidadePlanoDiretor(...).status`.
 */
export function travasProtocolo(proc: ProcessoRegulatorio, planoDiretor: "pendente" | "conforme" | "nao_conforme"): string[] {
  const t: string[] = [];
  if (!(proc.riscos ?? []).some((r) => !r.encerrado)) t.push("Matriz de Risco do licenciamento obrigatória antes do protocolo (F2.02)");
  if (planoDiretor !== "conforme") t.push(planoDiretor === "pendente" ? "Análise do Plano Diretor não concluída (F1.02)" : "Projeto não conforme com o Plano Diretor");
  return t;
}

/**
 * Importa a Planilha Própria (o mesmo CSV que a exportação gera, ou uma planilha com as colunas frente,
 * orgao, assunto, protocolo e situacao). Processo existente (mesmo órgão e assunto) recebe protocolo e
 * situação; os demais entram como novos. Nada é apagado.
 */
export function importPlanilhaAcompanhamentoCsv(csv: string, atuais: readonly ProcessoRegulatorio[]): { processos: ProcessoRegulatorio[]; novos: number; atualizados: number; erros: { linha: number; mensagem: string }[] } {
  const { header, rows } = csvTabela(csv);
  const io = csvColuna(header, "orgao"), ia = csvColuna(header, "assunto", "objeto"), ifr = csvColuna(header, "frente"), ip = csvColuna(header, "protocolo"), is = csvColuna(header, "situacao", "status");
  if (io < 0 || ia < 0) throw new PmoError("A planilha precisa das colunas orgao e assunto.");
  const frenteDe = (t: string): Frente => {
    const f = csvFold(t);
    const porRotulo = FRENTES.find((x) => csvFold(x) === f || csvFold(FRENTE_LABEL[x]) === f);
    if (porRotulo) return porRotulo;
    const letra: Record<string, Frente> = { a: "municipal", b: "ambiental", c: "saneamento", d: "rodoviario" };
    if (letra[f]) return letra[f]!;
    if (/sduh|prefeitura|municip|urban/.test(f)) return "municipal";
    if (/cetesb|ambient/.test(f)) return "ambiental";
    if (/daee|sabesp|aguas|saneam/.test(f)) return "saneamento";
    if (/artesp|rodov|^der/.test(f)) return "rodoviario";
    return "outro";
  };
  const situacaoDe = (t: string): Situacao | undefined => SITUACOES.find((x) => csvFold(x) === csvFold(t) || csvFold(SITUACAO_LABEL[x]) === csvFold(t));
  let lista = [...atuais];
  let novos = 0, atualizados = 0;
  const erros: { linha: number; mensagem: string }[] = [];
  for (const r of rows) {
    const orgao = (r.cells[io] ?? "").trim().slice(0, 120), assunto = (r.cells[ia] ?? "").trim().slice(0, 300);
    if (!orgao || !assunto) { erros.push({ linha: r.linha, mensagem: "órgão ou assunto em branco" }); continue; }
    const protocolo = ip >= 0 ? (r.cells[ip] ?? "").trim().slice(0, 80) : "";
    const sitTxt = is >= 0 ? (r.cells[is] ?? "").trim() : "";
    const situacao = sitTxt ? situacaoDe(sitTxt) : undefined;
    if (sitTxt && !situacao) erros.push({ linha: r.linha, mensagem: `situação "${sitTxt}" não reconhecida (mantida a atual)` });
    const i = lista.findIndex((p) => csvFold(p.orgao) === csvFold(orgao) && csvFold(p.assunto) === csvFold(assunto));
    if (i >= 0) {
      const p = lista[i]!;
      const novo = { ...p, ...(protocolo ? { protocolo } : {}), ...(situacao ? { situacao } : {}) };
      if (JSON.stringify(novo) !== JSON.stringify(p)) { lista[i] = novo; atualizados++; }
    } else {
      lista = [...lista, { id: nextProcessoId(lista), frente: ifr >= 0 ? frenteDe(r.cells[ifr] ?? "") : "outro", orgao, assunto, ...(protocolo ? { protocolo } : {}), situacao: situacao ?? (protocolo ? "protocolado" : "em_elaboracao"), eventos: [] }];
      novos++;
    }
  }
  return { processos: lista, novos, atualizados, erros };
}

/** Planilha Própria de Acompanhamento (F2.02): uma linha por processo, em CSV (; e decimal brasileiro). */
export function planilhaAcompanhamentoCsv(processos: readonly ProcessoRegulatorio[], hoje: string): string {
  const q = (t: string) => (/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  const linhas = ["frente;orgao;assunto;protocolo;situacao;ultimo_evento;data_ultimo_evento;ret_emitido;ret_respondido;certificado;riscos_ativos;maior_risco;pendencias"];
  for (const p of processos) {
    const ult = p.eventos.at(-1);
    const ativos = (p.riscos ?? []).filter((r) => !r.encerrado);
    const maior = ativos.reduce((m, r) => Math.max(m, scoreRisco(r)), 0);
    linhas.push([FRENTE_LABEL[p.frente], p.orgao, p.assunto, p.protocolo ?? "", SITUACAO_LABEL[p.situacao], ult?.descricao ?? "", ult?.data ?? "", p.ret?.emitidoEm ?? "", p.ret?.respondidoEm ?? "", p.certificado?.emitidoEm ?? "", String(ativos.length), maior ? String(maior) : "", pendenciasMatriz(p, hoje).join(" | ")].map(q).join(";"));
  }
  return linhas.join("\n");
}

export interface NotaDevolutiva { recebidaEm: string; respondidaEm?: string }
export interface Cartorio {
  /** Data do decreto/alvará municipal de aprovação: inicia o prazo de 180 dias. */
  decretoEm: string;
  pacoteCompletoEm?: string;
  prenotadoEm?: string;
  notas: NotaDevolutiva[];
  /** Emissão das matrículas individualizadas (R-01). */
  registradoEm?: string;
}

/** Parâmetros (padrões do documento da Sol Maior). Dias corridos, salvo onde indicado. */
export interface ParametrosRegulatorios {
  retPrazoDias: number;
  retProrrogacaoDias: number;
  retAmareloDia: number;
  retVermelhoDia: number;
  retPeticaoDia: number;
  /** Meta interna de resposta ao RET. */
  retSlaInternoDias: number;
  cartorioPrazoDias: number;
  cartorioPacoteDia: number;
  cartorioProtocoloDia: number;
  cartorioVermelhoDia: number;
  cartorioCriticoDia: number;
  cartorioMetaRegistroDia: number;
  /** Prazo de resposta a nota devolutiva, em dias úteis. */
  notaDevolutivaDiasUteis: number;
  certificadoAvisoDias: number;
  checkinDias: number;
}

export const PARAMETROS_PADRAO: ParametrosRegulatorios = Object.freeze({
  retPrazoDias: 60, retProrrogacaoDias: 120, retAmareloDia: 30, retVermelhoDia: 40, retPeticaoDia: 45, retSlaInternoDias: 40,
  cartorioPrazoDias: 180, cartorioPacoteDia: 20, cartorioProtocoloDia: 30, cartorioVermelhoDia: 90, cartorioCriticoDia: 120, cartorioMetaRegistroDia: 120,
  notaDevolutivaDiasUteis: 10, certificadoAvisoDias: 180, checkinDias: 7,
});

export function validarParametros(p: ParametrosRegulatorios): void {
  for (const [k, v] of Object.entries(p)) if (!Number.isInteger(v) || v < 0 || v > 3650) throw new PmoError(`Parâmetro ${k}: use um número inteiro de dias entre 0 e 3650.`);
  if (!(p.retAmareloDia < p.retVermelhoDia && p.retVermelhoDia < p.retPeticaoDia && p.retPeticaoDia <= p.retPrazoDias)) throw new PmoError("RET: os marcos precisam seguir amarelo < vermelho < petição ≤ prazo.");
  if (!(p.cartorioProtocoloDia < p.cartorioVermelhoDia && p.cartorioVermelhoDia < p.cartorioCriticoDia && p.cartorioCriticoDia < p.cartorioPrazoDias)) throw new PmoError("Cartório: os marcos precisam seguir protocolo < vermelho < crítico < prazo.");
}

export function cleanParametros(v: unknown): ParametrosRegulatorios | null {
  if (!isObj(v)) return null;
  const out = { ...PARAMETROS_PADRAO } as ParametrosRegulatorios;
  for (const k of Object.keys(PARAMETROS_PADRAO) as (keyof ParametrosRegulatorios)[]) if (Number.isInteger(v[k])) out[k] = v[k] as number;
  try { validarParametros(out); } catch { return null; }
  return out;
}

/* ------------------------------------ limpeza ------------------------------------ */

export const MAX_PROCESSOS = 120;
const MAX_EVENTOS = 200;

export function cleanProcesso(v: unknown): ProcessoRegulatorio | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 40), orgao = text(v.orgao, 80), assunto = text(v.assunto, 160);
  if (!id || !orgao || !assunto) return null;
  if (!(FRENTES as readonly string[]).includes(v.frente as string) || !(SITUACOES as readonly string[]).includes(v.situacao as string)) return null;
  const eventos: EventoProcesso[] = [];
  for (const e of Array.isArray(v.eventos) ? v.eventos.slice(-MAX_EVENTOS) : []) {
    if (!isObj(e) || !isIsoDate(e.data) || (e.com !== "interno" && e.com !== "orgao")) continue;
    const d = text(e.descricao, 240);
    if (d) eventos.push({ data: e.data, descricao: d, com: e.com });
  }
  eventos.sort((a, b) => a.data.localeCompare(b.data));
  const p: ProcessoRegulatorio = { id, frente: v.frente as Frente, orgao, assunto, situacao: v.situacao as Situacao, eventos };
  const prot = optText(v.protocolo, 60);
  if (prot) p.protocolo = prot;
  if (isObj(v.ret) && isIsoDate(v.ret.emitidoEm)) {
    const r: Ret = { emitidoEm: v.ret.emitidoEm };
    if (isIsoDate(v.ret.prorrogacaoEm) && v.ret.prorrogacaoEm >= r.emitidoEm) r.prorrogacaoEm = v.ret.prorrogacaoEm;
    if (isIsoDate(v.ret.respondidoEm) && v.ret.respondidoEm >= r.emitidoEm) r.respondidoEm = v.ret.respondidoEm;
    p.ret = r;
  }
  if (isObj(v.certificado) && isIsoDate(v.certificado.emitidoEm) && Number.isInteger(v.certificado.validadeAnos) && (v.certificado.validadeAnos as number) >= 1 && (v.certificado.validadeAnos as number) <= 20) {
    const c: Certificado = { emitidoEm: v.certificado.emitidoEm, validadeAnos: v.certificado.validadeAnos as number };
    if (isIsoDate(v.certificado.renovadoEm) && v.certificado.renovadoEm >= c.emitidoEm) c.renovadoEm = v.certificado.renovadoEm;
    p.certificado = c;
  }
  const riscos = (Array.isArray(v.riscos) ? v.riscos : []).flatMap((r) => cleanRisco(r) ?? []).slice(0, 60);
  if (riscos.length) p.riscos = riscos;
  return p;
}

export function cleanCartorio(v: unknown): Cartorio | null {
  if (!isObj(v) || !isIsoDate(v.decretoEm)) return null;
  const c: Cartorio = { decretoEm: v.decretoEm, notas: [] };
  for (const k of ["pacoteCompletoEm", "prenotadoEm", "registradoEm"] as const) if (isIsoDate(v[k]) && (v[k] as string) >= c.decretoEm) c[k] = v[k] as string;
  for (const n of Array.isArray(v.notas) ? v.notas.slice(0, 50) : []) {
    if (!isObj(n) || !isIsoDate(n.recebidaEm)) continue;
    c.notas.push(isIsoDate(n.respondidaEm) && n.respondidaEm >= n.recebidaEm ? { recebidaEm: n.recebidaEm, respondidaEm: n.respondidaEm } : { recebidaEm: n.recebidaEm });
  }
  return c;
}

/* ------------------------------------ relógios ------------------------------------ */

export interface Relogio {
  nivel: Nivel;
  /** Frase pronta para a tela. */
  mensagem: string;
  /** Dias corridos desde o marco inicial. */
  dia: number;
  /** Data-limite atual. */
  prazo: string;
  /** Dias corridos que faltam até o prazo (negativo = vencido). */
  saldo: number;
}

/** RET: 60 dias (+120 com prorrogação), amarelo em D+30, vermelho em D+40, crítico em D+45 sem petição de prorrogação. */
export function relogioRet(ret: Ret, hoje: string, p: ParametrosRegulatorios = PARAMETROS_PADRAO): Relogio {
  const dia = daysBetween(ret.emitidoEm, ret.respondidoEm ?? hoje);
  const prazoBase = addDays(ret.emitidoEm, p.retPrazoDias);
  const prazo = ret.prorrogacaoEm ? addDays(prazoBase, p.retProrrogacaoDias) : prazoBase;
  const saldo = daysBetween(hoje, prazo);
  if (ret.respondidoEm) {
    const noSla = dia <= p.retSlaInternoDias;
    return { nivel: "verde", dia, prazo, saldo, mensagem: `Respondido em D+${dia}${noSla ? "" : ` (acima da meta interna de ${p.retSlaInternoDias} dias)`}.` };
  }
  if (saldo < 0) return { nivel: "critico", dia, prazo, saldo, mensagem: `Prazo do RET vencido há ${-saldo} dia(s).` };
  if (ret.prorrogacaoEm) {
    const nivel: Nivel = saldo <= 15 ? "vermelho" : saldo <= 30 ? "amarelo" : "verde";
    return { nivel, dia, prazo, saldo, mensagem: `Prorrogado: faltam ${saldo} dia(s) para responder.` };
  }
  if (dia >= p.retPeticaoDia) return { nivel: "critico", dia, prazo, saldo, mensagem: `D+${dia} sem petição de prorrogação: protocolar hoje. Faltam ${saldo} dia(s).` };
  if (dia >= p.retVermelhoDia) return { nivel: "vermelho", dia, prazo, saldo, mensagem: `D+${dia}: preparar a petição de prorrogação até D+${p.retPeticaoDia}.` };
  if (dia >= p.retAmareloDia) return { nivel: "amarelo", dia, prazo, saldo, mensagem: `D+${dia}: plano de ação na reunião semanal.` };
  return { nivel: "verde", dia, prazo, saldo, mensagem: `D+${dia}: no prazo; meta interna de resposta em D+${p.retSlaInternoDias}.` };
}

/** Cartório: 180 dias do decreto (art. 18 da Lei 6.766/79, conforme o documento). */
export function relogioCartorio(c: Cartorio, hoje: string, p: ParametrosRegulatorios = PARAMETROS_PADRAO, cal: WorkCalendar = DEFAULT_CALENDAR): Relogio & { notasAtrasadas: number } {
  const fim = c.registradoEm ?? hoje;
  const dia = daysBetween(c.decretoEm, fim);
  const prazo = addDays(c.decretoEm, p.cartorioPrazoDias);
  const saldo = daysBetween(hoje, prazo);
  const notasAtrasadas = c.notas.filter((n) => !n.respondidaEm && workDaysBetween(n.recebidaEm, hoje, cal) > p.notaDevolutivaDiasUteis).length;
  const base = { dia, prazo, saldo, notasAtrasadas };
  if (c.registradoEm) return { ...base, nivel: "verde", mensagem: `Registrado (R-01) em D+${dia}${dia > p.cartorioMetaRegistroDia ? `, depois da meta de D+${p.cartorioMetaRegistroDia}` : ""}.` };
  if (saldo < 0) return { ...base, nivel: "critico", mensagem: `Prazo caducal de ${p.cartorioPrazoDias} dias vencido há ${-saldo} dia(s): aprovação municipal em risco de caducar.` };
  if (dia >= p.cartorioCriticoDia) return { ...base, nivel: "critico", mensagem: `D+${dia} sem registro: faltam ${saldo} dia(s) do prazo caducal.` };
  if (dia >= p.cartorioVermelhoDia) return { ...base, nivel: "vermelho", mensagem: `D+${dia} sem registro: intervenção da diretoria. Faltam ${saldo} dia(s).` };
  if (notasAtrasadas > 0) return { ...base, nivel: "vermelho", mensagem: `${notasAtrasadas} nota(s) devolutiva(s) sem resposta há mais de ${p.notaDevolutivaDiasUteis} dias úteis. Faltam ${saldo} dia(s).` };
  if (dia >= p.cartorioProtocoloDia && !c.prenotadoEm) return { ...base, nivel: "amarelo", mensagem: `D+${dia} sem protocolo (prenotação) no cartório. Faltam ${saldo} dia(s).` };
  if (dia >= p.cartorioPacoteDia && !c.pacoteCompletoEm) return { ...base, nivel: "amarelo", mensagem: `D+${dia} com o pacote cartorário incompleto. Faltam ${saldo} dia(s).` };
  return { ...base, nivel: "verde", mensagem: `D+${dia}: faltam ${saldo} dia(s); meta de registro em D+${p.cartorioMetaRegistroDia}.` };
}

/** Certificado GRAPROHAB: validade (4 anos, conforme o documento) e aviso de renovação 180 dias antes. */
export function relogioCertificado(c: Certificado, hoje: string, p: ParametrosRegulatorios = PARAMETROS_PADRAO): Relogio {
  const inicio = c.renovadoEm ?? c.emitidoEm;
  const prazo = addYears(inicio, c.validadeAnos);
  const saldo = daysBetween(hoje, prazo);
  const dia = daysBetween(inicio, hoje);
  if (saldo < 0) return { nivel: "critico", dia, prazo, saldo, mensagem: `Certificado vencido há ${-saldo} dia(s).` };
  if (saldo <= p.certificadoAvisoDias / 2) return { nivel: "vermelho", dia, prazo, saldo, mensagem: `Certificado vence em ${saldo} dia(s): pedir a renovação.` };
  if (saldo <= p.certificadoAvisoDias) return { nivel: "amarelo", dia, prazo, saldo, mensagem: `Certificado vence em ${saldo} dia(s): iniciar a renovação.` };
  return { nivel: "verde", dia, prazo, saldo, mensagem: `Válido até ${prazo}.` };
}

/** Tempo do processo dividido entre a Sol Maior (interno) e o órgão, pelos eventos registrados (dias corridos). */
export function tempoInternoExterno(proc: ProcessoRegulatorio, hoje: string): { interno: number; orgao: number } {
  const out = { interno: 0, orgao: 0 };
  const ev = proc.eventos;
  const aberto = !ENCERRADAS.includes(proc.situacao);
  for (let i = 0; i < ev.length; i++) {
    const ate = i + 1 < ev.length ? ev[i + 1]!.data : aberto ? hoje : ev[i]!.data;
    out[ev[i]!.com] += Math.max(0, daysBetween(ev[i]!.data, ate));
  }
  return out;
}

/** Check-in semanal: processo aberto no órgão sem movimento registrado há mais de 7 dias. */
export function semCheckin(proc: ProcessoRegulatorio, hoje: string, p: ParametrosRegulatorios = PARAMETROS_PADRAO): number | null {
  if (!(["protocolado", "em_analise"] as Situacao[]).includes(proc.situacao)) return null;
  const ultimo = proc.eventos.at(-1)?.data;
  if (!ultimo) return null;
  const d = daysBetween(ultimo, hoje);
  return d > p.checkinDias ? d : null;
}

export const processoEncerrado = (p: ProcessoRegulatorio) => ENCERRADAS.includes(p.situacao);

export function nextProcessoId(list: readonly { id: string }[]): string {
  const n = list.reduce((m, p) => Math.max(m, Number(/^PR-(\d+)$/.exec(p.id)?.[1] ?? 0)), 0);
  return `PR-${String(n + 1).padStart(3, "0")}`;
}

import type { Decisao, Solicitacao } from "./alcadas";
import { nextSolicitacaoId } from "./alcadas";
import { CHECKLIST_PADRAO, type FrenteObra, type FrenteTrecho } from "./campo";
import type { LoteadoraState } from "./state";

/**
 * Dados do piloto Nova Marina: quadro de áreas, VGV e breakeven (Plano de Implementação Sol Maior) e, da
 * planilha de acompanhamento nova_marina.xlsx, os 25 trechos de via, a terraplenagem concluída em todos
 * e as 10 disciplinas de custo (ligadas às atividades TER-, LAG-, COM-… do cronograma, quando importado).
 * As 3 aprovações (Pavimix, HidroSan, Edlin) batem com a planilha (guias R$ 550.200; reservatório +
 * booster R$ 900.000). O espelho dos 295 lotes não está na planilha.
 */
export const NOVA_MARINA = {
  areaTotalM2: 276_224.84,
  areaLotesM2: 127_283.1,
  areaViarioM2: 43_255.44,
  areaVerdesM2: 99_320.97,
  areaInstitucionalM2: 6_365.33,
  totalLotes: 295,
  vgv: 127_283_100,
  breakevenLotes: 80,
  custoBreakeven: 34_496_367.61,
  mudasTcra: 6_915,
  /** Vias da planilha nova_marina.xlsx (aba Pavimentação): pista, passeio e pavimento líquido. */
  trechos: [
    ["T01", "Avenida Rio Jaguari", "Trecho 01", 12, 2, 8104.55],
    ["T02", "Rua da Carpa", "Trecho 01", 11, 1.5, 1275.22],
    ["T03", "Rua da Carpa", "Trecho 02", 11, 1.5, 1301.85],
    ["T04", "Rua da Corvina", "Trecho 01", 11, 1.5, 1539.95],
    ["T05", "Rua da Corvina", "Trecho 02", 11, 1.5, 1434.75],
    ["T06", "Rua da Jacunda", "Trecho 01", 11, 1.5, 2784.16],
    ["T07", "Rua da Tilapia", "Trecho 01", 11, 1.5, 705.15],
    ["T08", "Rua do Acará", "Trecho 01", 11, 1.5, 985.2],
    ["T09", "Rua do Acará", "Trecho 02", 11, 1.5, 1488.63],
    ["T10", "Rua do Cascudo", "Trecho 01", 11, 1.5, 1407.58],
    ["T11", "Rua do Cascudo", "Trecho 02", 11, 1.5, 1316.99],
    ["T12", "Rua do Corimbatá", "Trecho 01", 11, 1.5, 1190.94],
    ["T13", "Rua do Corimbatá", "Trecho 02", 11, 1.5, 1731.25],
    ["T14", "Rua do Dourado", "Trecho 01", 11, 1.5, 770.51],
    ["T15", "Rua do Dourado", "Trecho 02", 11, 1.5, 3174.53],
    ["T16", "Rua do Jundiá", "Trecho 01", 11, 1.5, 2174.2],
    ["T17", "Rua do Jundiá", "Trecho 02", 11, 1.5, 216.44],
    ["T18", "Rua do Lambari", "Trecho 01", 11, 1.5, 2812.36],
    ["T19", "Rua do Pintado", "Trecho 01", 11, 1.5, 3269.6],
    ["T20", "Rua do Surubim", "Trecho 01", 11, 1.5, 4468.92],
    ["T21", "Rua do Tambiu", "Trecho 01", 11, 2, 3153.29],
    ["T22", "Rua do Tucunaré", "Trecho 01", 11, 1.5, 3547.89],
    ["T23", "Alargamento da Rua Lourenço Antonio Pedro", "Trecho 1", 12, 0, 12.47],
    ["T24", "Alargamento da Rua Lourenço Antonio Pedro", "Trecho 2", 12, 0, 110.79],
    ["T25", "Alargamento da Rua Lourenço Antonio Pedro", "Trecho 3", 12, 0, 90.32],
  ],
  /** As 10 disciplinas de custo direto (planilha nova_marina.xlsx), com o prefixo das atividades. */
  disciplinas: [
    ["Terraplenagem", "TER", 600_000],
    ["Lagoa de retenção", "LAG", 330_000],
    ["Plantio compensatório", "COM", 116_500],
    ["Drenagem pluvial", "DRE", 814_000],
    ["Guia e sarjeta extrusada", "GUI", 550_200],
    ["Rede elétrica", "ELE", 1_100_000],
    ["Rede de água", "AGU", 2_314_750],
    ["Pavimentação asfáltica", "PAV", 4_857_687.67],
    ["Sinalização de trânsito", "SIN", 290_900],
    ["Arborização das calçadas", "ARB", 50_718],
  ],
} as const;

export interface ResultadoSeed {
  estado: LoteadoraState;
  incluidos: string[];
  mantidos: string[];
}

/** Aplica o seed sem sobrescrever: cada bloco só entra se a obra ainda não tem aquele dado. */
export function aplicarSeedNovaMarina(s: LoteadoraState, agoraIso: string, por: string, atividades: readonly { id: string; nome: string }[] = []): ResultadoSeed {
  const incluidos: string[] = [];
  const mantidos: string[] = [];
  let e: LoteadoraState = { ...s };
  const nm = NOVA_MARINA;

  if (!e.ficha.areaBrutaM2) {
    e = {
      ...e,
      ficha: {
        ...e.ficha,
        tipo: e.ficha.tipo ?? "loteamento",
        municipio: e.ficha.municipio ?? "Peruíbe",
        uf: e.ficha.uf ?? "SP",
        areaBrutaM2: nm.areaTotalM2,
        areaVendavelM2: nm.areaLotesM2,
        areaCessaoM2: Math.round((nm.areaViarioM2 + nm.areaVerdesM2 + nm.areaInstitucionalM2) * 100) / 100,
      },
    };
    incluidos.push("quadro de áreas");
  } else mantidos.push("quadro de áreas");

  if (e.vgv === undefined) {
    e = { ...e, vgv: nm.vgv };
    incluidos.push("VGV de referência");
  } else mantidos.push("VGV");
  if (e.comercial.breakevenLotes === undefined) {
    e = { ...e, comercial: { ...e.comercial, breakevenLotes: nm.breakevenLotes } };
    incluidos.push("breakeven de 80 lotes");
  }

  if (!e.trechos.length) {
    e = { ...e, trechos: nm.trechos.map(([id, rua, nome, pista, passeio, m2]) => ({ id, rua, nome, larguraPistaM: pista, passeioM: passeio, pavimentoM2: m2 })) };
    incluidos.push(`${nm.trechos.length} trechos de via`);
  } else mantidos.push("ruas e trechos");

  // Terraplenagem concluída na obra inteira (TER-001 a TER-004 concluídas em 30/04/2024).
  if (!e.frentes.length) {
    e = {
      ...e,
      frentes: e.trechos.map((t) => ({
        trechoId: t.id,
        frente: "terraplenagem" as FrenteObra,
        percent: 100,
        iniciadaEm: "2024-03-01",
        concluidaEm: "2024-04-30",
        checklist: CHECKLIST_PADRAO.terraplenagem.map((item) => ({ item, ok: true, por, em: "2024-04-30" })),
      })),
    };
    incluidos.push("terraplenagem concluída em todos os trechos");
  } else mantidos.push("avanço de campo");

  if (!e.etapas.length) {
    const cod = (nome: string) => /^([A-Z]{3})-\d{3}/.exec(nome.trim())?.[1];
    e = {
      ...e,
      etapas: nm.disciplinas.map(([nome, prefixo, orcado], i) => ({
        id: `ET-${String(i + 1).padStart(2, "0")}`,
        nome,
        orcado,
        atividades: atividades.filter((a) => cod(a.nome) === prefixo).map((a) => a.id),
      })),
    };
    incluidos.push("10 disciplinas de custo");
  } else mantidos.push("orçamento por disciplina");

  const titulos = new Set(e.solicitacoes.map((x) => x.titulo));
  const pre = (papelNome: string): Decisao => ({ etapa: "pre_aprovacao", acao: "aprovar", membroId: "seed-diretoria-tecnica", nome: papelNome, papel: "diretoria_tecnica", em: agoraIso, justificativa: "Visto técnico prévio (dados do piloto)" });
  const novas: Array<Omit<Solicitacao, "id">> = [
    { tipo: "aditivo", titulo: "Aditivo de escopo — guias e sarjetas extrusadas, 7.860 m FCK 25 MPa (GUI-001) · Pavimix", valor: 550_200, urgente: true, impactoReforecast: 550_200, criadaEm: agoraIso, criadaPor: por, decisoes: [pre("Diretoria técnica")], reenvios: [] },
    { tipo: "contratacao", titulo: "Aquisição de reservatório + booster (AGU-002/AGU-003) · HidroSan", valor: 900_000, urgente: true, criadaEm: agoraIso, criadaPor: por, decisoes: [pre("Diretoria técnica")], reenvios: [] },
    { tipo: "medicao", titulo: "Medição nº 04 — tubos de concreto PA-2 Ø600/800 mm (DRE-001/DRE-002, retenção 5%) · Edlin", valor: 174_000, urgente: false, dentroDoContrato: true, criadaEm: agoraIso, criadaPor: por, decisoes: [pre("Diretoria técnica")], reenvios: [] },
  ];
  const faltam = novas.filter((n) => !titulos.has(n.titulo));
  if (faltam.length) {
    const lista = [...e.solicitacoes];
    for (const n of faltam) lista.push({ ...n, id: nextSolicitacaoId(lista) });
    e = { ...e, solicitacoes: lista };
    incluidos.push(`${faltam.length} aprovação(ões) pendente(s)`);
  } else mantidos.push("aprovações do piloto");

  return { estado: e, incluidos, mantidos };
}

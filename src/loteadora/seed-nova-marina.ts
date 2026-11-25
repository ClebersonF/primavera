import type { Decisao, Solicitacao } from "./alcadas";
import { nextSolicitacaoId } from "./alcadas";
import { CHECKLIST_PADRAO, type FrenteObra, type FrenteTrecho } from "./campo";
import type { LoteadoraState } from "./state";

/**
 * Dados oficiais do piloto Nova Marina (Plano de Implementação Sol Maior, v1): quadro de áreas, VGV,
 * breakeven, as 5 ruas com o avanço de campo por gate e as 3 aprovações pendentes. Só entra o que o
 * documento traz; espelho dos 295 lotes, 52 atividades e orçamento por disciplina dependem da base
 * solmaior_loteamentos_db.json e vêm pela importação de CSV.
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
  orcadoBase: 13_509_048.89,
  reforecast: 14_709_622.41,
  realizado: 8_399_469.73,
  mudasTcra: 6_915,
  ruas: [
    { id: "R-CARPA", rua: "Rua da Carpa", m2: 1964.08, guias: 80, base: 50, drenagem: true, aguaEsgoto: true, fck25: false },
    { id: "R-CORVINA", rua: "Rua da Corvina", m2: 3597.29, guias: 100, base: 60, drenagem: true, aguaEsgoto: true, fck25: true },
    { id: "R-JACUNDA", rua: "Rua do Jacundá", m2: 8105.63, guias: 40, base: 20, drenagem: true, aguaEsgoto: true, fck25: false },
    { id: "R-TILAPIA", rua: "Rua da Tilápia", m2: 6028.74, guias: 0, base: 0, drenagem: true, aguaEsgoto: false, fck25: false },
    { id: "R-ACARA", rua: "Rua do Acará", m2: 8832.57, guias: 0, base: 0, drenagem: false, aguaEsgoto: false, fck25: false },
  ],
} as const;

export interface ResultadoSeed {
  estado: LoteadoraState;
  incluidos: string[];
  mantidos: string[];
}

/** Aplica o seed sem sobrescrever: cada bloco só entra se a obra ainda não tem aquele dado. */
export function aplicarSeedNovaMarina(s: LoteadoraState, agoraIso: string, por: string): ResultadoSeed {
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
    e = { ...e, trechos: nm.ruas.map((r) => ({ id: r.id, rua: r.rua, nome: "Rua inteira", pavimentoM2: r.m2 })) };
    incluidos.push("5 ruas");
  } else mantidos.push("ruas e trechos");

  if (!e.frentes.length) {
    const fr = (trechoId: string, frente: FrenteObra, percent: number): FrenteTrecho[] =>
      percent > 0
        ? [{
            trechoId,
            frente,
            percent,
            iniciadaEm: agoraIso.slice(0, 10),
            checklist: CHECKLIST_PADRAO[frente].map((item) => ({ item, ok: percent >= 100 })),
            ...(percent >= 100 ? { concluidaEm: agoraIso.slice(0, 10) } : {}),
          }]
        : [];
    const frentes = nm.ruas.flatMap((r) => [
      ...fr(r.id, "drenagem", r.drenagem ? 100 : 0),
      ...fr(r.id, "agua_esgoto", r.aguaEsgoto ? 100 : 0),
      ...fr(r.id, "guias", r.guias === 100 && !r.fck25 ? 99 : r.guias),
      ...fr(r.id, "pavimentacao", r.base),
    ]);
    e = { ...e, frentes };
    incluidos.push("avanço de campo por rua (drenagem, água/esgoto, guias e base)");
  } else mantidos.push("avanço de campo");

  const titulos = new Set(e.solicitacoes.map((x) => x.titulo));
  const pre = (papelNome: string): Decisao => ({ etapa: "pre_aprovacao", acao: "aprovar", membroId: "seed-diretoria-tecnica", nome: papelNome, papel: "diretoria_tecnica", em: agoraIso, justificativa: "Visto técnico prévio (dados do piloto)" });
  const novas: Array<Omit<Solicitacao, "id">> = [
    { tipo: "aditivo", titulo: "Aditivo de escopo — guias extrusadas (5.849 m, FCK 25 MPa) · Pavimix", valor: 550_200, urgente: true, impactoReforecast: 550_200, criadaEm: agoraIso, criadaPor: por, decisoes: [pre("Diretoria técnica")], reenvios: [] },
    { tipo: "contratacao", titulo: "Aquisição de reservatório metálico 165 m³ + booster · HidroSan", valor: 900_000, urgente: true, criadaEm: agoraIso, criadaPor: por, decisoes: [pre("Diretoria técnica")], reenvios: [] },
    { tipo: "medicao", titulo: "Medição nº 04 — tubos de concreto PA-2 Ø600/800 mm (retenção 5%) · Edlin", valor: 174_000, urgente: false, dentroDoContrato: true, criadaEm: agoraIso, criadaPor: por, decisoes: [pre("Diretoria técnica")], reenvios: [] },
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

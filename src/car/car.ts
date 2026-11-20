/**
 * Avaliação de conformidade documental a partir do CAR (DataHub CreditPlanner v1), portada do CronosSuite.
 * Regras: nada é inferido; `null` nunca vira zero; a área canônica é a oficial; overlapAnalysis.current manda.
 * É apoio à análise: o veredito não substitui a análise do órgão ambiental nem o parecer técnico.
 */
import { formatarDataFonte } from "./dataFonte";

export type StatusDado = "AVAILABLE" | "EXPLICIT_ZERO" | "NOT_FOUND" | "NOT_LOADED" | "UNKNOWN";

export interface MetricaAmbiental {
  ha: number | null;
  status: StatusDado;
  percentual: number | null;
  deficit_ha: number | null;
}

export const SEM_DADO_FONTE = "Informação não encontrada na base consultada.";

export interface SobreposicaoFonte {
  tem_sobreposicao: boolean | null;
  total_ha: number | null;
  total_pct: number | null;
  restricao_ha: number | null;
  restricao_pct: number | null;
  car_ha: number | null;
  car_pct: number | null;
  outros_ha: number | null;
  outros_pct: number | null;
  verificado_em: string | null;
  shapes: number | null;
  /** Soma de feições: NÃO é cobertura física distinta. */
  feature_sum_ha?: number | null;
  coverage_semantics?: string | null;
}

export interface SobreposicaoItem {
  tipo: string;
  rotulo: string;
  ha: number | null;
  pct: number | null;
  pct_outro?: number | null;
  situacao: string | null;
  tem_geometria: boolean;
  categoria?: string | null;
}

export interface CarNormalizado {
  modo?: string;
  request_id?: string;
  numero_car: string | null;
  situacao: string | null;
  condicao: string | null;
  municipio: string | null;
  uf: string | null;
  area_ha: number | null;
  area_fonte?: string | null;
  area_declarada_ha?: number | null;
  area_agricultavel_ha?: number | null;
  modulos_fiscais: number | null;
  data_registro: string | null;
  bioma?: string | null;
  app?: MetricaAmbiental | null;
  reserva_legal?: MetricaAmbiental | null;
  vegetacao_nativa?: MetricaAmbiental | null;
  reserva_legal_ha: number | null;
  reserva_legal_percentual: number | null;
  reserva_legal_deficit_ha: number | null;
  app_ha: number | null;
  vegetacao_nativa_ha: number | null;
  embargos: unknown[];
  restricoes: unknown[];
  sobreposicoes_lista?: SobreposicaoItem[] | null;
  avisos_qualidade?: string[] | null;
  mapbiomas?: { status: string | null; count: number | null; snapshot: string | null } | null;
  sobreposicao_fonte?: SobreposicaoFonte | null;
}

export type Selo = "conforme" | "atencao" | "nao_conforme" | "impeditivo" | "sem_dado";

export const ORDEM_SELO: Record<Selo, number> = { conforme: 0, sem_dado: 1, atencao: 2, nao_conforme: 3, impeditivo: 4 };
export const ROTULO_SELO: Record<Selo, string> = {
  conforme: "Conforme",
  atencao: "Atenção",
  nao_conforme: "Não conforme",
  impeditivo: "Impeditivo",
  sem_dado: "Sem dado da fonte",
};
export const AVISO_IMPEDITIVO = "Imóvel não apto à aprovação de projeto: há impedimento declarado pela fonte oficial.";
export const ehImpeditivo = (selo: Selo): boolean => selo === "impeditivo";

export interface LinhaBloco {
  rotulo: string;
  valor: string;
  presente: boolean;
}
export interface BlocoConformidade {
  id: string;
  titulo: string;
  selo: Selo;
  resumo: string;
  linhas: LinhaBloco[];
}

const ha = (v: number | null) => (v === null ? "sem dado da fonte" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`);
const pct = (v: number | null) => (v === null ? "sem dado da fonte" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const txt = (v: string | null) => v ?? "sem dado da fonte";
const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
/** Compara situações sem depender de acento nem de caixa. */
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SITUACOES_IMPEDITIVAS = ["cancelad", "suspens", "invalidad", "duplicidade"];
const SITUACOES_RUIM = ["inativo", "aguardando atendimento", "notificacao", "pendencia", "aguardando regularizacao", "regularizacao ambiental"];
const SITUACOES_ANALISE = ["aguardando analise", "em analise"];
const SITUACOES_OK = ["em conformidade", "ativo", "ativa", "validad", "aprovad", "analisado sem pendencia"];

export function avaliarCadastro(c: CarNormalizado): BlocoConformidade {
  const situacao = norm(c.situacao ?? "");
  let selo: Selo = "sem_dado";
  let resumo = "A fonte não informou a situação do cadastro.";
  if (situacao) {
    if (SITUACOES_IMPEDITIVAS.some((s) => situacao.includes(s))) {
      selo = "impeditivo";
      resumo = `Cadastro em situação "${c.situacao}" — impedimento para aprovação de projeto.`;
    } else if (SITUACOES_RUIM.some((s) => situacao.includes(s))) {
      selo = "nao_conforme";
      resumo = `Cadastro em situação "${c.situacao}".`;
    } else if (SITUACOES_ANALISE.some((s) => situacao.includes(s))) {
      selo = "atencao";
      resumo = `Situação "${c.situacao}" exige verificação manual.`;
    } else if (SITUACOES_OK.some((s) => situacao.includes(s))) {
      selo = "conforme";
      resumo = `Cadastro em situação "${c.situacao}".`;
    } else {
      selo = "atencao";
      resumo = `Situação "${c.situacao}" exige verificação manual.`;
    }
  }
  return {
    id: "cadastro",
    titulo: "Cadastro",
    selo,
    resumo,
    linhas: [
      { rotulo: "Número do CAR", valor: txt(c.numero_car), presente: !!c.numero_car },
      { rotulo: "Situação", valor: txt(c.situacao), presente: !!c.situacao },
      { rotulo: "Condição", valor: txt(c.condicao), presente: !!c.condicao },
      { rotulo: "Município / UF", valor: c.municipio || c.uf ? `${txt(c.municipio)} / ${txt(c.uf)}` : "sem dado da fonte", presente: !!(c.municipio || c.uf) },
      { rotulo: "Área do imóvel (canônica)", valor: c.area_ha === null ? "sem dado da fonte" : `${ha(c.area_ha)}${c.area_fonte ? ` · fonte ${c.area_fonte}` : ""}`, presente: c.area_ha !== null },
      { rotulo: "Área declarada no cadastro", valor: ha(c.area_declarada_ha ?? null), presente: (c.area_declarada_ha ?? null) !== null },
      { rotulo: "Área agricultável", valor: ha(c.area_agricultavel_ha ?? null), presente: (c.area_agricultavel_ha ?? null) !== null },
      { rotulo: "Módulos fiscais", valor: c.modulos_fiscais === null ? "sem dado da fonte" : String(c.modulos_fiscais), presente: c.modulos_fiscais !== null },
      { rotulo: "Bioma", valor: txt(c.bioma ?? null), presente: !!c.bioma },
      { rotulo: "Data de registro", valor: c.data_registro ? formatarDataFonte(c.data_registro) : txt(null), presente: !!c.data_registro },
    ],
  };
}

const STATUS_SEM_DADO: StatusDado[] = ["NOT_FOUND", "NOT_LOADED", "UNKNOWN"];

/** Formata métrica ambiental respeitando o status: null nunca é apresentado como zero. */
export const valorMetrica = (m?: MetricaAmbiental | null): string => {
  if (!m) return SEM_DADO_FONTE;
  if (m.status === "EXPLICIT_ZERO") return "0 ha (informado como zero pela fonte)";
  if (m.ha === null) return SEM_DADO_FONTE;
  return ha(m.ha);
};

export function avaliarAmbiental(c: CarNormalizado): BlocoConformidade {
  const app = c.app ?? null;
  const rl = c.reserva_legal ?? null;
  const veg = c.vegetacao_nativa ?? null;
  const deficit = rl?.deficit_ha ?? c.reserva_legal_deficit_ha;
  const semDadoAmbiental = (!app || STATUS_SEM_DADO.includes(app.status)) && (!rl || STATUS_SEM_DADO.includes(rl.status));
  let selo: Selo = "sem_dado";
  let resumo = SEM_DADO_FONTE;
  if (deficit !== null && deficit !== undefined) {
    if (deficit > 0) {
      selo = "nao_conforme";
      resumo = `Déficit de reserva legal de ${ha(deficit)}.`;
    } else {
      selo = "conforme";
      resumo = "Sem déficit de reserva legal declarado.";
    }
  } else if (!semDadoAmbiental) {
    selo = "atencao";
    resumo = "Reserva legal informada, porém sem cálculo de déficit — conferir manualmente.";
  }
  const status = (m?: MetricaAmbiental | null) => (!m ? "sem retorno da fonte" : m.status);
  return {
    id: "ambiental",
    titulo: "Reserva legal e APP",
    selo,
    resumo,
    linhas: [
      { rotulo: "Reserva legal", valor: valorMetrica(rl), presente: (rl?.ha ?? null) !== null },
      { rotulo: "Situação do dado (RL)", valor: status(rl), presente: !!rl },
      { rotulo: "Reserva legal (%)", valor: pct(rl?.percentual ?? c.reserva_legal_percentual), presente: (rl?.percentual ?? c.reserva_legal_percentual) !== null },
      { rotulo: "Déficit de reserva legal", valor: ha(deficit ?? null), presente: (deficit ?? null) !== null },
      { rotulo: "APP", valor: valorMetrica(app), presente: (app?.ha ?? null) !== null },
      { rotulo: "Situação do dado (APP)", valor: status(app), presente: !!app },
      { rotulo: "Vegetação nativa", valor: valorMetrica(veg), presente: (veg?.ha ?? null) !== null },
    ],
  };
}

const ROTULO_AVISO: Record<string, string> = {
  CAR_STORED_AREA_INCONSISTENT: "Área declarada no cadastro divergente da área canônica (qualidade do dado).",
  APP_DATA_NOT_AVAILABLE: "A base consultada não carregou os dados de APP.",
  LEGAL_RESERVE_DATA_NOT_AVAILABLE: "A base consultada não carregou os dados de reserva legal.",
};

/** Bloco informativo: avisos de qualidade e MapBiomas nunca viram crítico/inelegível. */
export function avaliarQualidade(c: CarNormalizado): BlocoConformidade {
  const avisos = c.avisos_qualidade ?? [];
  const mb = c.mapbiomas ?? null;
  const linhas: LinhaBloco[] = avisos.length
    ? avisos.map((a) => ({ rotulo: a, valor: ROTULO_AVISO[a] ?? "Aviso técnico da fonte.", presente: true }))
    : [{ rotulo: "Avisos da fonte", valor: "nenhum aviso retornado", presente: true }];
  const rotuloMb = !mb || !mb.status
    ? SEM_DADO_FONTE
    : mb.status === "empty"
      ? `Nenhum alerta no snapshot consultado (${mb.count ?? 0}).`
      : `Status da fonte: ${mb.status}${mb.count !== null ? ` · ${mb.count} alerta(s)` : ""}`;
  linhas.push({ rotulo: "Alertas MapBiomas", valor: rotuloMb, presente: !!mb?.status });
  if (mb?.snapshot) linhas.push({ rotulo: "Snapshot MapBiomas", valor: mb.snapshot, presente: true });
  return {
    id: "qualidade",
    titulo: "Qualidade do dado e alertas",
    selo: avisos.length ? "atencao" : "conforme",
    resumo: avisos.length ? `${avisos.length} aviso(s) técnico(s) da fonte — não são apontamentos de conformidade.` : "A fonte não sinalizou problemas de qualidade.",
    linhas,
  };
}

/** Sobreposições que impedem projeto por si: TI, UC, quilombola, embargo ativo. */
const PADROES_IMPEDITIVOS = /TERRA_?INDIGENA|TERRA INDIGENA|INDIGENA|UNIDADE_?DE_?CONSERVACAO|UNIDADE DE CONSERVACAO|QUILOMBOLA|EMBARGO/;

export function avaliarEmbargos(c: CarNormalizado): BlocoConformidade {
  const total = (c.embargos?.length ?? 0) + (c.restricoes?.length ?? 0);
  const fonteSilenciou = c.embargos === undefined || c.restricoes === undefined;
  let impeditivo = false;
  const linhas: LinhaBloco[] = [];
  for (const item of [...(c.embargos ?? []), ...(c.restricoes ?? [])]) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const rotulo = String(o.tipo ?? o.orgao ?? o.descricao ?? "Restrição");
      const valor = String(o.descricao ?? o.situacao ?? o.detalhe ?? JSON.stringify(o)).slice(0, 220);
      if (PADROES_IMPEDITIVOS.test(semAcento(`${rotulo} ${valor}`))) impeditivo = true;
      linhas.push({ rotulo, valor, presente: true });
    } else {
      linhas.push({ rotulo: "Restrição", valor: String(item), presente: true });
    }
  }
  return {
    id: "embargos",
    titulo: "Embargos e restrições",
    selo: fonteSilenciou ? "sem_dado" : impeditivo ? "impeditivo" : total > 0 ? "nao_conforme" : "conforme",
    resumo: fonteSilenciou
      ? "A fonte não retornou o campo de embargos."
      : impeditivo
        ? `${total} apontamento(s), com embargo ativo ou sobreposição com terra indígena / unidade de conservação / território quilombola.`
        : total > 0
          ? `${total} apontamento(s) de embargo/restrição.`
          : "Nenhum embargo ou restrição retornado pela fonte.",
    linhas: linhas.length ? linhas : [{ rotulo: "Apontamentos", valor: "nenhum retornado pela fonte", presente: !fonteSilenciou }],
  };
}

export interface Sobreposicao {
  areaCarHa: number | null;
  areaCadastradaHa: number | null;
  divergenciaHa: number | null;
  divergenciaPct: number | null;
}

/** Compara a área do CAR com a área cadastrada (ex.: soma de talhões ou da matrícula). */
export function calcularSobreposicao(areaCarHa: number | null, areaCadastradaHa: number | null): Sobreposicao {
  if (areaCarHa === null || areaCadastradaHa === null || areaCarHa <= 0) {
    return { areaCarHa, areaCadastradaHa, divergenciaHa: null, divergenciaPct: null };
  }
  const divergenciaHa = areaCadastradaHa - areaCarHa;
  return { areaCarHa, areaCadastradaHa, divergenciaHa, divergenciaPct: (divergenciaHa / areaCarHa) * 100 };
}

export function avaliarSobreposicao(s: Sobreposicao, fonte?: SobreposicaoFonte | null): BlocoConformidade {
  let selo: Selo = "sem_dado";
  let resumo = "Informe a área do projeto ou da matrícula para comparar com a do CAR.";
  // Prioridade: sobreposição calculada pela fonte (geometria x geometria). O total inclui as classes internas
  // do próprio imóvel, então só restrição e sobreposição com terceiros pesam no veredito.
  if (fonte && fonte.tem_sobreposicao !== null) {
    const restricao = fonte.restricao_pct ?? 0;
    const terceiros = (fonte.car_pct ?? 0) + (fonte.outros_pct ?? 0);
    const total = fonte.total_pct ?? 0;
    if (restricao > 0) {
      selo = "nao_conforme";
      resumo = `Sobreposição com área de restrição (${restricao.toFixed(2)}%).`;
    } else if (terceiros > 5) {
      selo = "nao_conforme";
      resumo = `Sobreposição de ${terceiros.toFixed(2)}% com cadastros de terceiros.`;
    } else if (terceiros > 0) {
      selo = "atencao";
      resumo = `Sobreposição de ${terceiros.toFixed(2)}% com cadastros de terceiros — conferir limites.`;
    } else if (!fonte.tem_sobreposicao) {
      selo = "conforme";
      resumo = "A fonte não identificou sobreposição de geometria.";
    } else {
      selo = "conforme";
      resumo = `Sem restrição nem sobreposição com terceiros. O total de ${total.toFixed(2)}% refere-se às classes internas do próprio imóvel.`;
    }
  } else if (s.divergenciaPct !== null) {
    const abs = Math.abs(s.divergenciaPct);
    selo = abs <= 5 ? "conforme" : abs <= 15 ? "atencao" : "nao_conforme";
    resumo = abs <= 5 ? `Áreas compatíveis (divergência de ${abs.toFixed(1)}%).` : `Divergência de ${abs.toFixed(1)}% entre a área do CAR e a área informada.`;
  }
  const linhasFonte: LinhaBloco[] = fonte
    ? [
        { rotulo: "Sobreposição total (informativo — inclui classes internas do imóvel)", valor: fonte.total_ha === null ? "sem dado da fonte" : `${ha(fonte.total_ha)} (${pct(fonte.total_pct)})`, presente: fonte.total_ha !== null },
        { rotulo: "Sobreposição com restrições", valor: fonte.restricao_ha === null ? "sem dado da fonte" : `${ha(fonte.restricao_ha)} (${pct(fonte.restricao_pct)})`, presente: fonte.restricao_ha !== null },
        { rotulo: "Sobreposição com outros CAR", valor: fonte.car_ha === null ? "sem dado da fonte" : `${ha(fonte.car_ha)} (${pct(fonte.car_pct)})`, presente: fonte.car_ha !== null },
        { rotulo: "Verificado em", valor: fonte.verificado_em ? formatarDataFonte(fonte.verificado_em) : "sem dado da fonte", presente: !!fonte.verificado_em },
        { rotulo: "Soma das feições (não é cobertura distinta)", valor: (fonte.feature_sum_ha ?? null) === null ? "sem dado da fonte" : `${ha(fonte.feature_sum_ha ?? null)} · ${fonte.coverage_semantics ?? "soma não distinta"}`, presente: (fonte.feature_sum_ha ?? null) !== null },
      ]
    : [];
  return {
    id: "sobreposicao",
    titulo: "Sobreposição e área",
    selo,
    resumo,
    linhas: [
      { rotulo: "Área do CAR", valor: ha(s.areaCarHa), presente: s.areaCarHa !== null },
      { rotulo: "Área informada", valor: ha(s.areaCadastradaHa), presente: s.areaCadastradaHa !== null },
      { rotulo: "Divergência", valor: ha(s.divergenciaHa), presente: s.divergenciaHa !== null },
      { rotulo: "Divergência (%)", valor: pct(s.divergenciaPct), presente: s.divergenciaPct !== null },
      ...linhasFonte,
    ],
  };
}

/** Blocos informativos (qualidade) não influenciam o veredito. */
const BLOCOS_INFORMATIVOS = ["qualidade"];

export function vereditoGeral(blocos: BlocoConformidade[]): Selo {
  return blocos
    .filter((b) => !BLOCOS_INFORMATIVOS.includes(b.id))
    .reduce<Selo>((pior, b) => (ORDEM_SELO[b.selo] > ORDEM_SELO[pior] ? b.selo : pior), "conforme");
}

/** Bloco que determinou o veredito — justifica o selo ao usuário. */
export function blocoDeterminante(blocos: BlocoConformidade[]): BlocoConformidade | null {
  const avaliaveis = blocos.filter((b) => !BLOCOS_INFORMATIVOS.includes(b.id));
  if (!avaliaveis.length) return null;
  const geral = vereditoGeral(blocos);
  return avaliaveis.find((b) => b.selo === geral) ?? null;
}

export function montarBlocos(c: CarNormalizado, sobreposicao: Sobreposicao): BlocoConformidade[] {
  return [avaliarCadastro(c), avaliarAmbiental(c), avaliarSobreposicao(sobreposicao, c.sobreposicao_fonte ?? null), avaliarEmbargos(c), avaliarQualidade(c)];
}

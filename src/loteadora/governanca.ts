import { PAPEIS, type Papel } from "./alcadas";

/**
 * Onda 2 — governança: matriz RACI dos 10 macroprocessos (documento, 2.3) e perfis genéricos,
 * um por papel, para operar antes do cadastro nominal das pessoas da Sol Maior.
 */

export type Raci = "A" | "R" | "C" | "I";
export const RACI_LABEL: Record<Raci, string> = { A: "Aprovador final", R: "Responsável pela execução", C: "Validador técnico / consultado", I: "Informado" };

/** Ordem das colunas: presidente, diretoria técnica, consultor, ambiental, CFO, projetista, canteiro, comercial. */
const COLS: readonly Papel[] = ["presidente", "diretoria_tecnica", "consultor", "ambiental", "cfo", "projetista", "canteiro", "comercial"];

const linha = (codigo: string, nome: string, letras: string, nota?: string) => ({
  codigo,
  nome,
  papeis: Object.fromEntries(COLS.map((p, i) => [p, letras[i] as Raci])) as Record<Papel, Raci>,
  ...(nota ? { nota } : {}),
});

export const MACROPROCESSOS = [
  linha("viabilidade", "Prospecção de gleba e viabilidade (EVEF)", "ACRCRCIC"),
  linha("projetos", "Projetos urbanísticos e compatibilização", "ICCCIRCI"),
  linha("licenciamento", "Licenciamento GRAPROHAB / CETESB / SP Águas", "ACCRIRII"),
  linha("cartorio", "Registro imobiliário em cartório (180 dias)", "AICRCCII"),
  linha("fornecedores", "Homologação e contratação de fornecedores", "ARRCCCCI"),
  linha("execucao", "Execução física e fiscalização de canteiro", "ICCCICRI"),
  linha("medicoes", "Medições de obra e pagamento de empreiteiros", "ACCCRIRI", "Medições dentro do contrato seguem canteiro → engenharia → CFO; aditivos ou desvios exigem a Presidência."),
  linha("reforecast", "Controle físico-financeiro (reforecast)", "ACRCRICI"),
  linha("comercial", "Comercialização de lotes e controle de VGV", "AICICIIR"),
  linha("entrega", "Vistorias finais, as-built e entrega (TVO)", "ACCRIRRI"),
] as const;

export type Macroprocesso = (typeof MACROPROCESSOS)[number]["codigo"];

/** O que cada papel é em cada macroprocesso. */
export const raciDe = (papel: Papel) => MACROPROCESSOS.map((m) => ({ codigo: m.codigo, nome: m.nome, raci: m.papeis[papel] }));

/** Quem é Aprovador / Responsável / Consultado / Informado num macroprocesso. */
export function papeisNoMacro(codigo: Macroprocesso, letra: Raci): Papel[] {
  const m = MACROPROCESSOS.find((x) => x.codigo === codigo)!;
  return PAPEIS.filter((p) => m.papeis[p] === letra);
}

/** Perfil de acesso do app (RBAC) que cada papel usa. */
export type PerfilApp = "director" | "manager" | "analyst" | "environmental" | "technician";

export interface PerfilGenerico {
  papel: Papel;
  nome: string;
  email: string;
  perfilApp: PerfilApp;
  /** Cargo como no documento operacional. */
  cargo: string;
  atribuicoes: string;
}

/** Um perfil genérico por papel (substituídos pelas pessoas reais quando a lista chegar). */
export const PERFIS_GENERICOS: readonly PerfilGenerico[] = [
  { papel: "presidente", nome: "Presidência (perfil genérico)", email: "presidencia@perfil.solmaior", perfilApp: "director", cargo: "Presidente", atribuicoes: "Aprovação final de contratações, aditivos, exceções de tabela e reforecast; visão executiva 360º." },
  { papel: "diretoria_tecnica", nome: "Diretoria técnica (perfil genérico)", email: "engenharia@perfil.solmaior", perfilApp: "manager", cargo: "Engenheiro sênior / diretoria técnica", atribuicoes: "Pré-aprovação técnica, homologação de fornecedores, conferência de medições e validação de RNC." },
  { papel: "consultor", nome: "Consultoria técnica (perfil genérico)", email: "consultoria@perfil.solmaior", perfilApp: "manager", cargo: "Consultor técnico e de orçamento", atribuicoes: "Viabilidade (EVEF), orçamento base, reforecast, cotações e pré-aprovação técnica." },
  { papel: "ambiental", nome: "Ambiental e regulatório (perfil genérico)", email: "ambiental@perfil.solmaior", perfilApp: "environmental", cargo: "Gestor ambiental e regulatório", atribuicoes: "GRAPROHAB, CETESB, SP Águas, RET, cartório (180 dias), plantio compensatório e TVO." },
  { papel: "cfo", nome: "Financeiro (perfil genérico)", email: "financeiro@perfil.solmaior", perfilApp: "manager", cargo: "Diretor financeiro (CFO)", atribuicoes: "Caixa, desembolsos, retenção técnica, conferência fiscal/SST, liberação de pagamentos, crédito e carteira." },
  { papel: "projetista", nome: "Projetos (perfil genérico)", email: "projetos@perfil.solmaior", perfilApp: "analyst", cargo: "Engenheiro projetista", atribuicoes: "Projetos e compatibilização, revisão única das pranchas, respostas a RET e as-built." },
  { papel: "canteiro", nome: "Canteiro (perfil genérico)", email: "canteiro@perfil.solmaior", perfilApp: "analyst", cargo: "Gestor de obras / canteiro", atribuicoes: "Diário de obra, gates por trecho, fiscalização, RNC e boletins de medição." },
  { papel: "comercial", nome: "Comercial (perfil genérico)", email: "comercial@perfil.solmaior", perfilApp: "analyst", cargo: "Frente comercial / corretores", atribuicoes: "Tabela de vendas, espelho de lotes, reservas, propostas e metas de vendas." },
];

export const isPerfilGenerico = (email?: string) => !!email && email.endsWith("@perfil.solmaior");

/** Abas da Loteadora 360º que cada papel vê (quem não tem papel, como a diretoria do app, vê todas). */
export const ABAS_DO_PAPEL: Record<Papel, readonly string[]> = {
  presidente: ["painel", "cadastro", "regulatorio", "alcadas", "custos", "canteiro", "qualidade", "medicoes", "suprimentos", "comercial", "trilha"],
  diretoria_tecnica: ["painel", "cadastro", "regulatorio", "alcadas", "custos", "canteiro", "qualidade", "medicoes", "suprimentos", "comercial", "trilha"],
  consultor: ["painel", "cadastro", "alcadas", "custos", "medicoes", "suprimentos", "comercial", "trilha"],
  ambiental: ["painel", "cadastro", "regulatorio", "alcadas", "canteiro", "qualidade", "trilha"],
  cfo: ["painel", "alcadas", "custos", "medicoes", "suprimentos", "comercial", "trilha"],
  projetista: ["painel", "cadastro", "regulatorio", "canteiro", "suprimentos"],
  canteiro: ["painel", "cadastro", "canteiro", "qualidade", "medicoes"],
  comercial: ["painel", "cadastro", "comercial"],
};

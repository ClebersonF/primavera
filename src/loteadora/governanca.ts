import { PAPEIS, type Papel } from "./alcadas";

/**
 * Onda 2 — governança: matriz RACI dos 10 macroprocessos (documento, 2.3) e perfis genéricos,
 * um por papel, para operar antes do cadastro nominal das pessoas da Sol Maior.
 */

export type Raci = "A" | "R" | "RC" | "C" | "I";
export const RACI_LABEL: Record<Raci, string> = {
  A: "Aprovador final",
  R: "Responsável pela execução",
  RC: "Co-execução e validação técnica/jurídica",
  C: "Consultado",
  I: "Informado",
};
export const RACI_SIGLA: Record<Raci, string> = { A: "A", R: "R", RC: "R/C", C: "C", I: "I" };

/** Ordem das colunas da RACI v1.1: José, Evaristo, Luciano, Mario Sergio, Fernando, Dra. Juliana, Elvis, Hércules, Comercial. */
const COLS: readonly Papel[] = ["presidente", "diretoria_tecnica", "consultor", "ambiental", "cfo", "juridico", "projetista", "canteiro", "comercial"];

const linha = (codigo: string, nome: string, letras: string, nota?: string) => {
  const tk = letras.trim().split(/\s+/).map((t) => (t === "R/C" ? "RC" : t)) as Raci[];
  if (tk.length !== COLS.length) throw new Error(`RACI ${codigo}: ${tk.length} colunas`);
  return { codigo, nome, papeis: Object.fromEntries(COLS.map((p, i) => [p, tk[i]!])) as Record<Papel, Raci>, ...(nota ? { nota } : {}) };
};

/** Matriz RACI do documento operacional v1.1 (2.3), validada com os stakeholders da Sol Maior. */
export const MACROPROCESSOS = [
  linha("viabilidade", "Prospecção, Plano Diretor e viabilidade", "A C R/C R/C R/C C C I C"),
  linha("projetos", "Projetos urbanísticos e compatibilização", "I C C C I I R C I"),
  linha("licenciamento", "Licenciamento GRAPROHAB / CETESB / DAEE", "A R/C R/C R I C R I I"),
  linha("cartorio", "Registro imobiliário (180 dias) e caução municipal", "A R/C R/C R C R/C C I I"),
  linha("fornecedores", "Contratações e garantias de terceiros", "A R/C R/C C C C C C I"),
  linha("execucao", "Execução física e sequenciamento (gates 1–8)", "I R/C C C I I R/C R I"),
  linha("medicoes", "Medições de obra, pagamentos e RNCs", "A R/C C C R I R/C R I", "Aditivos ou desvios exigem parecer da engenharia sênior e do conselho e aprovação da Presidência."),
  linha("reforecast", "Controle físico-financeiro (reforecast)", "A C R/C C R I I C I"),
  linha("comercial", "Comercialização, contratos e controle de VGV", "A I C I R/C R/C I I R"),
  linha("entrega", "Vistorias, as-built, TVO e descaucionamento", "A R/C R/C R C C R R I"),
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
  { papel: "diretoria_tecnica", nome: "Engenharia sênior (diretoria) (perfil genérico)", email: "engenharia@perfil.solmaior", perfilApp: "manager", cargo: "Engenheiro sênior / diretoria técnica", atribuicoes: "Orçamentos técnicos, aprovação de projetos, licenciamento e registro, garantias de terceiros e caução municipal, validação de medições, aditivos e RNCs." },
  { papel: "consultor", nome: "Engenharia / conselho (orçamento e viabilidade) (perfil genérico)", email: "consultoria@perfil.solmaior", perfilApp: "manager", cargo: "Engenheiro / conselho", atribuicoes: "Orçamentos técnicos, projetos, análise do Plano Diretor, licenciamento e cartório, garantias e caução municipal, governança e viabilidade." },
  { papel: "ambiental", nome: "Gestão executiva, ambiental e regulatória (perfil genérico)", email: "ambiental@perfil.solmaior", perfilApp: "environmental", cargo: "Gestor ambiental e regulatório", atribuicoes: "GRAPROHAB, CETESB, DAEE/SP Águas, Prefeituras e cartórios, Planilha Própria e Matriz de Risco, APP, fauna/flora, compensação florestal e RET." },
  { papel: "cfo", nome: "Diretoria financeira (CFO) (perfil genérico)", email: "financeiro@perfil.solmaior", perfilApp: "manager", cargo: "Diretor financeiro (CFO)", atribuicoes: "Caixa, desembolsos, retenção técnica, conferência fiscal/SST, liberação de pagamentos, crédito e carteira." },
  { papel: "juridico", nome: "Jurídico (perfil genérico)", email: "juridico@perfil.solmaior", perfilApp: "analyst", cargo: "Jurídico", atribuicoes: "Matrículas, notas devolutivas e R-01, termos de caução, minutas de empreiteiros, tabela de vendas, análise documental de compradores, compromissos de compra e venda e termos de entrega." },
  { papel: "projetista", nome: "Engenharia de projetos (perfil genérico)", email: "projetos@perfil.solmaior", perfilApp: "analyst", cargo: "Engenheiro projetista", atribuicoes: "Projetos e compatibilização, revisão única das pranchas, respostas a RET e as-built." },
  { papel: "canteiro", nome: "Gestão de obras / canteiro (perfil genérico)", email: "canteiro@perfil.solmaior", perfilApp: "analyst", cargo: "Gestor de obras / canteiro", atribuicoes: "Diário de obra com os 5 vetores (chuvas, intempéries, materiais, equipamentos e pessoal), gates por trecho, demarcação de lotes, medições e RNC." },
  { papel: "comercial", nome: "Comercial / corretores (perfil genérico)", email: "comercial@perfil.solmaior", perfilApp: "analyst", cargo: "Frente comercial / corretores", atribuicoes: "Tabela de vendas, espelho de lotes, reservas, propostas e metas de vendas." },
];

export const isPerfilGenerico = (email?: string) => !!email && email.endsWith("@perfil.solmaior");

/** Abas da Loteadora 360º que cada papel vê (quem não tem papel, como a diretoria do app, vê todas). */
export const ABAS_DO_PAPEL: Record<Papel, readonly string[]> = {
  presidente: ["painel", "cadastro", "regulatorio", "alcadas", "custos", "canteiro", "qualidade", "medicoes", "suprimentos", "comercial", "trilha"],
  diretoria_tecnica: ["painel", "cadastro", "regulatorio", "alcadas", "custos", "canteiro", "qualidade", "medicoes", "suprimentos", "comercial", "trilha"],
  consultor: ["painel", "cadastro", "regulatorio", "alcadas", "custos", "canteiro", "medicoes", "suprimentos", "comercial", "trilha"],
  ambiental: ["painel", "cadastro", "regulatorio", "alcadas", "canteiro", "qualidade", "trilha"],
  cfo: ["painel", "regulatorio", "alcadas", "custos", "medicoes", "suprimentos", "comercial", "trilha"],
  juridico: ["painel", "cadastro", "regulatorio", "alcadas", "suprimentos", "comercial", "trilha"],
  projetista: ["painel", "cadastro", "regulatorio", "canteiro", "qualidade", "medicoes", "suprimentos"],
  canteiro: ["painel", "cadastro", "canteiro", "qualidade", "medicoes", "suprimentos"],
  comercial: ["painel", "cadastro", "comercial"],
};

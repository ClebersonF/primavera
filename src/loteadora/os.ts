import { PmoError } from "../errors";
import { isIsoDate } from "./common";
import { exigeOS, FRENTE_OBRA_LABEL, gravarOS, type FrenteObra, type FrenteTrecho } from "./campo";
import { homologacao, type Fornecedor } from "./suprimentos";

/**
 * Emissão da OS (documento, F4.05): só com fornecedor homologado para a frente, contrato assinado,
 * ART de execução e integração de segurança em canteiro registradas.
 */
export function travasOS(fornecedor: Fornecedor | undefined, frente: FrenteObra, dados: { contratoNumero: string; contratoAssinadoEm: string; artNumero: string }, hoje: string): string[] {
  const t: string[] = [];
  if (!exigeOS(frente)) t.push("Esta frente não usa OS de terceiro");
  if (!fornecedor) return [...t, "Escolha o fornecedor"];
  const h = homologacao(fornecedor, hoje);
  if (!h.apto) t.push(`Fornecedor não homologado: ${h.pendencias.join("; ")}`);
  if (!fornecedor.frentes.includes(frente)) t.push(`${fornecedor.nome} não executa ${FRENTE_OBRA_LABEL[frente].slice(4)}`);
  if (!fornecedor.sstIntegracaoEm) t.push("Integração de segurança (SST) em canteiro não registrada");
  if (!dados.contratoNumero.trim()) t.push("Informe o número do contrato");
  if (!isIsoDate(dados.contratoAssinadoEm) || dados.contratoAssinadoEm > hoje) t.push("Contrato sem data de assinatura válida (até hoje)");
  if (!dados.artNumero.trim()) t.push("Informe a ART de execução");
  return t;
}

export function emitirOS(lista: readonly FrenteTrecho[], trechoId: string, frente: FrenteObra, fornecedor: Fornecedor | undefined, dados: { contratoNumero: string; contratoAssinadoEm: string; artNumero: string }, por: string, hoje: string): FrenteTrecho[] {
  const t = travasOS(fornecedor, frente, dados, hoje);
  if (t.length) throw new PmoError(t.join(". ") + ".");
  return gravarOS(lista, trechoId, frente, {
    fornecedorId: fornecedor!.id,
    contratoNumero: dados.contratoNumero.trim().slice(0, 60),
    contratoAssinadoEm: dados.contratoAssinadoEm,
    artNumero: dados.artNumero.trim().slice(0, 60),
    emitidaEm: hoje,
    por: por.trim().slice(0, 100) || "—",
  });
}

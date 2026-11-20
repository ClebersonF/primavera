# Enquadramento tributário — comparação de regimes

Tela **Enquadramento tributário** (Gestão de Projetos): consulta o CNPJ e compara Simples Nacional, Lucro Presumido e
Lucro Real para empresa de serviços, em três cenários: 2026 (regras atuais), 2027 (CBS no lugar de PIS/COFINS) e 2033
(regime pleno, estimativa). É simulação para levar à contabilidade, não parecer.

Código: `src/tax/regimes.ts` (`compareRegimes`, `simplesWindow`, `fatorRGap`, `realBreakEvenMargin`) e `src/tax/cnpj.ts`;
testes em `tests/regimes.test.ts`, com valores conferidos à mão.

## Parâmetros e de onde vieram (conferidos em 20/11/2026)

| Parâmetro | Valor | Fonte e ressalva |
|---|---|---|
| Simples, Anexos III e V | 6 faixas até R$ 4,8 milhões; sublimite de ISS em R$ 3,6 milhões | LC 123/2006; tabela conferida em publicação de contabilidade (Agilize, 2026), não no texto da lei |
| Fator R | folha + pró-labore ÷ receita ≥ 28% → Anexo III | Idem. Software e TI: Anexo V, ou III com Fator R; confirme o anexo de cada CNAE |
| Opção pelo Simples para 2027 | 1º a 30/09/2026; CNPJ aberto de 01/10 a 31/12/2026 opta na abertura; desistência até 30/11/2026 | Receita Federal e Ministério da Fazenda. O caso "aberta antes de outubro e não optou" não é tratado expressamente: que só entra em 2028 é inferência |
| Lucro Presumido | Presunção de 32% (serviços); IRPJ 15% + 10% acima de R$ 240 mil/ano; CSLL 9% | Legislação do IRPJ/CSLL |
| LC 224/2025 | Presunção 10% maior sobre a receita anual acima de R$ 5 milhões (IRPJ desde 01/01/2026; CSLL desde 01/04/2026) | A simulação aplica o ano inteiro |
| PIS/COFINS em 2026 | 3,65% cumulativo (Presumido); 9,25% menos créditos (Real) | |
| CBS em 2027 | 11,2% cobrada (referência de 11,3% calculada pelo TCU em 28/10/2026, menos 0,1 p.p.) | **Não fixada**: depende de resolução do Senado. Editável na tela |
| IBS em 2027 e 2028 | 0,1% (teste) | |
| 2033 | CBS 9,21% + IBS 18,7% | Estimativa **não oficial** atribuída ao Comitê Gestor do IBS |
| INSS patronal fora do Simples | 26,8% sobre a folha CLT (20% + RAT 1% + terceiros 5,8%); 20% sobre o pró-labore | RAT varia de 1% a 3% conforme a atividade |
| ISS | 2% a 5%, informado na tela | A alíquota de Ribeirão Preto para software não foi conferida |

## Simplificações

- Ano em regime constante: a receita dos últimos 12 meses é a receita anual informada.
- Só serviços. Sem ICMS, exportação, retenções na fonte, benefícios fiscais ou regimes específicos.
- FGTS, IRRF e INSS do empregado ficam de fora (iguais em todos os regimes).
- No Simples, o INSS patronal está no DAS; não há crédito de CBS/IBS das compras; a opção semestral pelo regime regular
  de IBS/CBS ("híbrido") não é simulada, nem o crédito que o cliente toma do IBS/CBS pago no DAS.
- "Carga com repasse" = total menos a CBS/IBS destacada sobre a parcela vendida a empresas que aproveitam o crédito.
  Supõe que o cliente aceita pagar o imposto que recupera, mantendo o mesmo preço líquido.
- A retenção de 10% sobre lucros distribuídos acima de R$ 50 mil por mês por sócio (desde 2026) não entra na conta.
- De 2029 a 2032 (ISS caindo 10% ao ano, IBS subindo) não há cenário próprio.

## Menu Tributos (consolidado)

Desde 20/11/2026 as telas de tributos ficam em um só menu, **Gestão de Projetos → Tributos** (`/pmo/tributos`), com abas:

| Aba | O que faz | Antes |
|---|---|---|
| Enquadramento | CNPJ e comparação Simples × Presumido × Real | `/pmo/enquadramento` (redireciona) |
| Análise por IA | Alavancas de economia calculadas pelo app e leitura por IA | nova |
| Calculadora oficial | Cálculo de CBS/IBS/IS e DANFSe pela calculadora da Receita | `/pmo/rtc` (redireciona) |
| Contrato e CBS | Rateio do contrato em notas e apuração mensal com créditos | `/pmo/tributos` |

As abas compartilham a empresa consultada e os números digitados (só no navegador: `pmo.tributos.v1`). A aba de
tributos dentro de cada obra continua no planejamento da obra, porque é ligada ao orçamento dela.

## Análise por IA

- **Alavancas** (`regimeLevers`, `src/tax/levers.ts`): a comparação refeita mudando uma premissa por vez — Fator R em 28%,
  margem de lucro ±10 pontos, só clientes pessoa física ou só empresas, Simples disponível, regime pleno de 2033. Cálculo
  determinístico, testado.
- **Leitura por IA** (`/api/tributos-ia`): mesmo gateway e chave da Kora (`LOVABLE_API_KEY`; modelo em
  `TRIBUTOS_IA_MODEL`, padrão `google/gemini-3-flash-preview`). A IA recebe só os números calculados, prazos e incertezas
  conhecidos, e devolve JSON com resumo, indicação, economias, riscos, perguntas para o contador e próximos passos.
- **Conferência** (`unverifiedAmounts`): todo valor em reais citado pela IA é comparado com os números do cálculo (e com
  somas e diferenças de dois deles). O que não bate aparece em destaque como "valores que não vêm do cálculo".
- A análise fica presa aos números que a geraram: se o usuário muda uma premissa, a tela avisa que está desatualizada.
- A rota não exige login, como a da Kora: qualquer pessoa com o endereço do app pode consumir créditos de IA.

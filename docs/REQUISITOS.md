# Requisitos e rastreabilidade — Gestão de Projetos (PMO) no Gestor de Galpões

Atualizado em 04/11/2026. Legenda: **OK** atendido e validado · **Parcial** atendido com limite descrito · **Aberto** não atendido (depende de decisão, backend ou dado).

## 1. Fontes

| Fonte | Observação |
|---|---|
| Prompt da squad (CTO/orquestrador) | Define o processo de trabalho, não funcionalidades |
| Estudo de Impacto Tributário — CBS (.docx) | Alíquotas e créditos são **estimativas** do próprio estudo |
| Manual do GRAPROHAB (conversa do Gemini) | Texto **gerado por IA**; o manual não define prazo por etapa |
| Segundo link do Gemini | Abriu **vazio**; nada foi aproveitado dele |
| Diretriz do usuário | "Espelhar o Oracle Primavera quanto a funcionalidades" (funções, não visual nem marca) |
| Diretriz do usuário | Trabalhar só na **cópia** do projeto, sem gastar créditos do Lovable (via GitHub) |

## 2. Estudo CBS

| # | Requisito do estudo | Status | Evidência |
|---|---|---|---|
| C1 | Apuração não cumulativa: débito sobre receitas menos crédito das compras | OK | `src/tax/cbs.ts` `assessCbs`; testes `tax.test.ts`; tela **Tributos (CBS)** |
| C2 | Duas alíquotas: engenharia 7,91% (11,3% com redução de 30%) e software 11,3% | OK | `effectiveRate`; tela mostra as duas |
| C3 | Créditos por categoria (nuvem, software, APIs, utilidades, aluguel, combustível, frota, equipamento de campo, laudos) | OK | `creditFor`; seletor de categorias na tela, com várias compras |
| C4 | Sem crédito: folha CLT, pró-labore, RPA, uso pessoal, fornecedor que não é PJ regular, despesa sem vínculo | OK | `creditFor` (motivo exibido por compra); testes |
| C5 | Alerta de fluxo de caixa (créditos baixos → saldo devedor alto → repasse no preço) | OK | Alerta na tela quando crédito < 30% do débito (limite escolhido por nós) |
| C6 | Segregação da NF-e em linhas distintas | OK | `splitInvoice`; tabela "Linha da nota" |
| C7 | Lastro contratual: aditivo com as fatias de serviço e software | OK | Texto-base do aditivo gerado na tela |
| C8 | Neutralidade B2B (CBS destacada vira crédito do comprador) | Parcial | Citada no alerta de caixa; sem cálculo do lado do cliente |
| C9 | Lucro Presumido: IRPJ/CSLL com presunção de 32% | Parcial | Nota informativa; sem cálculo de IRPJ/CSLL |
| C10 | Aplicação ao faturamento e aos custos reais da app (Odoo) | **Aberto** | A tela é calculadora; não lê notas fiscais nem compras reais |

## 3. GRAPROHAB / CETESB

| # | Requisito do manual | Status | Evidência |
|---|---|---|---|
| G1 | Fluxo do processo em etapas, com e sem Comunique-se | OK | `buildGraprohabProcess`; Gantt na tela; duração por etapa editável |
| G2 | Checklist de documentos | Parcial | `GRAPROHAB_DOCUMENTS`; tela marca os faltantes, **sem gravar** por empreendimento |
| G3 | Prazo do Comunique-se (180 dias corridos) | OK | `comuniqueSeDeadline`; tela |
| G4 | Faixas de APP (Lei 12.651, art. 4º, I), nascentes 50 m, faixa não edificável 15 m | OK | `appBufferMeters`; tela |
| G5 | Coerência do quadro de áreas entre planta, memorial e cartas | OK | `checkAreaTableConsistency`; seção "Quadro de áreas" |
| G6 | Prazos reais de cada etapa | **Aberto** | O manual não os define; os usados são estimativas editáveis |
| G7 | Acompanhar vários processos por empreendimento/imóvel | **Aberto** | Sem cadastro; precisa de modelo de dados e ligação com Imóveis |

## 4. Paridade funcional com o Oracle Primavera (P6 / Unifier)

| # | Função | Status | Onde / limite |
|---|---|---|---|
| P1 | EAP/WBS com rollup de prazo, custo e progresso | Parcial | Motor completo; a obra vira EAP de um nível (raiz + atividades). Não há edição de EAP na tela |
| P2 | CPM, vínculos FS/SS/FF/SF com lag, folga total e livre, caminho crítico | Parcial | Motor completo e testado; a tela só monta dependências **em sequência (FS)** porque a atividade não guarda predecessoras |
| P3 | Restrições de data | Parcial | Só "não iniciar antes de" (SNET) |
| P4 | Calendários e feriados | Parcial | Dias úteis seg–sex e feriados no motor; sem cadastro de feriados/calendários por atividade na tela |
| P5 | Gantt e caminho crítico | OK | `/obras/$id/cronograma` |
| P6 | Gantt com barras da baseline | **Aberto** | A comparação é em tabela |
| P7 | Linhas de base múltiplas e comparação | Parcial | Aba **Linha de base**; EVM usa a mais recente (sem escolher qual é a "primária") |
| P8 | Atualização de progresso | Parcial | Percentual vem do status (0/50/100%); sem % editável nem datas reais |
| P9 | Recursos e histograma | Parcial | `/pmo/recursos`: carga por responsável (1 pessoa por atividade). Sem tabela de preços, sem nivelamento |
| P10 | Planilha de custos (orçado, comprometido, realizado, previsão, variação) | OK | Aba **Custos** |
| P11 | Curva S / fluxo de caixa | OK | Tela de cronograma |
| P12 | Valor agregado (PV, EV, SPI, CPI, EAC, ETC, VAC, TCPI) | OK | `src/evm`; portfólio e aba Custos; PV/EV medidos contra a baseline mais recente |
| P13 | Portfólio e priorização | Parcial | `/pmo`: ranking multicritério com pesos fixos na tela; sem mapa de calor nem cenários |
| P14 | Pedidos de mudança com impacto e aprovação | Parcial | Aba **Mudanças**: fluxo e impacto; aprovação por papel (gerente/diretor); **não** usa a tela de Aprovações da app |
| P15 | Gestão de riscos | **Aberto** | Não implementado |
| P16 | Códigos de atividade, filtros e layouts, relatórios | **Aberto** | Não implementado |
| P17 | Persistência compartilhada, multiusuário, histórico e auditoria | Parcial | Baseline, custos e mudanças são gravados **com a obra no Odoo** (`x_obras`, campo de notas, mesmo mecanismo das demais informações da obra); outra pessoa enxerga na hora. Conflito simultâneo é **detectado** (quem grava primeiro é avisado), não evitado. **Sem histórico/auditoria** de quem mudou o quê; modelo dedicado no Odoo segue como evolução |
| P18 | Perfis de acesso | OK | Menu e rotas PMO só para analista, gerente e diretor (`src/lib/rbac.ts`) |

## 5. Processo (prompt da squad)

| Exigência | Status |
|---|---|
| Entender → investigar → planejar → implementar → testar → revisar | OK — fluxo seguido; revisor independente apontou 7 defeitos na Onda 3; os 7 foram tratados, com teste de regressão |
| Não esconder testes que falham; separar bug de ambiente | OK — registrado: o build não roda (vite.config.ts é script Deno); 54 erros de tipo preexistentes |
| Não fazer deploy sem autorização | OK — nenhum deploy; publicação apenas por `git push` no GitHub da cópia |
| Documentação atualizada | OK — este documento e os READMEs |

## 6. Como validar

- Biblioteca (`ClebersonF/primavera`): `npm test` (vitest) e `npx tsc --noEmit`.
- App (cópia): `npx tsc --noEmit` deve manter os 54 erros preexistentes e nenhum em `pmo`, `planning`, `features/schedule`.
- Persistência: com o Odoo indisponível a gravação é recusada com aviso; em obra do Odoo, a leitura parte sempre do registro atual.
- Telas: abrir **Gestão de Projetos (PMO)** no menu; `/obras/<id>/cronograma` e `/obras/<id>/planejamento`. Fluxo validado em navegador com as obras de exemplo (baseline → custo realizado → mudança aprovada → cronograma e portfólio atualizados).

## 7. Riscos e decisões pendentes

1. Alíquotas de CBS e redução de 30% são estimativas; confirmar com a contabilidade antes de faturar.
2. Prazos do GRAPROHAB são estimativas nossas sobre um manual gerado por IA.
3. Pesos da priorização (natureza 30%, desvio de prazo 30%, proximidade do prazo 25%, orçamento 15%) e o limite de 30% do alerta de caixa são convenções nossas.
4. Planejamento gravado no campo de notas de `x_obras` (JSON): sem trilha de auditoria e sem consulta/relatório no Odoo. Obras que existem só no cache do navegador (exemplos) **não gravam** no Odoo. Migrar para modelo dedicado (`x_obras_planejamento`) exige criar o modelo no Odoo e liberar na função de borda.
5. Mudanças aprovadas valem no cronograma e no EVM; se a atividade for removida ou renomeada, o pedido é ignorado e a tela avisa nas premissas.

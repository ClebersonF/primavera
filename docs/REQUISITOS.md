# Requisitos e rastreabilidade — Gestão de Projetos (PMO) e identidade CALM

Atualizado em 04/11/2026. Legenda: **OK** atendido e validado · **Parcial** atendido com limite descrito · **Aberto** não atendido (depende de decisão, backend ou dado).

## 1. Fontes

| Fonte | Observação |
|---|---|
| Prompt da squad (CTO/orquestrador) | Define o processo de trabalho, não funcionalidades |
| Estudo de Impacto Tributário — CBS (.docx) | Alíquotas e créditos são **estimativas** do próprio estudo |
| Manual do GRAPROHAB (conversa do Gemini) | Texto **gerado por IA**; o manual não define prazo por etapa |
| Segundo link do Gemini | Abriu **vazio**; nada foi aproveitado dele |
| Diretriz do usuário | "Espelhar o Oracle Primavera quanto a funcionalidades" (funções, não visual nem marca) |
| Diretriz do usuário (04/11/2026) | Identidade da ferramenta para a **CALM** (projetos ambientais, impacto ecológico e social) e UI/UX que permita **priorizar o portfólio por essa estratégia** |
| Documentação Oracle — [Introducing P6 Professional](https://docs.oracle.com/cd/F74771_01/client_help/en_US/introducing_primavera_project_management.htm) | Lida nesta rodada. Cobre EPS/OBS, CPM e nivelamento, códigos e campos definidos pelo usuário, recursos e funções, multiusuário, rollups, limiares, questões e riscos, produtos de trabalho, visualizador, assistente de relatórios. **Não** cobre atividades, relações, restrições, calendários, linhas de base, layouts, mudança global, cópia/what-if nem passos |
| Documentação Oracle — [Primavera Unifier](https://www.oracle.com/construction-engineering/primavera-unifier/) | Página de produto lida nesta rodada (só os primeiros 100 mil caracteres). Custos e planilha de custos, processos de negócio e fluxos configuráveis, fluxo de caixa, documentos e assinatura, previsão, painéis, ativos, contratos, ordens de mudança. O Unifier **não** faz cronograma completo: integra o P6 |
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
| C10 | Aplicação ao faturamento e aos custos reais da app (Odoo) | Parcial | Aba **Tributos (CBS)** do planejamento da obra: faturamento = orçamento da obra (engenharia × software), notas de compra com CBS destacada e crédito elegível, saldo e transporte, gravado com a obra. **Sem leitura de notas reais do Odoo**: o conector (`odoo-patrimony`) não autoriza `account.move`; liberar exige alterar e publicar a função e conceder acesso a dados financeiros |

## 3. GRAPROHAB / CETESB

| # | Requisito do manual | Status | Evidência |
|---|---|---|---|
| G1 | Fluxo do processo em etapas, com e sem Comunique-se | OK | `buildGraprohabProcess`; Gantt na tela; duração por etapa editável |
| G2 | Checklist de documentos | Parcial | `GRAPROHAB_DOCUMENTS`; tela marca os faltantes, **gravado na obra** (selecione a obra na tela) por empreendimento |
| G3 | Prazo do Comunique-se (180 dias corridos) | OK | `comuniqueSeDeadline`; tela |
| G4 | Faixas de APP (Lei 12.651, art. 4º, I), nascentes 50 m, faixa não edificável 15 m | OK | `appBufferMeters`; tela |
| G5 | Coerência do quadro de áreas entre planta, memorial e cartas | OK | `checkAreaTableConsistency`; seção "Quadro de áreas" |
| G6 | Prazos reais de cada etapa | **Aberto** | O manual não os define; os usados são estimativas editáveis |
| G7 | Acompanhar vários processos por empreendimento/imóvel | Parcial | O processo principal (GRAPROHAB) mais até 20 processos adicionais **por obra** (fases, outorgas, licenças), cada um com etapas, prazos, documentos, áreas e certidão, gravados com a obra; o portfólio mostra quantos há e quantos têm certidão. Sem cadastro próprio de empreendimento nem processo compartilhado entre obras |

## 4. Paridade funcional com o Oracle Primavera (P6 / Unifier)

| # | Função | Status | Onde / limite |
|---|---|---|---|
| P1 | EAP/WBS com rollup de prazo, custo e progresso | Parcial | Motor completo; a obra vira EAP de um nível (raiz + atividades). Não há edição de EAP na tela |
| P2 | CPM, vínculos FS/SS/FF/SF com lag, folga total e livre, caminho crítico | **OK** | Aba **Atividades** do planejamento: predecessoras por código ("1.2 SS+2"), tipos FS/SS/FF/SF e defasagem; ciclos são recusados ao salvar |
| P3 | Restrições de data | Parcial | "Não iniciar antes de" (SNET) move a atividade; **"Terminar até"** (prazo-limite) mostra folga ou violação em dias úteis na aba Atividades, no Gantt (selo "prazo violado") e no CSV, **sem mover** a atividade. Sem restrição "obrigatória" |
| P4 | Calendários e feriados | Parcial | Feriados cadastráveis por obra (aba Atividades) e usados em datas, hoje e EVM; um calendário por obra, sem calendários por atividade |
| P5 | Gantt e caminho crítico | OK | `/obras/$id/cronograma` |
| P6 | Gantt com barras da baseline | **OK** | Barra fina da baseline mais recente sobre cada atividade, com liga/desliga na tela do cronograma |
| P7 | Linhas de base múltiplas e comparação | **OK** | Aba **Linha de base**: várias baselines, comparação e botão **"Usar como primária"**; a primária (ou a mais recente, se nenhuma foi escolhida) é a base do EVM e das barras do Gantt |
| P8 | Atualização de progresso | **OK** | % concluído editável por atividade e **datas reais de início e término** (término real = 100% se o % não for informado); barra de execução real no Gantt e colunas no CSV |
| P9 | Recursos e histograma | Parcial | `/pmo/recursos`: carga por responsável (1 pessoa por atividade), **diária por responsável e custo de mão de obra**, **sugestão de nivelamento** (não altera o plano). Sem calendário de recursos nem várias unidades por atividade na tela |
| P10 | Planilha de custos (orçado, comprometido, realizado, previsão, variação) | OK | Aba **Custos** |
| P11 | Curva S / fluxo de caixa | OK | Tela de cronograma |
| P12 | Valor agregado (PV, EV, SPI, CPI, EAC, ETC, VAC, TCPI) | OK | `src/evm`; portfólio e aba Custos; PV/EV medidos contra a baseline primária |
| P13 | Portfólio e priorização | Parcial | `/pmo`: ranking multicritério com **estratégia escolhida na tela** (preset Operacional ou Impacto socioambiental/CALM, ou pesos personalizados guardados no navegador de quem escolheu); matriz prioridade × situação do prazo; **cenários "e se"** por obra. Sem cenários de portfólio e sem pesos compartilhados entre usuários |
| P14 | Pedidos de mudança com impacto e aprovação | Parcial | Aba **Mudanças**: fluxo e impacto; aprovação por papel (gerente/diretor); **não** usa a tela de Aprovações da app |
| P15 | Gestão de riscos | **OK** | Aba **Riscos**: registro (probabilidade × impacto 1–5, status, responsável, resposta, atividade), matriz 5×5 e coluna de riscos no portfólio; sem análise quantitativa (Monte Carlo) |
| P16 | Códigos de atividade, filtros e layouts, relatórios | Parcial | Grupo (código de atividade) por atividade, filtro por grupo; **CSV do cronograma** e **CSV do relatório do portfólio** (ranking, EVM, riscos, impacto, ODS). Sem layouts salvos nem relatório formatado/PDF |
| P17 | Persistência compartilhada, multiusuário, histórico e auditoria | Parcial | Baseline, custos e mudanças são gravados **com a obra no Odoo** (`x_obras`, campo de notas, mesmo mecanismo das demais informações da obra); outra pessoa enxerga na hora. Conflito simultâneo é **detectado** (quem grava primeiro é avisado), não evitado. **Histórico de alterações** (quem, quando, o quê; últimas 300) na aba Histórico; modelo dedicado no Odoo segue como evolução |
| P18 | Perfis de acesso | OK | Menu e rotas PMO só para analista, gerente e diretor (`src/lib/rbac.ts`) |

## 4A. Estratégia CALM — projetos ambientais e impacto ecológico e social

| # | Requisito | Status | Onde / limite |
|---|---|---|---|
| E1 | Identidade da CALM (nome, logo, **paleta aplicada em todo o app, inclusive menu lateral, fundo, bordas e modo escuro**, vocabulário "Projetos/Áreas", textos de entrada, título e rodapé de PDF) | OK | Marca `calm` é a padrão (`src/stores/branding.ts`); o tema agora é aplicado por folha de estilo na raiz (`BrandProvider`), valendo também na entrada e no login. Quem já tinha a marca KONSTRUI ativa migra para a CALM; conta real cuja organização ainda tem a marca KONSTRUI de origem usa a CALM. Contraste conferido (mín. 6:1 no texto corrente). Logo é texto (CA/LM); **não há logomarca oficial** — envie o arquivo em Marca branca |
| E2 | Registrar impacto por projeto (biodiversidade, clima, água/solo, social; hectares, pessoas, tCO2e) | OK | Aba **Impacto** do planejamento; gravado com a obra; entra no histórico |
| E3 | Priorizar o portfólio pela estratégia | OK | Seletor de estratégia e pesos na tela `/pmo`; padrão Operacional ignora impacto; preset CALM pesa impacto 45% |
| E4 | Totais de impacto do portfólio e aviso de projetos não avaliados | OK | Cartões em `/pmo`; fator ausente vale neutro e é marcado com "*" |
| E5 | Rigor dos números de impacto (metodologia, evidência, ODS) | Parcial | Aba Impacto tem **ODS (1–17)**, **metodologia** e **evidência** (texto); o portfólio mostra projetos por ODS e avisa os que têm impacto sem metodologia; o CSV leva tudo. Continua sem validação externa, sem anexo de arquivo, sem inventário de carbono nem mapeamento GRI. A metodologia em si precisa ser definida pela CALM |
| E6 | Pesos da estratégia compartilhados pela equipe | **Aberto** | Pesos personalizados ficam só no navegador; os presets são iguais para todos. Compartilhar exige gravar em local central (Odoo) |
| E7 | Licenciamento ambiental (GRAPROHAB/CETESB) por projeto | OK | Vários processos por projeto (G7); os prazos de cada etapa seguem como estimativas editáveis (G6) |

## 4B. GAP consolidado em relação ao Primavera (P6 e Unifier)

Cobertura real hoje: motor de cronograma e valor agregado completo; planejamento, custos, mudanças, riscos, cenários, histórico, licenciamento, CBS e impacto em uma tela por obra; portfólio e recursos. Lacunas, da mais relevante para a estratégia da CALM para a menos:

| Função do Primavera | Fonte | Situação na app | Observação |
|---|---|---|---|
| Estrutura corporativa (EPS) e organizacional (OBS) | P6 (doc. lida) | Parcial | Um nível de programa/carteira acima do projeto, com consolidação no portfólio (orçamento, SPI, impacto, alertas); sem árvore de vários níveis nem responsabilidades por nó (OBS) |
| Atribuição de recursos e funções (unidades, curvas, calendário de recurso) | P6 (doc. lida) | Parcial | Várias atribuições por atividade (função ou pessoa, com unidades), capacidade e diária por recurso, histograma com superalocação e nivelamento sugerido; sem curvas de alocação nem calendário próprio de recurso |
| Códigos de atividade e campos definidos pelo usuário | P6 (doc. lida) | Parcial | Até 10 tipos de código com lista fechada de valores, aplicados por atividade, com resumo de atividades e custo por valor; sem hierarquia de códigos, sem códigos de projeto e sem campos numéricos ou de texto definidos pelo usuário |
| Layouts, filtros salvos e assistente de relatórios | P6 (doc. lida) | Parcial | Filtro por grupo, dois CSVs e impressão/PDF do portfólio com a identidade da marca; sem layouts salvos nem assistente de relatórios |
| Limiares (management by threshold), questões (issues) | P6 (doc. lida) | Parcial | Questões com responsável e prazo por obra; alertas por limiar (SPI, CPI, prazo, riscos, questões vencidas) no portfólio, com limiares editáveis na tela (salvos no navegador de cada usuário, não na organização) |
| Produtos de trabalho e documentos por atividade | P6 (doc. lida) | **Não há** | A app tem módulo de documentos geral, sem vínculo com a atividade do planejamento |
| Visualizador de lógica (diagrama de rede) | P6 (doc. lida) | **Não há** | Só Gantt |
| Cópia de projeto e what-if entre projetos | não confirmado na doc. lida | Parcial | Cenários por obra; sem cenário de portfólio |
| Mudança global, passos de atividade, restrições obrigatórias | não confirmado na doc. lida | **Não há** (restrição "terminar até" existe) | Conhecimento geral do produto; confirmar na doc. completa |
| Planilha de custos ligada a contratos, compromissos e pagamentos | Unifier (doc. lida) | Parcial | Aba Custos por atividade (orçado, comprometido, realizado, previsão); sem contratos nem pagamentos ligados |
| Processos de negócio e fluxos configuráveis | Unifier (doc. lida) | Parcial | Fluxo fixo de pedidos de mudança com aprovação por papel; sem construtor de fluxo e fora da tela de Aprovações da app |
| Fluxo de caixa por cronograma, projeto e portfólio | Unifier (doc. lida) | Parcial | Curva S por obra e fluxo mensal consolidado do portfólio e por programa (previsto × realizado, CSV); o realizado é distribuído por premissa, sem lançamentos de caixa reais |
| Previsão contra a linha de base, painéis e relatórios | Unifier (doc. lida) | Parcial | EVM, EAC/ETC e painel de portfólio; sem biblioteca de relatórios |
| Assinatura digital e revisão de documentos | Unifier (doc. lida) | Fora de escopo | Existe fluxo próprio de assinatura em OS |
| Ordens de mudança que atualizam contrato e planilha de custos | Unifier (doc. lida) | Parcial | Mudança aprovada altera prazo/EVM; não altera contrato |
| Ativos: manutenção, garantias, inspeções, locação | Unifier (doc. lida) | **Já existe** (módulos de Facilities/Patrimônio) | Não faz parte do PMO |

Funções que o Primavera não tem e a app passou a ter: licenciamento GRAPROHAB/CETESB, CBS por obra e impacto socioambiental com priorização por estratégia.

## 5. Processo (prompt da squad)

| Exigência | Status |
|---|---|
| Entender → investigar → planejar → implementar → testar → revisar | OK — fluxo seguido; revisor independente apontou 7 defeitos na Onda 3; os 7 foram tratados, com teste de regressão |
| Não esconder testes que falham; separar bug de ambiente | OK — registrado: o build local não roda (vite.config.ts é script Deno); 20 erros de tipo preexistentes na última conferência (eram 31 antes das correções feitas pelo próprio Lovable), nenhum em arquivos do PMO |
| Não fazer deploy sem autorização | OK — nenhum deploy; publicação apenas por `git push` no GitHub da cópia |
| Documentação atualizada | OK — este documento e os READMEs |

## 6. Como validar

- Biblioteca (`ClebersonF/primavera`): `npm test` (vitest) e `npx tsc --noEmit`.
- App (cópia): `npx tsc --noEmit` deve manter só os erros preexistentes (20 na última conferência) e nenhum em `pmo`, `planning`, `features/schedule`, `stores/branding`.
- Persistência: com o Odoo indisponível a gravação é recusada com aviso; em obra do Odoo, a leitura parte sempre do registro atual.
- Telas: abrir **Gestão de Projetos (PMO)** no menu; `/obras/<id>/cronograma` e `/obras/<id>/planejamento`. Fluxo validado em navegador com as obras de exemplo (baseline → custo realizado → mudança aprovada → cronograma e portfólio atualizados).

## 7. Riscos e decisões pendentes

1. Alíquotas de CBS e redução de 30% são estimativas; confirmar com a contabilidade antes de faturar.
2. Prazos do GRAPROHAB são estimativas nossas sobre um manual gerado por IA.
3. Pesos da priorização (natureza 30%, desvio de prazo 30%, proximidade do prazo 25%, orçamento 15%) e o limite de 30% do alerta de caixa são convenções nossas.
4. Planejamento gravado no campo de notas de `x_obras` (JSON): sem trilha de auditoria e sem consulta/relatório no Odoo. Obras que existem só no cache do navegador (exemplos) **não gravam** no Odoo. Migrar para modelo dedicado (`x_obras_planejamento`) exige criar o modelo no Odoo e liberar na função de borda.
5. Mudanças aprovadas valem no cronograma e no EVM; se a atividade for removida ou renomeada, o pedido é ignorado e a tela avisa nas premissas.
6. Impacto socioambiental (notas 0–5, hectares, pessoas, tCO2e) é estimativa do time, sem metodologia ou evidência anexada; não usar em comunicação externa sem validação técnica.
7. Pesos de priorização personalizados e a marca ativa ficam no navegador de cada pessoa (localStorage); outra pessoa vê os presets e a marca padrão.
8. O Lovable altera o código por conta própria (correções automáticas após cada sincronização): confira o histórico do GitHub antes de novos commits.

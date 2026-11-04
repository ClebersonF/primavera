# gestor-galpoes-pmo

Controle de projetos para o Gestor de Galpões Inteligente, espelhando as funções do Oracle Primavera (P6 e Unifier). Funções reproduzidas, sem copiar visual ou marca da Oracle. TypeScript puro, sem dependências de runtime.

## Módulos

| Pasta | O que faz |
|---|---|
| `src/cpm` | Motor CPM: vínculos FS/SS/FF/SF com lag, folga total e livre, caminho crítico, calendário de dias úteis e feriados |
| `src/wbs` | EAP/WBS: árvore com códigos (1.2.3), validação, CPM nas folhas e rollup de prazo, custo e progresso nos resumos |
| `src/baseline` | Linha de base imutável e comparação (atraso, custo, atividades novas e removidas) |
| `src/cost` | Cost sheet em árvore (orçado, comprometido, realizado, previsão) e curva S planejada em centavos |
| `src/changes` | Pedidos de mudança: fluxo de aprovação, impacto em prazo, custo e caminho crítico, aplicação só de mudanças aprovadas |
| `src/tax` | CBS (Lucro Presumido, não cumulativo): duas alíquotas, créditos de entrada, saldo devedor ou credor, divisão da NF em duas linhas |
| `src/licensing` | GRAPROHAB/CETESB: etapas do processo, checklist de documentos, quadro de áreas, faixas de APP, prazo do Comunique-se |
| `src/evm` | Valor agregado: PV (linear por atividade), EV, SPI, e CPI/EAC/ETC/VAC/TCPI quando há custo real |
| `src/resources` | Histograma de recursos por semana útil, pico diário e superalocação |
| `src/portfolio` | Priorização multicritério do portfólio (natureza, desvio de prazo, proximidade do prazo, orçamento), com pesos editáveis |

Convenções: tempo em dias úteis inteiros (atividade ocupa `[início, fim)`); dinheiro em BRL, somado em centavos inteiros; erros de domínio são `PmoError` (e `CpmError` no CPM).

## Pontos de atenção

- **CBS:** 11,3% de alíquota padrão e 30% de redução para engenharia vêm do estudo, que as chama de "estimadas". São parâmetros (`CbsConfig`); valide com o contador antes de usar em faturamento.
- **GRAPROHAB:** o manual de origem foi gerado por IA e não define prazo de cada etapa. As durações em `GRAPROHAB_STEPS` são estimativas editáveis; só os 180 dias corridos do Comunique-se vêm do manual.
- **Faixa de APP:** em larguras exatas (10, 50, 200, 600 m) adota-se a faixa maior, mais protetora.

- **EVM:** sem custo real (AC), só PV/EV/SV/SPI são calculados. A priorização usa convenções editáveis (`NATURE_URGENCY`, pesos); não é regra normativa.

## Uso

```ts
import { planWbs, createBaseline, compareToBaseline, plannedSCurve, spreadFromPlan } from "./src";

const plan = planWbs([
  { id: "1", parentId: null, name: "Obra" },
  { id: "A", parentId: "1", name: "Fundação", duration: 5, plannedCost: 1000 },
  { id: "B", parentId: "1", name: "Estrutura", duration: 10, plannedCost: 2500, predecessors: [{ id: "A" }] },
]);
plan.cpm.criticalPath; // ["A", "B"]
const base = createBaseline("Base 1", "2026-11-04", plan);
plannedSCurve(spreadFromPlan(plan), 5); // curva S semanal
```

## Próxima onda

Telas de baseline, cost sheet e pedidos de mudança por obra; custo real (AC) no cadastro de obras para habilitar CPI/EAC.

## Desenvolvimento

```bash
npm install
npm test
npm run typecheck
```

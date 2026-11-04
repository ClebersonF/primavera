# gestor-galpoes-pmo

Controle de projetos para o Gestor de Galpões Inteligente, espelhando as funções do Oracle Primavera (P6 e Unifier). Funções reproduzidas, sem copiar visual ou marca da Oracle.

## Onda 1 — motor CPM (`src/cpm`)

TypeScript puro, sem dependências de runtime, pronto para copiar para `src/features/schedule/` do projeto Lovable.

- Vínculos FS, SS, FF e SF, com lag e lead (lag negativo).
- Restrição "não iniciar antes de" e marcos (duração 0).
- Início e término mais cedo e mais tarde, folga total, folga livre e caminho crítico.
- Detecção de dependência circular (`CpmCycleError`) e validação de entrada (`CpmError`).
- Calendário de dias úteis com feriados: `toCalendarDates`, `workDayAt`.

```ts
import { scheduleCpm, toCalendarDates } from "./cpm";

const r = scheduleCpm([
  { id: "A", duration: 5 },
  { id: "B", duration: 2, predecessors: [{ id: "A" }] },
]);
r.criticalPath; // ["A", "B"]
toCalendarDates(r, "2026-11-02");
```

Convenção: dias úteis inteiros; atividade ocupa `[início, fim)`.

## Próximas ondas

2. EAP/WBS, baseline, cost sheet, curva S e mudanças (inclui CBS e licenciamento GRAPROHAB).
3. EVM, recursos e portfólio.

## Desenvolvimento

```bash
npm install
npm test
npm run typecheck
```

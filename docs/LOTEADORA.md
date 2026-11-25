# Loteadora 360º — Fase 1 (Sol Maior)

Implementa a parte de governança e prazos do "Documento Operacional e Diretrizes do Sistema de Gestão 360º" da Loteadora Sol Maior, com o piloto Nova Marina em mente. A lógica fica em `src/loteadora/` (sem React); a tela é `/pmo/loteadora` no app.

## Onde os dados ficam

No campo `loteadora` do planejamento da obra (`WorkPlanning`), gravado junto com o cronograma no Odoo (`x_obras`). `withLoteadora(p, muda)` aplica a mudança, valida o estado inteiro (`cleanLoteadora`) e recusa a gravação se algum item ficar inválido ou repetido; nada é gravado pela metade. O histórico de alterações do planejamento registra o que mudou (`describeLoteadoraChange`).

## Módulos

| Arquivo | O que faz | Regras do documento |
| --- | --- | --- |
| `cadastro.ts` | Ficha do empreendimento, trechos, lotes; importação CSV; resumo | Status físico e comercial; trava do R-01 (vendido/reservado sem matrícula); diferença de área vendável |
| `regulatorio.ts` | Processos por frente, eventos, RET, certificado, cartório, parâmetros | RET 60 dias, amarelo D+30, vermelho D+40, petição D+45 (+120); cartório 180 dias com marcos D+20, D+30, D+90, D+120; nota devolutiva em 10 dias úteis; certificado de 4 anos com aviso 180 dias antes; check-in a cada 7 dias; tempo interno × órgão |
| `alcadas.ts` | Equipe, solicitações, decisões, fila, SLA | Pré-aprovação técnica → Presidência → CFO; medição dentro do contrato dispensa a Presidência; exceção comercial sem etapa financeira; aditivo exige impacto no reforecast; devolver e reprovar exigem justificativa; SLA de 3 dias úteis (urgente 48 h); fila pelo caminho crítico |
| `reforecast.ts` | Etapas do orçamento, snapshot mensal, comparação | Fechamento até o 5º dia útil do mês seguinte; mês congelado não muda; desvio até 3% verde, até 5% amarelo, acima vermelho; margem bruta = (VGV − reforecast) ÷ VGV |
| `alertas.ts` | Junta tudo num painel de alertas | Escala: amarelo → responsável; vermelho → + diretoria técnica; crítico → + Presidência |

Todos os prazos são parâmetros editáveis por obra (`ParametrosRegulatorios`); o padrão é o do documento.

## Formato do CSV

Lotes: `quadra;lote;area_m2;matricula;trecho;fisico;comercial`. Trechos: `id;rua;trecho;largura_pista_m;passeio_m;pavimento_m2`. Aceita ponto e vírgula ou vírgula, campos entre aspas e números no padrão brasileiro ("1.400,50"). Cabeçalhos com unidade ("Área (m²)") são reconhecidos. A importação substitui a lista atual; linhas com erro são listadas e ignoradas.

## Limites desta fase

- Os alertas são calculados quando a tela abre. O envio por WhatsApp ou e-mail depende de tarefas agendadas no servidor, ainda não criadas.
- "Agindo como" na Central de Alçadas registra quem decidiu e aplica a segregação por papel, mas não é autenticação: o papel ainda não vem do login.
- Fora desta fase: espelho de vendas e reservas com expiração, diário de obra, RNC, boletim de medição por trecho, gates por trecho e versionamento de pranchas.

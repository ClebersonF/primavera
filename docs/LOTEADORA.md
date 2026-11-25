# Loteadora 360º — Fases 1, 2 e 3 (Sol Maior)

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

## Fase 2 — canteiro e anti-refação

| Arquivo | O que faz | Regras do documento |
| --- | --- | --- |
| `campo.ts` | Gates das 8 frentes por trecho, checklist de liberação, diário de obra | Pavimentação só com drenagem, água/esgoto e guias 100%; TVO com todas as frentes e zero RNC aberta no trecho; conclusão exige checklist completo; diário até 17h30 com efetivo, equipamentos, clima, pluviometria, avanço por trecho e fotos datadas/georreferenciadas; dia de chuva a partir de 10 mm (parâmetro) |
| `qualidade.ts` | RNC | Plano de ação em 48 h; correção e validação pela diretoria técnica; aberta há mais de 7 dias é alerta; índice de refação = custo de retrabalho ÷ custo direto (meta < 1,5%) |
| `medicao.ts` | Boletim de medição quinzenal | Dias 15 e 30 com envio em D+1 e ao menos uma foto do diário; conferência em 2 d.u. bloqueada por RNC aberta no trecho e por excesso sobre o contrato sem aditivo aprovado; financeiro exige NF, conferência fiscal, SST e retenção (padrão 5%); pago entra no realizado da atividade |
| `suprimentos.ts` | Fornecedores, cotações, pranchas | Homologação: experiência em SP (m³/m²/m), garantia ≥ 5 anos, ABNT e 5 certidões válidas; score 0–100 por RNC, devoluções e certidões; cotação com 3 propostas de homologados ou justificativa, e justificativa fora do menor preço; escolha abre a contratação na Central de Alçadas; só a última revisão da prancha é vigente e cotação com revisão superada vira alerta |

As fotos do diário vão para o repositório de arquivos (bucket privado, ação `signed_document_url` do `odoo-patrimony` para exibir). Sem login no servidor o envio falha e a foto fica como miniatura de 320 px no próprio diário, com teto de 40 por obra.

## Fase 3 — comercial e BI 360º

| Arquivo | O que faz | Regras do documento |
| --- | --- | --- |
| `comercial.ts` | Tabela, reservas, propostas, vendas, indicadores, fluxo de caixa | Sem registro do loteamento (R-01) e matrícula do lote, não reserva nem vende; reserva de 48 h ligada a CPF/CNPJ válido; proposta abaixo da tabela, com entrada menor que a mínima ou mais parcelas que o máximo abre exceção comercial na Central de Alçadas (Presidência); contrato exige crédito aprovado e exceção aprovada; parcelas Price mensais; entrega exige entrada paga, infraestrutura concluída e termo assinado; VSO = vendas do mês ÷ estoque no início do mês; inadimplência = vencido há mais de 30 dias ÷ vencido; breakeven padrão de 80 lotes |
| `painel.ts` | Resumo por empreendimento e KPIs por perfil | Presidência vê tudo; Engenharia (IDP, avanço, RNC, refação, chuva); Ambiental (cartório, processos, RET); Financeiro (IDC, margem, desvio, carteira, inadimplência, VSO) |

CPF/CNPJ dos compradores ficam no planejamento da obra e aparecem mascarados nas telas. A reserva expira pelo relógio, na leitura; não há tarefa agendada. O relatório executivo abre numa página própria e sai em PDF pela impressão do navegador.

## Formato do CSV

Lotes: `quadra;lote;area_m2;matricula;trecho;fisico;comercial`. Trechos: `id;rua;trecho;largura_pista_m;passeio_m;pavimento_m2`. Aceita ponto e vírgula ou vírgula, campos entre aspas e números no padrão brasileiro ("1.400,50"). Cabeçalhos com unidade ("Área (m²)") são reconhecidos. A importação substitui a lista atual; linhas com erro são listadas e ignoradas.

## Limites desta fase

- Os alertas são calculados quando a tela abre. O envio por WhatsApp ou e-mail depende de tarefas agendadas no servidor, ainda não criadas.
- "Agindo como" na Central de Alçadas registra quem decidiu e aplica a segregação por papel, mas não é autenticação: o papel ainda não vem do login.
- Fora das três fases: envio automático de alertas e relatórios (WhatsApp/e-mail), login com papéis no servidor, mapa georreferenciado do espelho, conciliação bancária das baixas e app de canteiro offline.

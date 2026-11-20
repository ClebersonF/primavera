# Calculadora oficial da Receita Federal (RTC) — integração

A partir desta versão, o projeto calcula CBS, IBS e Imposto Seletivo pelas calculadoras de código aberto da Receita
Federal (Reforma Tributária do Consumo, LC 214/2025), em vez de estimar. O projeto **não reimplementa** alíquota, redução
nem base: monta a operação, chama o serviço e mostra a resposta.

## O que são os repositórios

| Repositório | O que faz | Tecnologia | Porta padrão |
|---|---|---|---|
| `ReceitaFederal/calculadora-rtc-regime-regular` | CBS, IBS e Imposto Seletivo no regime geral; base de cálculo unificada (NF-e, NFC-e, NFS-e); geração e validação do XML; tabelas oficiais (CST, cClassTrib, NCM, NBS, alíquotas de referência) | Java 25, Spring Boot, SQLite | 8080 (`/api`) |
| `ReceitaFederal/calculadora-rtc-simples-nacional` | CBS e IBS no Simples Nacional | Java 25, Spring Boot, SQLite | 8082 (`/api`) |
| `ReceitaFederal/calculadora-rtc-gerador-danfse` | PDF do DANFSe a partir do XML da NFS-e | Go | 8080 |
| `nfe/rtc-calculadora-offline` | Espelho automático (nfe.io) do pacote "calculadora offline" do portal da Receita. É a mesma calculadora do regime geral em versão anterior (1.1.0, Java 21, atualizada em 18/03/2026). Use os repositórios `ReceitaFederal/*`, que são a origem e estão mais novos | Java 21 | 8080 (`/api`) |

Licença dos três repositórios da Receita: MIT.

São **serviços**, não bibliotecas: precisam rodar em um servidor seu (ou contêiner). O app (Lovable + Supabase) não roda Java nem Go.

## Como o projeto usa

```
tela "Calculadora oficial (Receita)"  →  função de borda `calculadora-rtc`  →  serviço da Receita hospedado por você
        (src/routes/.../pmo.rtc.tsx)        (supabase/functions/calculadora-rtc)
```

- `src/rtc/rtc.ts` (biblioteca): monta e valida a operação (`buildRtcOperacao`), resume a resposta (`summarizeRtcResponse`)
  e define a lista fechada de ações (`RTC_ACTIONS`). Testes em `tests/rtc.test.ts`.
- A função de borda exige usuário autenticado e só encaminha as ações da lista. Os endereços ficam em segredos do servidor.

### Segredos a cadastrar no Supabase

| Segredo | Exemplo |
|---|---|
| `CALCULADORA_RTC_REGIME_URL` | `https://rtc.suaempresa.com.br` (sem `/api`) |
| `CALCULADORA_RTC_SIMPLES_URL` | `https://rtc-simples.suaempresa.com.br` |
| `CALCULADORA_RTC_DANFSE_URL` | `https://danfse.suaempresa.com.br` |

Sem o segredo do regime, vale a instância pública da Receita (abaixo). Sem os do Simples e do DANFSe, a tela avisa que o serviço não está instalado.

### Instância pública da Receita (padrão para o regime geral)

A Receita mantém a calculadora no ar em `https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo` (ambiente piloto).
Verificado em 20/11/2026, pelo navegador: app 1.7.2, base V0073; responde sem autenticação às tabelas oficiais
(municípios, NBS, classificações, alíquotas) e ao cálculo em `/observabilidade/regime-geral`. Exemplo: serviço NBS
101011100, cClassTrib 000001, base de R$ 1.000,00 em 20/11/2026 → CBS 0,90% (R$ 9,00) e IBS 0,10% (R$ 1,00), `CALCULADO`.

- **É o destino padrão do regime geral**: sem `CALCULADORA_RTC_REGIME_URL`, o app usa essa instância.
- O navegador não consegue chamá-la direto (a Receita não libera CORS). A chamada sai do servidor do app, pela
  função de servidor `rtcRegimeFn` (`src/features/rtc/rtc.functions.ts`), publicada junto com as telas.
- Essa função não exige login: o destino é fixo, só as ações da lista são aceitas e não há segredo envolvido.
- **Verificado em produção em 20/11/2026** (`imoveis.cronossuite.store`, servidor em Cloudflare Workers): busca de
  município, tabela NBS, classificações por NBS e cálculo de ponta a ponta (NBS 101029000, cClassTrib 000001, base de
  R$ 1.000,00, Nova Odessa/SP → CBS R$ 9,00 e IBS R$ 1,00, `CALCULADO`). O runtime não aceita `fetch` com
  `redirect: "error"`; a função usa `"manual"`.
- É um ambiente piloto: a Receita pode mudar ou restringir o acesso sem aviso. A lista de classificações "aplicáveis"
  a um NBS que ela devolve é ampla; a escolha continua sendo da contabilidade.
- Simples Nacional e DANFSe não têm instância pública conhecida: continuam exigindo instalação própria e a função de
  borda `calculadora-rtc`.

## Subir os serviços

Regime geral (igual para o Simples, que usa a pasta `flyway/` deste mesmo repositório e a porta 8082):

```bash
git clone https://github.com/ReceitaFederal/calculadora-rtc-regime-regular.git && cd calculadora-rtc-regime-regular
mkdir -p ./calculadora/db
./mvnw flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf --batch-mode --errors   # gera o banco (obrigatório)
./mvnw clean package
java -Dspring.profiles.active=offline -jar target/api-regime-geral.jar                        # http://localhost:8080/api
```

DANFSe:

```bash
git clone https://github.com/ReceitaFederal/calculadora-rtc-gerador-danfse.git && cd calculadora-rtc-gerador-danfse
docker build -t danfse-go . && docker run -p 8081:8080 danfse-go:latest
```

Publique os três atrás de HTTPS e restrinja o acesso de rede à função de borda (os serviços não têm autenticação própria).

## Ações disponíveis

| Ação | Serviço | Caminho |
|---|---|---|
| `regime-geral` | regime | `POST /api/calculadora/observabilidade/regime-geral` (erro por item, sem interromper os demais) |
| `regime-geral-estrito` | regime | `POST /api/calculadora/regime-geral` (rejeita a operação inteira no primeiro erro) |
| `base-calculo`, `base-calculo-nfse` | regime | `POST /api/calculadora/base-calculo/base-calculo-unificada[-nfse]` |
| `aliquota-uniao`, `aliquota-uf`, `aliquota-municipio` | regime | `GET /api/calculadora/dados-abertos/aliquota-*` |
| `classificacoes-cbs-ibs`, `ncm`, `nbs` | regime | `GET /api/calculadora/dados-abertos/...` |
| `simples-nacional`, `atividades-simples` | simples | `POST /api/calculadora/observabilidade/simples-nacional`, `GET .../simples-nacional/atividades` |
| `danfse` | danfse | `POST /api/danfse` (XML → PDF) |

## Regras que a tela respeita

- A partir de 2027 as alíquotas nominais são obrigatórias na entrada; antes disso são proibidas. A tela decide pelo ano do fato gerador.
- A resposta é HTTP 200 mesmo com itens em erro: o total soma só os itens calculados, e a tela marca "Total parcial".
- `CALCULO_SIMULADO` = calculado com alíquotas informadas por quem chamou.

## Cálculo oficial na obra (aba Tributos do planejamento)

- A seção **Cálculo oficial — calculadora da Receita Federal** grava na obra a classificação (data, município, UF e, para
  cada linha da nota, NBS, CST e cClassTrib) e a última resposta da calculadora.
- O orçamento da obra é enviado em até duas linhas (serviço de engenharia e licença de software), na mesma divisão da
  estimativa. Linha com fatia zero não é enviada.
- O débito de CBS passa a ser o oficial; o **crédito das compras continua pela regra local** (a calculadora calcula o
  débito da operação, não o crédito). O IBS é exibido sem apuração de crédito.
- O valor oficial só é usado quando está **vigente**: calculado para o orçamento e a fatia atuais e com todos os itens
  calculados. Se o orçamento ou a fatia mudar, ou algum item falhar, a tela avisa e volta a valer a estimativa.
- Mudar a classificação descarta o resultado anterior. Cada gravação entra no histórico do planejamento.
- Funções: `buildWorkRtcOperacao`, `withTaxOfficialConfig`, `withTaxOfficialResult`, `assessWorkCbsOfficial` (`src/planning/planning.ts`).

## Como preencher — de onde vem cada informação

| Campo | O que é | Onde achar |
|---|---|---|
| Data do fato gerador | Dia da prestação do serviço ou da emissão da nota | Contrato ou medição; define alíquotas e regras vigentes |
| UF e município | Local da operação | Escolha a UF e digite o nome; o código IBGE exigido pela calculadora é preenchido sozinho (lista da calculadora ou, se ela não responder, do IBGE) |
| NBS (9 dígitos) | Código do serviço (Nomenclatura Brasileira de Serviços) | Botão **Localizar**, buscando pela descrição. Para mercadoria usa-se NCM (8 dígitos), que vem na nota do fornecedor |
| cClassTrib (6 dígitos) | Classificação tributária: tributação integral, redução, isenção etc. | Depois de escolher o NBS, a busca lista só as classificações aceitas para ele, com a redução de cada uma |
| CST (3 dígitos) | Situação tributária | São os 3 primeiros dígitos do cClassTrib; a tela preenche sozinha |
| Alíquotas de CBS e IBS | Só a partir de 2027 | Botão **Buscar alíquotas de referência** |
| Base de cálculo | Valor da operação sem CBS e IBS | Na obra, vem do orçamento |

As buscas usam as tabelas servidas pela própria calculadora (dados abertos), na instância pública ou na instalação própria.
Quem define o NBS e a classificação do contrato é a contabilidade: a busca mostra o que a tabela oficial permite, não o
enquadramento correto da operação.

## O que ainda não está ligado

- Tela para o Simples Nacional (a ação existe na função; a entrada tem regras próprias por tipo de documento).
- Geração e validação do XML dos grupos de tributação (`/xml/generate`, `/xml/validate`).
- Nada disso foi exercitado contra um serviço real: os testes usam o exemplo de resposta da documentação da Receita.

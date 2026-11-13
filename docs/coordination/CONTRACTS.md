# CONTRACTS — NETT Licita Intelligence

> **Seções abaixo são PROPOSTAS do Agente 02, pendentes de aprovação do Agente 01.**
> Enquanto não aprovadas, nenhum consumidor deve tratá-las como estáveis.

## C-02.1 Oportunidade normalizada (Agente 02 → Agentes 03 e 04) — `0.1.0-proposta`

Fonte de verdade em código: [`src/contrato/oportunidade.ts`](../../src/contrato/oportunidade.ts) (schema Zod; testes validam respostas reais contra ele).

| Requisito do briefing | Campo |
| --- | --- |
| Identificação | `id` (UUID interno), `chaveCanonica`, `identificacao.{numeroControlePncp, numeroCompra, ano, processo}` |
| Objeto | `objeto`, `informacaoComplementar` |
| Órgão | `orgao.{cnpj, nome, unidade, municipio, uf, esfera}` |
| Processo | `identificacao.processo` |
| Modalidade | `modalidade.{idPncp, nome}` (códigos PNCP, Lei 14.133) |
| Datas | `datas.{publicacao, aberturaPropostas, encerramentoPropostas, atualizacaoFonte}` (ISO 8601 UTC) |
| Valor | `valor.{estimado, homologado, moeda}` (`null` = sigiloso/não informado) |
| Link oficial | `linkOficial` (página PNCP), `linkSistemaOrigem` |
| Documentos | `documentos[]` (`fonte`, `idExterno`, `titulo`, `tipo`, `url`, `publicadoEm`, `coletadoEm`) |
| Origem / identificador externo | `origens[]` (`fonte`, `idExterno`, `urlOrigem`, `primeiraColetaEm`, `ultimaColetaEm`) |
| Data de coleta | `primeiraColetaEm`, `origens[].ultimaColetaEm` |
| Histórico de atualização | `versao`, `historico[]` (`versao`, `tipo`, `fonte`, `alteradoEm`, `camposAlterados{campo:{de,para}}`) |
| Extra | `itens[]`, `termosDicionario[]` (filtro comercial determinístico, **não** é aderência), `statusProcessamento` |

Regras:
- Deduplicação: `pncp:<numeroControlePNCP>` → `proc:<cnpj>:<processo>:<ano>` → `fonte:<fonte>:<idExterno>`.
- Prioridade de fonte por campo: PNCP > Compras.gov.br > SIGA/RJ; fonte menos confiável só preenche campos vazios.
- Suspeitas de duplicidade com chaves diferentes ficam em `GET /v1/duplicatas`; não há mescla automática.

## C-02.2 Eventos (outbox) — `GET /v1/eventos?apos=<id>&limite=&tipo=`

Consumo por *polling* com cursor `id` crescente (at-least-once; consumidor guarda o último `id`).

| Tipo | Quando | Payload |
| --- | --- | --- |
| `oportunidade.criada` | nova chave canônica | `chave, fonte, idExterno, versao` |
| `oportunidade.atualizada` | campo versionado mudou | `chave, fonte, versao, campos[]` |
| `oportunidade.pronta_para_avaliacao` | documentos e itens coletados | `chave, versao, documentos, itens` — **gatilho para o Agente 03** |
| `oportunidade.possivel_duplicata` | suspeita registrada | `outra, motivo, similaridade` |
| `trello.card_atualizado` | card novo/alterado | `resultado, lista` |

## C-02.3 API interna (Agente 02 → Agente 04) — `Authorization: Bearer <API_TOKEN_INTERNO>`

| Método/rota | Descrição |
| --- | --- |
| `GET /saude` | Saúde (sem token) |
| `GET /v1/oportunidades?q=&uf=&modalidade=&fonte=&status=&abertas=true&atualizadasDesde=&pagina=&tamanho=` | Lista resumida paginada |
| `GET /v1/oportunidades/{id}` | Oportunidade completa (C-02.1) |
| `GET /v1/oportunidades/{id}/historico` | Origens e histórico |
| `GET /v1/eventos` | Eventos (C-02.2) |
| `GET /v1/fontes` | Fontes, situação, última execução e motivo de indisponibilidade |
| `GET /v1/coletas?fonte=&limite=` | Execuções de coleta com contadores |
| `GET /v1/fila` | Estado da fila e limite por hora |
| `GET /v1/duplicatas?status=pendente` | Possíveis duplicatas |
| `GET /v1/trello/cards?lista=&pagina=&tamanho=` | Cards espelhados do Trello |
| `GET /v1/trello/cards/{id}` | Card com etiquetas, checklists, anexos e histórico |
| `GET /metricas` | Métricas Prometheus |
| `HEAD/POST /webhooks/trello` | Webhook Trello (assinatura HMAC-SHA1) |

## C-02.4 Banco — migration proposta

[`src/db/migrations/0001_integracao.sql`](../../src/db/migrations/0001_integracao.sql): schema isolado `integracao`; não toca tabelas de outros módulos. **Não aplicar em ambiente compartilhado antes da aprovação do Agente 01.**

# PROJECT_CONTEXT — NETT Licita Intelligence

> **Rascunho criado pelo Agente 02** porque o arquivo oficial não existia neste repositório nem em
> `Enzo47961/licitaflow-licitacoes`. O Agente 01 (Arquitetura) deve revisar, substituir ou aprovar.

## Agentes

| Agente | Responsabilidade |
| --- | --- |
| 01 — Arquitetura | Arquitetura, banco, contratos oficiais, aprovação de migrations |
| 02 — Dados e Integrações | Conectores (PNCP, Compras.gov.br, SIGA/RJ, Trello), coleta, fila, normalização, deduplicação, API interna de dados |
| 03 — IA | Avaliação de aderência sobre oportunidades normalizadas |
| 04 — Produto e Interface | Aplicação; consome somente APIs internas |

## Origem do código

- Repositório base: `Enzo47961/licitaflow-licitacoes` (MIT). O cliente PNCP (`src/lib/pncp/client.ts`, `api.ts`, `modalidades.ts`) foi portado e generalizado em `src/http/cliente.ts`, `src/conectores/comum.ts` e `src/conectores/pncp/conector.ts`.
- Este repositório começou vazio em 13/11/2026. Serviço do Agente 02: TypeScript (Node ≥ 22), PostgreSQL, sem framework web (decisão de framework fica com o Agente 01).

## Insumos pendentes (bloqueiam critérios de aceite)

- Credenciais Trello somente leitura (`TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_ID`, `TRELLO_APP_SECRET`) e URL pública para webhook.
- Dicionário comercial oficial da Nett (`config/dicionario-comercial.json`).
- Forma de acesso autorizada ao SIGA/RJ.
- Aprovação do contrato e da migration pelo Agente 01; ambiente de execução (hospedagem do worker/API/banco).

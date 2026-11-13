# TASK_BOARD.md — quadro de tarefas

Status: `pronta` · `bloqueada` · `em andamento` · `em revisão` · `concluída`.
Tag `[livre]` = sem dependência de contrato; pode começar antes da aprovação dos contratos v1.
Cada tarefa fecha com PR + handoff. Critério de aceite verificado pelo agente 01 no código e nos testes.

## Fase 0 — Coordenação (agente 01)

| ID | Tarefa | Status | Evidência |
| --- | --- | --- | --- |
| T-001 | Auditoria do LicitaFlow | concluída | `docs/architecture/audit-licitaflow.md` |
| T-002 | Arquitetura alvo | concluída (proposta) | `docs/architecture/target-architecture.md` |
| T-003 | Contratos v1 (Zod + doc) | concluída (aprovados 2026-11-13) | `src/contracts/`, `CONTRACTS.md`; 7 testes passando |
| T-004 | Rodar build/testes do snapshot e anexar resultado (P-01) | pronta | — |
| T-005 | CI sob demanda (alto impacto + manual) + template de PR | em revisão | `.github/workflows/ci.yml` |
| T-006 | Aprovação humana: contratos v1 e ADRs | concluída (2026-11-13) | aprovação na conversa com a responsável |
| T-007 | Aprovação humana: custos Railway/Keycloak (P-05) e provedor de IA (P-04) | bloqueada (humano) | — |

## Fase 1 — Fundação

| ID | Agente | Tarefa | Depende de | Status | Aceite |
| --- | --- | --- | --- | --- | --- |
| T-101 | 01 | Drizzle + schema de todas as entidades canônicas + migration inicial + usuários `app`/`migrator` | T-006 | concluída (PR #2) | schema compila contra `src/contracts`; teste de integração cria/lê cada tabela |
| T-102 | 01 | docker compose local: Keycloak (realm importável), S3 (SeaweedFS), Postgres opcional (profile) | — | em revisão | `npm run infra:up` sobe tudo; realm com usuários fictícios |
| T-103 | 01 | Auth.js + Keycloak, `requireSession`, `requireCompanyAccess`, provisionamento no 1º login | T-101, T-102 | pronta | testes: sem sessão → 401; outra empresa → 403 |
| T-104 | 04 | Tema de login Keycloak na paleta Nett | T-102 | bloqueada | screenshot + auditoria de cores |
| T-105 | 02 | pg-boss: `worker/index.ts`, registro de handlers, `enqueue` tipado | T-101 | pronta | teste: job enfileirado é processado e idempotente |
| T-106 | 02 | `ObjectStorage` S3 + URL assinada | T-102 | pronta | teste de integração com o S3 local (SeaweedFS) |
| T-107 | 01 | Headers de segurança (CSP, HSTS), rate limit por usuário | T-103 | bloqueada | teste de headers |
| T-108 | 01 | `AuditEvent` + `recordAudit()` | T-101 | pronta | escrita append-only testada |
| T-109 | 03 | Quota de IA por empresa (substitui `arremate.usos`) | T-101, T-007 | bloqueada | teste de limite e estorno |

## Fase 2 — Fontes (agente 02)

| ID | Tarefa | Depende de | Status |
| --- | --- | --- | --- |
| T-201 | `SourceConnector` PNCP sobre `src/lib/pncp/client.ts` (mantendo backoff/disjuntor) | T-003 | pronta [livre — só a camada de cliente/normalização pura, sem banco] |
| T-202 | `source.sync` + `source.normalize` persistindo SourceRecord → Opportunity/Item/Document | T-101, T-105 | bloqueada |
| T-203 | `document.fetch` (download com limite de tamanho, MIME, sem SSRF) | T-106, T-202 | bloqueada |
| T-204 | Rotas `/api/v1/opportunities*`, `/sources`, `/prices` | T-103, T-202 | bloqueada |

## Fase 3 — IA e análise (agente 03)

| ID | Tarefa | Depende de | Status |
| --- | --- | --- | --- |
| T-301 | Extrair `AnalysisEngine` de `src/lib/analysis.ts` (puro, sem store em memória) | T-003 | pronta [livre] |
| T-302 | `document.extract` (texto por página no storage) | T-106, T-203 | bloqueada |
| T-303 | `analysis.run` + cache por `inputHash` + rotas `/analyses` | T-105, T-302, T-007 (provedor; motor local liberado) | bloqueada |
| T-304 | `HumanReview` API + regras de `reviewStatus` | T-101, T-103 | bloqueada |
| T-305 | Aderência no servidor (`match.score`) a partir de `aderencia.ts` + capacidades | T-101 | bloqueada |
| T-306 | Relatório PDF no worker (ADR-014) | T-105 | bloqueada |
| T-307 | Testes de prompt injection com PDFs adversariais | T-301 | pronta [livre] |

## Fase 4 — Frontend e produto (agente 04)

| ID | Tarefa | Depende de | Status |
| --- | --- | --- | --- |
| T-401 | Tokens da paleta Nett em `globals.css`, remover `brand/accent/ink` | — | em revisão (agente-04/frontend) |
| T-402 | Teste que falha com cor fora da paleta (substitui/estende `scripts/audit-css.mjs`) | T-401 | em revisão (agente-04/frontend) |
| T-403 | Shell autenticado, seletor de empresa | T-103 | bloqueada |
| T-404 | Radar, oportunidade, preços consumindo `/api/v1` | T-204, T-305 | bloqueada |
| T-405 | Tela de revisão humana da análise | T-304 | bloqueada |
| T-406 | Pipeline persistido (`OpportunityTracking`) + cofre de certidões | T-103 (T-101 concluída) | bloqueada |
| T-407 | `metrics.compute` + painel de consultores | T-406, T-304 | bloqueada |

## Fase 5 — Integração (agente 01)

| ID | Tarefa | Depende de | Status |
| --- | --- | --- | --- |
| T-501 | E2E Playwright: login → radar → análise → revisão → pipeline → métrica | F1–F4 | bloqueada |
| T-502 | Remover rotas legadas, `localStorage`, Supabase e marca antiga | F4 | bloqueada |
| T-503 | Deploy staging no Railway (após aprovação de custo) | T-007 | bloqueada |

# PROJECT_CONTEXT.md — NETT Licita Intelligence

## Produto

Plataforma proprietária da Nett Tecnologia para inteligência em licitações públicas: encontrar oportunidades em fontes públicas (PNCP primeiro), ler editais com IA rastreável, medir aderência às capacidades de cada empresa cliente, apoiar a decisão humana de participar e acompanhar o desempenho dos consultores.

**Premissa aprovada com os contratos v1 (P-03):** consultores Nett atendem várias empresas clientes; cada empresa é um tenant isolado.

**Princípio inegociável:** apoio à decisão. A IA extrai e sinaliza; a decisão de participar, preço e envio de proposta são sempre humanos e registrados (`HumanReview`).

## Origem

Base: LicitaFlow (`Enzo47961/licitaflow-licitacoes`, MIT, commit `a4ed99f`), importado sem alterações. Auditoria: `docs/architecture/audit-licitaflow.md`.

Resumo: bom núcleo de domínio (cliente PNCP resiliente, análise com evidência, nota de aderência auditável), mas é uma demo pública — sem login, sem multiempresa, dados em `localStorage`/memória, IA síncrona, Supabase via RPC, paleta fora da identidade.

## Arquitetura de referência

Next.js + React + TypeScript · PostgreSQL (Drizzle) · Keycloak (OIDC) · Railway (`web` + `worker`) · Object Storage S3 · filas pg-boss. Detalhe: `docs/architecture/target-architecture.md`. Decisões: `DECISIONS.md`.

## Equipe

Quatro agentes, um produto. Papéis, branches e fronteiras em `AGENTS.md`. Contratos em `CONTRACTS.md` + `src/contracts`. Tarefas em `TASK_BOARD.md`. Comunicação assíncrona por `handoffs/`.

## Identidade visual

Somente `#050505 #0D0D0D #111111 #C9A227 #F0D375 #8A6D1A #ECECEC #AFAFAF` (tokens em `CONTRACTS.md §6`).

## Glossário

| Termo | Significado |
| --- | --- |
| Oportunidade | Contratação pública (edital/aviso) normalizada — `Opportunity` |
| Fonte | Origem de dados (PNCP, portal estadual, upload) — `Source` |
| Registro bruto | Captura imutável da fonte — `SourceRecord` |
| Aderência | Nota 0–100 com fatores nomeados — `MatchScore` |
| Revisão humana | Aprovação/correção/rejeição registrada — `HumanReview` |
| Cofre | Certidões da empresa com validade — `Document(kind=company_certificate)` |
| Pipeline | Acompanhamento da oportunidade pela empresa — `OpportunityTracking` |

## Comandos (estado atual, herdado)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # typecheck + unit + routes + css (scripts herdados)
npm run test:contracts   # contratos + alinhamento contrato↔schema
# Banco (Postgres 16+; docker compose virá em T-102)
npm run db:bootstrap     # papéis nett_app/nett_migrator + banco (superusuário)
npm run db:migrate       # aplica db/migrations como nett_migrator
npm run db:generate      # gera migration após alterar src/server/db/schema.ts
npm run test:db          # integração (DATABASE_URL_TEST)
```

## Pendências abertas

| ID | Pendência | Responsável |
| --- | --- | --- |
| P-01 | Executar build/testes do snapshot e registrar resultado | agente 01 (T-004) |
| P-02 | Validação jurídica do uso da base MIT em produto proprietário | humano |
| P-04 | Aprovar provedores de IA, retenção de dados e orçamento (ADR-008) | humano |
| P-05 | Aprovar criação/custo dos serviços Railway e Keycloak | humano |
| P-06 | Configurar branch protection na `main` (PR + CI + aprovação) | humano |
| P-07 | Prompts/escopo oficiais dos agentes 02–04 (escopo atual é proposta do 01) | humano |

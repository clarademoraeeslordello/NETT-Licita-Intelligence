# Arquitetura alvo — NETT Licita Intelligence

Status: **proposta v1** (agente 01, 2026-11-13). Decisões detalhadas em `docs/coordination/DECISIONS.md`.

## 1. Visão de componentes

```
                        ┌──────────────────────────┐
  Navegador ──OIDC────► │ Keycloak (realm nett)    │
     │                  └────────────┬─────────────┘
     │ HTTPS (cookie de sessão)      │ JWKS / token
     ▼                               ▼
┌───────────────────────────────────────────────────────────┐
│ Serviço "web" — Next.js (App Router)            Railway   │
│  • UI (agente 04)                                         │
│  • Route Handlers /api/v1/* (dono por módulo)             │
│  • src/server/auth  → sessão + tenant guard (agente 01)   │
│  • src/server/db    → Drizzle (agente 01)                 │
│  • enfileira jobs (pg-boss)                               │
└───────────────┬───────────────────────────┬───────────────┘
                │ SQL                       │ S3 API
                ▼                           ▼
        ┌───────────────┐          ┌──────────────────┐
        │ PostgreSQL    │          │ Object Storage   │
        │ dados + filas │          │ (bucket Railway) │
        │ (pg-boss)     │          │ PDFs, relatórios │
        └───────▲───────┘          └────────▲─────────┘
                │ SQL / jobs                │
┌───────────────┴───────────────────────────┴───────────────┐
│ Serviço "worker" — Node (mesmo repositório)     Railway   │
│  • source.sync / document.fetch (agente 02)               │
│  • document.extract / analysis.run / match.score (ag. 03) │
└───────────────┬───────────────────────────┬───────────────┘
                ▼                           ▼
        PNCP e outras fontes        Provedor de IA aprovado
```

## 2. Princípios

1. **Um produto, um repositório, um schema.** Entidades canônicas em `src/contracts` (Zod) e `src/server/db/schema` (Drizzle). Ninguém redefine.
2. **Servidor é a fonte da verdade.** Nada de negócio em `localStorage` ou memória de processo.
3. **Tudo que é lento ou externo vai para fila** (pg-boss sobre o mesmo Postgres). Requisição HTTP só enfileira e consulta status.
4. **Multiempresa desde o início.** Toda tabela de negócio tem `company_id`; todo acesso passa por `requireCompanyAccess()`.
5. **Rastreabilidade da IA.** Toda informação extraída mantém `status`, `quote`, `page`. Toda análise que alimenta decisão passa por `HumanReview`.
6. **Dados públicos ≠ dados do cliente.** Editais (públicos) podem ir a provedor de IA aprovado; dados de empresa cliente não, salvo decisão registrada.
7. **Identidade visual fechada**: 8 cores (CONTRACTS §6).

## 3. Camadas de código (destino)

```
src/
├── contracts/           # Zod: entidades canônicas, payloads de fila, DTOs de API (ag. 01)
├── server/
│   ├── db/              # Drizzle schema, client, helpers de tenant (ag. 01)
│   ├── auth/            # Keycloak OIDC, sessão, papéis, guards (ag. 01)
│   ├── jobs/            # registro de filas, enqueue tipado (ag. 02)
│   ├── storage/         # S3 client, chaves de objeto (ag. 02)
│   ├── sources/         # conectores (PNCP, ...), normalização → Opportunity (ag. 02)
│   ├── analysis/        # orquestra extração + IA → AIAnalysis (ag. 03)
│   └── matching/        # aderência Opportunity × CompanyCapability × SearchProfile (ag. 03)
├── lib/                 # código herdado do LicitaFlow, migrado gradualmente para server/
├── app/                 # UI e Route Handlers /api/v1 (ag. 04 + donos de rota)
└── components/ ui/      # design system (ag. 04)
worker/index.ts          # entrypoint do serviço worker (ag. 02)
db/migrations/           # SQL gerado por drizzle-kit (ag. 01)
e2e/                     # Playwright ponta a ponta (ag. 01)
```

## 4. Ambientes (Railway)

| Ambiente | Serviços | Observação |
| --- | --- | --- |
| `local` | docker compose: postgres, keycloak, minio | dados fictícios |
| `staging` | web, worker, postgres, bucket, keycloak | deploy da `main` |
| `production` | idem | promoção manual com aprovação humana |

Criação de projeto/serviços no Railway gera custo → **exige aprovação da responsável** (pendente).

## 5. Migração a partir do LicitaFlow (fases)

| Fase | Entrega | Gate |
| --- | --- | --- |
| F0 | Auditoria, arquitetura, contratos, quadro | aprovação dos contratos v1 |
| F1 | Fundação: Postgres+Drizzle, Keycloak, tenant guard, pg-boss, S3, CI, paleta | testes de integração verdes |
| F2 | Fontes: conector PNCP persistente → SourceRecord → Opportunity | dedupe e reprocessamento testados |
| F3 | Documentos + IA assíncrona → AIAnalysis + HumanReview | evidências rastreáveis, revisão obrigatória |
| F4 | Perfil, capacidades, aderência no servidor; pipeline e cofre persistidos | `localStorage` removido |
| F5 | Métricas de consultor, relatórios, E2E completo, hardening | E2E ponta a ponta verde |

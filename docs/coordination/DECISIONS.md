# DECISIONS.md — registro de decisões de arquitetura (ADR)

Formato: contexto → decisão → alternativas → impacto. Status: `proposta` (aguarda aprovação humana), `aceita`, `substituída`.
Quem pode propor: qualquer agente (via PR neste arquivo). Quem aceita: agente 01 + responsável humana para decisões estruturais.

> 2026-11-13: ADR-001 a ADR-014 aprovadas pela responsável humana. Aprovação de arquitetura **não** autoriza despesas (P-05) nem escolhe provedor de IA (P-04).

---

### ADR-001 — Base de código: snapshot do LicitaFlow · `aceita`
- **Contexto:** produto parte do LicitaFlow (`Enzo47961/licitaflow-licitacoes`, MIT).
- **Decisão:** importar o commit `a4ed99f` sem histórico, preservar `LICENSE` e aviso de copyright; evoluir no próprio repositório. Marca legada ("LicitaFlow", "Arremate") removida gradualmente.
- **Alternativas:** fork com histórico (traz histórico de terceiros e vínculo de fork); reescrever do zero (perde ativos da §3 da auditoria).
- **Impacto:** validação jurídica do uso MIT em produto proprietário pendente (P-02).

### ADR-002 — Next.js full-stack + serviço worker separado · `aceita`
- **Decisão:** um repositório, dois serviços Railway a partir do mesmo build: `web` (`next start`) e `worker` (`node worker/index.ts` via build TS). Serviços extras só com ADR.
- **Alternativas:** API separada (NestJS/Fastify) — mais infraestrutura sem ganho no estágio atual.
- **Impacto:** Route Handlers em runtime Node; nada de Edge runtime para rotas com banco.

### ADR-003 — PostgreSQL + Drizzle ORM + drizzle-kit · `aceita`
- **Decisão:** Drizzle para schema e queries; migrations SQL geradas em `db/migrations`, versionadas, aplicadas por script no deploy com usuário *migrator* separado do usuário da aplicação. Só o agente 01 mescla migrations.
- **Alternativas:** Prisma (engine binária, migrations menos transparentes); SQL puro (sem tipagem).
- **Impacto:** reaproveita padrão já usado pela Nett em outro projeto. Duas URLs: `DATABASE_URL`, `DATABASE_URL_MIGRATOR`.

### ADR-004 — Remover Supabase · `aceita`
- **Decisão:** substituir `src/lib/banco.ts` (RPC PostgREST com segredo compartilhado) por acesso direto ao Postgres. Migrations `supabase/` viram referência histórica e saem no fim de F3.
- **Impacto:** elimina `ARREMATE_SEGREDO`, `SUPABASE_*`.

### ADR-005 — Keycloak (OIDC) para identidade; autorização por empresa no banco · `aceita`
- **Decisão:** Auth.js (next-auth v5) com provider Keycloak, Authorization Code + PKCE, sessão em cookie `httpOnly`/`secure`/`SameSite=Lax`. Keycloak guarda identidade e papéis globais (`nett_admin`, `nett_consultant`); vínculo usuário↔empresa e papel por empresa (`company_admin`, `consultant`, `viewer`) ficam em `memberships` no Postgres. Usuário provisionado no primeiro login (`keycloak_sub`).
- **Alternativas:** grupos Keycloak por empresa (acopla tenancy ao IdP, difícil de consultar em SQL); `openid-client` manual (mais código de segurança próprio).
- **Impacto:** Keycloak como serviço no Railway (imagem oficial + Postgres próprio) — custo e operação a aprovar. MFA obrigatório para `nett_admin` (configuração do realm).

### ADR-006 — Filas com pg-boss sobre o Postgres · `aceita`
- **Decisão:** pg-boss no schema `pgboss` do mesmo banco. Contrato em `src/contracts/jobs.ts`.
- **Alternativas:** Redis + BullMQ (mais um serviço); SQS (fora do Railway).
- **Impacto:** persistência e retomada sem infra extra; throughput suficiente para o volume do PNCP. Revisar se passar de ~50 jobs/s.

### ADR-007 — Object Storage S3-compatível · `aceita`
- **Decisão:** bucket do Railway (API S3) via `@aws-sdk/client-s3`; MinIO no ambiente local. Prefixos `public/` e `companies/<id>/`. Download só por URL assinada (≤ 10 min) após authz.
- **Impacto:** variáveis `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`.

### ADR-008 — Provedores de IA e fronteira de dados · `aceita parcialmente` (fronteira de dados aceita; provedor pendente)
- **Contexto:** LicitaFlow usa DeepSeek ou Gemini. A política Nett proíbe enviar dados sensíveis a provedores não aprovados.
- **Decisão proposta:** manter abstração `AnalysisEngine`. Até aprovação formal de provedor: (a) somente texto de **documentos públicos** de licitação vai a LLM externo; (b) dados de empresa (capacidades, certidões, propostas) **não** vão a LLM; aderência é determinística; (c) texto de PDF é tratado como dado não confiável (delimitado no prompt, sem ferramentas, saída validada por Zod).
- **Pendente:** escolha do(s) provedor(es) aprovados, termos de uso/retenção, região, orçamento mensal e limite por empresa.

### ADR-009 — Paleta fechada de 8 cores · `aceita` (requisito do produto)
- **Decisão:** tokens em `CONTRACTS.md §6`; teste automatizado que falha com cor fora da lista (T-402).
- **Trade-off:** sem vermelho/verde para estados. Mitigação: ícone + texto + borda; `#8A6D1A` não usado para texto pequeno (contraste 4,16:1).

### ADR-010 — Servidor como fonte da verdade · `aceita`
- **Decisão:** perfil, pipeline e cofre saem do `localStorage` para Postgres. Sem modo "demo sem login" na v1.
- **Impacto:** remove `workspace-provider` baseado em `localStorage` ao fim de F4.

### ADR-011 — Idioma e nomenclatura · `aceita`
- **Decisão:** entidades/código em inglês (os nomes canônicos já vieram em inglês); UI pt-BR. Código herdado em português é migrado quando tocado, não em big-bang.

### ADR-012 — Testes e CI · `aceita`
- **Decisão:** Vitest (unidade e integração com Postgres real em container), Playwright (E2E). Scripts Node herdados continuam até serem portados. CI GitHub Actions: `typecheck`, `lint`, `test`, `build` em toda PR para `main`.
- **Impacto:** branch protection exige CI verde + aprovação (configuração humana).

### ADR-012a — CI somente em alterações de alto impacto · `aceita` (2026-11-13, pedido da responsável)
- **Decisão:** o workflow roda apenas em PR para `main` que toque contratos, banco/migrations, auth, filas/worker, dependências, configuração raiz, infraestrutura local ou o próprio CI; e manualmente (`workflow_dispatch`, com `next build` opcional). Mudanças só de UI ou documentação não disparam CI.
- **Compensação:** PRs fora dessas áreas trazem evidência local (comandos + saída) no template; o agente 01 pode disparar o CI manualmente quando julgar necessário.
- **Impacto:** branch protection não deve exigir o check como obrigatório em toda PR (ele não roda em todas); exigir aprovação do agente 01.

### ADR-015 — Object Storage local com SeaweedFS · `aceita`
- **Contexto:** imagens públicas do MinIO deixaram de estar disponíveis (Docker Hub e quay negaram o pull em 2026-11-13).
- **Decisão:** SeaweedFS (`chrislusf/seaweedfs:3.97`, Apache-2.0) com S3 API e credencial estática, só no ambiente local. Produção segue ADR-007 (bucket S3 do Railway). Código usa apenas a API S3 padrão (`forcePathStyle`).

### ADR-013 — Gerenciador de pacotes: npm · `aceita`
- **Decisão:** manter npm + `package-lock.json` herdados. Node 24 LTS (`engines`).
- **Alternativa:** pnpm (padrão em outro projeto Nett) — troca gera churn de lockfile sem benefício imediato.

### ADR-014 — Relatório PDF em container · `aceita`
- **Decisão:** substituir detecção de Chrome/Edge do Windows por Chromium do container (Playwright/`@sparticuz/chromium` ou imagem com Chromium), executado no **worker**, não no `web`. Relatório gerado vira `Document(kind=report, origin=generated)`.

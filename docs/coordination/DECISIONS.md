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

### ADR-005a — Implementação OIDC com `openid-client` em vez de Auth.js · `aceita` (agente 01, 2026-11-13)
- **Contexto:** Auth.js v5 continua em beta (`next-auth@5.0.0-beta.32`); v4 está em manutenção. Autenticação não deve depender de beta.
- **Decisão:** `openid-client` 6 (certificado OpenID, estável) + `jose` para o cookie cifrado do fluxo (PKCE S256, state, nonce). Sessão **server-side** na tabela `sessions`: cookie `httpOnly`/`SameSite=Lax` (`__Host-` em https) com token aleatório; banco guarda só SHA-256. Expiração absoluta 8 h, ociosidade 30 min, revogação no logout. Papéis globais vêm do claim `realm_roles` do ID token (mapper obrigatório no client do Keycloak) e são fotografados no login. Mutações em `/api/v1` exigem `Origin` igual a `APP_URL`.
- **Alternativas:** Auth.js v5 beta (menos código próprio, risco de API instável); v4 (manutenção, integração App Router mais frágil).
- **Impacto:** ADR-005 mantida quanto a Keycloak e autorização no banco; muda só a biblioteca. Mudança de papel no Keycloak vale no próximo login (≤ 8 h).

### ADR-016 — Endurecimento HTTP (T-107) · `aceita` (agente 01, 2026-11-15)
- **CSP com nonce por requisição** em `src/middleware.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action` só `self` + Keycloak). Exige renderização dinâmica (`await headers()` no layout raiz): perde-se cache estático de páginas, aceitável pois todas serão autenticadas. `style-src 'unsafe-inline'` mantido (estilos inline do React/Tailwind); revisar quando o design system permitir. Exceção `'unsafe-inline'` só para `/api/jobs/*/report.html` herdado, removida em T-306.
- **Cabeçalhos estáticos** em `next.config.ts`: HSTS (produção), `X-Frame-Options: DENY`, COOP, `Permissions-Policy`, `nosniff`; `X-Powered-By` removido.
- **Limite de requisições no Postgres** (janela fixa, upsert atômico; funciona com várias instâncias): `/api/v1` 300/min por sessão (ou IP), `/api/auth/login|callback` 20/min por IP. Falha aberta se o banco cair.
- **IP do cliente**: entrada de `X-Forwarded-For` na posição `TRUSTED_PROXY_HOPS` a partir do fim (padrão 1, Railway); só HMAC do IP é guardado. Sem XFF (local) todos compartilham o mesmo balde.
- **Alternativas:** CSP com `'unsafe-inline'` (simples, sem proteção real contra XSS); Redis para limite (serviço extra).

### ADR-017 — Autoridade do agente 01 sobre merge, deploy e coordenação · `aceita` (responsável humana, 2026-11-15)
- **Decisão (da responsável):** a comunicação interna entre os agentes é aprovada, sem necessidade de aprovação humana. O agente 01 é o principal responsável; os demais seguem suas recomendações; **somente o 01**, após analisar, faz ou encaminha merge e deploy.
- **Aplicação:** agentes 02–04 abrem PR, registram handoff e pedem o merge; o 01 revisa código e testes reais, resolve conflitos por merge da `main` na branch (sem rebase nem force-push) e mescla. Dependências, migrations e contratos passam pela análise do 01 e dispensam aprovação humana adicional.
- **Limites mantidos** (política Nett em AGENTS.md): despesas e serviços pagos, aceite de termos, escolha/orçamento do provedor de IA, dados de produção irreversíveis, decisões de impacto legal ou de direitos. Estes continuam com a responsável. Interpretação do 01: a frase "merge e deploy" cobre a execução técnica, não gasto novo; qualquer criação de recurso pago no Railway será confirmada antes.
- **Rastro:** cada merge fica no histórico da PR com a evidência da revisão; ações de agentes seguem o registro de auditoria proporcional ao risco.

### ADR-018 — Situação da oportunidade derivada na leitura · `aceita` (agente 01, 2026-11-15)
- **Contexto:** `normalize` do conector é puro (sem relógio) e grava `status = published`; `receiving_proposals`/`closed` dependem da data atual.
- **Decisão:** o campo `Opportunity.status` guarda só o que a fonte informa (`published`, `awarded`, `cancelled`, `suspended`, `unknown`). A situação efetiva para exibição e filtro é calculada na leitura por uma função única `effectiveStatus(opportunity, now)` (fuso America/Sao_Paulo): `published` com `proposalsCloseAt` futuro → `receiving_proposals`; passado → `closed`. Filtros de listagem usam a mesma regra em SQL.
- **Alternativa recusada:** job que atualiza o status (estado duplicado, atraso entre o job e o relógio, mais um writer em `opportunities`).
- **Impacto:** agente 02 implementa `effectiveStatus` e o filtro SQL em T-204; agente 04 só consome. Sem migration.

### ADR-019 — Contratos 1.2.0 (pedidos dos agentes 02 e 03) · `aceita` (agente 01, 2026-11-15)
- **Aceitos:** (1) `fitAssessmentResult` como schema do kind `fit_assessment`, em `src/contracts/fit.ts`, movido sem mudança de formato; (2) `nettCategory` como enum compartilhado; (3) `CompanyCapability.financialIndicators` (LC, LG, SG, patrimônio líquido, data-base) só para `financial_capacity`; (4) `CompanyCapability.subject` (`company` | `professional`), `professional` só em certificação/atestado; (5) interface do motor `fit_assessment` documentada à parte de `AnalysisEngine` (precisa de dados da empresa); (6) script `test:analysis` no `npm test` e no CI; (7) upserts e `documentRef` do agente 02 em `src/contracts`.
- **Compatibilidade:** mudança aditiva. Migration 0005 adiciona `subject` (padrão `company`) e `financial_indicators`, com checks no banco. Código dos agentes 02 e 03 reexporta dos contratos; único ajuste de fixture: `capability()` do agente 03 ganhou os dois campos novos.
- **`completeCapabilityKinds`** (opção de execução do agente 03) fica fora do banco, como ele propôs.

### ADR-020 — Fusão de oportunidades entre fontes · `aceita` (agente 01, 2026-11-16; evidência do agente 02 recebida)
- **Princípio:** a invariante 1 continua (uma Opportunity por `canonicalKey`). A fusão entre fontes só ocorre por **identificador determinístico**: o número de controle do PNCP (`numeroControlePNCP`, ou CNPJ + ano + sequencial). Fonte que traz esse identificador grava no mesmo `canonicalKey` `pncp:<cnpj>-<ano>-<seq>` (vários SourceRecords, uma Opportunity). **Sem correspondência aproximada** (título, órgão, data) na v1: erro de fusão mistura análises e decisões de empresas diferentes.
- **Fonte sem identificador PNCP** (se houver) vira Opportunity própria (`<sourceKey>:<id>`); uma ligação entre duas Opportunities só existirá depois de um contrato próprio e confirmação humana.
- **Evidência (agente 02, handoff 2026-11-16-agente-02-evidencia-fusao-fontes-adr-020.md):** Compras.gov.br traz `numeroControlePNCP` em 942 de 942 registros reais (16/11, 2 modalidades), coerente com CNPJ, ano e sequencial: a fusão é pelo mesmo `canonicalKey` `pncp:<cnpj>-<ano>-<seq>`, sem heurística. SIGA/RJ: desconhecido (sem acesso), **sem código** até haver evidência do identificador. Trello não é fonte de licitação: sem código até a responsável aprovar. Registro sem o identificador PNCP vira Opportunity própria (`<sourceKey>:<id>`).
- **Efeito:** T-205 (conector Compras.gov.br gravando no mesmo `canonicalKey`) liberada depois da T-213.
- **Integrações com dados de cliente** (ex.: Trello): usam credencial e dado de terceiros, então exigem aprovação da responsável antes de qualquer implementação (política Nett). Não iniciar integração com dado de cliente sem isso.

### ADR-021 — Fila `source.enrich` · `aceita` (agente 01, 2026-11-16, pedido do agente 02)
- **Problema:** o enriquecimento só era retentado quando o registro era relido (incremental ou backfill de ontem). Um registro que casou com perfil e falhou na fonte (ex.: PNCP 503) podia ficar sem itens e documentos para sempre.
- **Decisão:** fila `source.enrich` `{ sourceRecordId }` (dono 02, política padrão: 3 tentativas com backoff). Grava uma nova versão enriquecida do SourceRecord (a antiga nunca é alterada) e enfileira `source.normalize`. Idempotente por `singletonKey`. Contratos 1.3.0, aditiva.
- **Implementação:** do agente 02, em PR própria. Após retentativas esgotadas, registrar `AuditEvent` e manter a oportunidade só com a listagem (visível, marcada sem itens).
- **Deploy:** `npm run jobs:setup` é idempotente e cria a fila nova.

### ADR-022 — HttpError comum nas rotas /api/v1 · `aceita` (agente 01, 2026-11-16, pedido dos agentes 03 e 04)
- **Decisão:** `HttpError(code, status, message, details?)` em `src/server/http/errors.ts`, com atalhos `badRequest`, `notFound`, `conflict` e `unprocessable`, também exportados de `@/server/auth`. `AuthError` passa a ser um `HttpError`. `withApi` converte qualquer `HttpError` em `apiError` com o status indicado; erro desconhecido continua 500 sem detalhe.
- **Regras:** `details` só com dado seguro para o cliente. Recurso de outra empresa responde 404, não 403 (não revela existência). Rotas não criam wrapper de erro próprio.

### ADR-023 — Partição de propostas abertas do PNCP · `aceita` (agente 01, 2026-11-16, pedido do agente 02)
- **Problema:** o feed `/consulta/v1/contratacoes/atualizacao` traz compras ATUALIZADAS no dia, quase todas antigas e já homologadas (46 de 50 nos dados reais). O radar fica vazio.
- **Decisão:** segunda partição `proposals` no `PncpConnector`, sobre `/consulta/v1/contratacoes/proposta?dataFinal=` (T-213). Mantém o princípio "nada é descartado": grava o SourceRecord de TODO registro da listagem de propostas abertas, não só dos que casam com perfil. Assim um perfil novo casa na hora e a escrita em regime é pequena (listagem inalterada não grava versão). Ordem de grandeza: ~17 mil registros × ~3 KB ≈ 50 MB na 1ª varredura (modalidade 6). O enriquecimento (itens e documentos) continua só para quem casa com perfil, com orçamento por execução.
- **Limites do PNCP (obrigatórios, não sugestões):** ≥ 1 s entre requisições (`PNCP_MIN_INTERVAL_MS`), nunca retentar 429 (parar e retomar), cursor retomável, orçamento de páginas por execução, cadência de 6 h por modalidade (`SOURCE_PROPOSALS_CRON`), modalidades em sequência. Evasão de limite de terceiros é vedada pela política Nett.
- **Efeito em cadeia:** cada Opportunity nova dispara `match.score`; o handler (agente 03) descarta rápido o que nenhum SearchProfile ativo pode casar.
- **Retenção:** política de arquivamento de SourceRecords antigos fica para ADR futura quando o volume pedir.

### ADR-024 — Busca textual indexada de oportunidades · `aceita`, implementada pela variante do agente 02 (PR #22)
- **Problema:** `q` usa `ILIKE '%…%'` em `title`, `object_description` e `agency_name`: varredura completa com volume real.
- **Decisão:** tabela NÃO canônica `opportunity_search` (`opportunity_id` PK com `ON DELETE CASCADE`, `search_text`, `updated_at`) com índice GIN trigram (`pg_trgm`, extensão confiável; o papel migrator a cria). O `normalize` grava a linha na mesma transação. O texto é normalizado no app (minúsculas, sem acento) e o `q` é normalizado igual antes do `ILIKE` com `escapeLike`.
- **Por que não coluna em `opportunities`:** o teste de alinhamento exige colunas = campos do contrato (derivados não entram no contrato). Por que não `unaccent` no SQL: a função não é imutável, então não serve em índice de expressão sem wrapper.
- **Variante implementada (melhor que a proposta):** o agente 02 resolveu o ponto do `unaccent` com funções `IMMUTABLE` (`search_text`, `opportunity_search_text`) com dicionário qualificado e `search_path` fixo, e índices GIN trigram direto em `opportunities` (título, objeto, órgão, município) e `opportunity_items` (descrição), migration `0006`. Sem tabela extra e sem backfill; a consulta usa a mesma expressão do índice. A tabela `opportunity_search` NÃO será criada. Pré-requisito de produção: `pg_trgm` e `unaccent` no Postgres (contrib padrão).
- **Entrega original (T-215), superada pela variante:** migration gerada por drizzle-kit na PR do agente 02, revisada por mim; backfill das oportunidades já gravadas; teste com `EXPLAIN` mostrando uso do índice.

### ADR-025 — match.score: categoria persistida, frescor e fan-out de perfil · `aceita` (agente 01, 2026-11-16, pedido do agente 03)
- **Uma fórmula, entradas em níveis.** A nota de triagem (`MatchScore`, radar) e a avaliação detalhada (`fit_assessment`) usam a MESMA `scoreCommercial`. A triagem parte de título, objeto e itens; na T-302, `document.extract` enfileira `match.score` e o cálculo passa a usar também o texto público extraído (com limite), de modo que as duas convergem quando há documento. `opportunityContentHash` inclui o hash do texto usado, para a idempotência continuar valendo. A UI rotula "nota de triagem" e "avaliação detalhada".
- **`MatchScore.primaryCategory`** persistido (contrato 1.4.0, coluna `primary_category`, índice por empresa × categoria × nota): permite filtrar o radar por categoria em SQL. `getMatchSummaries` lê o valor gravado; o cálculo fica só como reserva para linhas antigas.
- **Frescor:** o prazo entra na nota, então há reavaliação diária. Fila `match.refresh` (dono 03, `{}`), agendada às 05:10 America/Sao_Paulo; enfileira `match.score` das oportunidades abertas com `proposalsCloseAt` entre agora − 1 dia e agora + 8 dias.
- **Fan-out de perfil:** fila `match.profile { searchProfileId }` (dono 03); percorre oportunidades abertas em lotes de 500 e enfileira `match.score { opportunityId, companyId }`. Quem enfileira é a API de SearchProfile (T-216).
- **Volume (ADR-023):** não persistir `MatchScore` quando as travas `no_term_match` ou `excluded_term` se aplicam (T-305b), para não gravar notas irrelevantes por perfil.

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

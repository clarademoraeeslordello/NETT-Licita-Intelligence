# CONTRACTS.md — contratos entre módulos

- Versão: **1.0.0-draft** · Status: **aguardando aprovação da responsável humana**
- Fonte da verdade executável: `src/contracts/*.ts` (Zod). Este documento explica; o código manda. Divergência entre os dois = bug do agente 01.
- Alteração: PR do agente 01 (ou proposta de outro agente via handoff) + atualização de `CONTRACTS_VERSION` + entrada em `DECISIONS.md` se quebrar compatibilidade.

## 1. Convenções

| Tema | Regra |
| --- | --- |
| Idioma | Código, tabelas, campos e enums em inglês. UI e documentação em pt-BR. |
| Nomes | TS `camelCase`; Postgres `snake_case` (mapeado no Drizzle). Tabelas no plural. |
| IDs | `uuid` (Postgres `gen_random_uuid()`). Chaves naturais ficam em colunas próprias com `unique`. |
| Datas | `timestamptz`; ISO 8601 com offset no contrato. Datas puras (`date`) só para validade/período. Fuso de negócio: `America/Sao_Paulo`. |
| Dinheiro | `numeric(18,4)` no banco; **string decimal** no contrato (`decimal`). Proibido `float`/`number` para valor monetário. |
| Tenant | Toda tabela de dado privado tem `company_id not null`. Dados públicos (Source, SourceRecord, Opportunity, OpportunityItem, Document público) não têm. |
| Soft delete | Não usar, exceto `OpportunityTracking.discardedAt`. Exclusão de dado pessoal segue política LGPD (pendente). |
| Auditoria | Escritas relevantes geram `AuditEvent` (agente 01 fornece `recordAudit()`). |

## 2. Entidades canônicas

Legenda: **W** = único módulo que escreve · **R** = quem lê.

| Entidade | Arquivo | Escopo | W | R |
| --- | --- | --- | --- | --- |
| `Source` | `sources.ts` | global | 02 | todos |
| `SourceRecord` | `sources.ts` | global, imutável | 02 | 02, 01 |
| `Opportunity` | `sources.ts` | global | 02 | todos |
| `OpportunityItem` | `sources.ts` | global | 02 | 03, 04 |
| `Document` | `documents.ts` | público ou por empresa | 02 (cria/armazena), 03 (`textStatus`, `pageCount`, `textStorageKey`) | todos |
| `AIAnalysis` | `analysis.ts` | público (`companyId` null) ou por empresa | 03 | 04, 01 |
| `HumanReview` | `analysis.ts` | por empresa, append-only | 03 (API) | todos |
| `MatchScore` (suporte) | `analysis.ts` | por empresa | 03 | 04 |
| `CompanyCapability` | `company.ts` | por empresa | 03 (API) | 03, 04 |
| `SearchProfile` | `company.ts` | por empresa | 03 (API) | 02 (filtro de fonte), 03, 04 |
| `OpportunityTracking` (suporte, pipeline) | `company.ts` | por empresa | 04 (API) | 04, 01 |
| `ConsultantMetric` | `metrics.ts` | por consultor (± empresa), derivado | 04 (job) | 04 |
| `Company`, `UserAccount`, `Membership` (suporte) | `tenancy.ts` | global / vínculo | 01 | todos |

### Invariantes que todo PR deve respeitar

1. **Opportunity é única por `canonicalKey`.** Mesma licitação vista em duas fontes → uma Opportunity, vários SourceRecords. Regra de fusão entre fontes diferentes: ADR futura (só PNCP no v1).
2. **SourceRecord é imutável.** Reprocessar = nova normalização, nunca `update` de `payload`.
3. **IA não decide.** `AIAnalysis.reviewStatus` só muda via `HumanReview`. `OpportunityTracking.stage >= proposal` exige `bidDecisionReviewId`.
4. **Evidência obrigatória.** Resultado `tender_summary` usa `found | inferred | not_found` com `quote` e `source` (página) — herdado de `src/lib/schema.ts`.
5. **Cache público seguro.** `AIAnalysis` com `companyId = null` não pode conter dado da empresa no prompt nem no resultado.
6. **Documento privado nunca em chave `public/`** do storage. URL assinada expira em ≤ 10 min e só é emitida após authz.
7. **ConsultantMetric é derivada**: recalcular período inteiro é sempre seguro (upsert pela chave única).

### Mapeamento LicitaFlow → contrato

| LicitaFlow | Contrato v1 |
| --- | --- |
| `Oportunidade` (`src/lib/pncp/types.ts`) | `Opportunity` (`id` → `canonicalKey = "pncp:" + id`) |
| `ItemCompra` + `ResultadoItem` | `OpportunityItem` |
| `ArquivoCompra` | `Document` (`origin = source`) |
| `AnalysisResult` / `Job` (memória) | `AIAnalysis` (Postgres) + fila `analysis.run` |
| `PerfilAderencia` / `Perfil` (localStorage) | `SearchProfile` + `Company` |
| `Aderencia` (cliente) | `MatchScore` (servidor) |
| `CardPipeline` (localStorage) | `OpportunityTracking` |
| `Documento` do cofre (localStorage) | `Document` com `kind = company_certificate` |
| cota `arremate.usos` | substituída por quotas por empresa (T-109) |

## 3. Filas (pg-boss) — `src/contracts/jobs.ts`

| Fila | Dono do handler | Payload | Enfileirada por |
| --- | --- | --- | --- |
| `source.sync` | 02 | `{ sourceKey, mode, since? }` | cron / admin |
| `source.normalize` | 02 | `{ sourceRecordId }` | `source.sync` |
| `document.fetch` | 02 | `{ documentId }` | `source.normalize`, upload |
| `document.extract` | 03 | `{ documentId }` | `document.fetch` |
| `analysis.run` | 03 | `{ analysisId }` | `POST …/analyses` |
| `match.score` | 03 | `{ opportunityId, companyId? }` | `source.normalize`, alteração de perfil |
| `metrics.compute` | 04 | `{ granularity, periodStart }` | cron diário |

Regras: payload só IDs; handler idempotente; `retryLimit 3` com backoff; `singletonKey` = payload serializado; nenhum handler chama outro diretamente — só enfileira. Nova fila = PR em `jobs.ts` aprovada pelo 01.

## 4. API HTTP `/api/v1`

Todas exigem sessão Keycloak, exceto `GET /api/health`. Rotas sob `/companies/{companyId}` passam por `requireCompanyAccess(session, companyId, minRole)`. Erros no formato `apiError`. Listagens com `pageOf` (cursor).

| Método e rota | Dono | Papel mínimo |
| --- | --- | --- |
| `GET /api/health` | 01 | público |
| `GET /api/v1/me` | 01 | autenticado |
| `GET /api/v1/companies` · `POST` (admin) | 01 | `nett_consultant` / `nett_admin` |
| `GET /api/v1/sources` · `POST /api/v1/sources/{key}/sync` | 02 | autenticado / `nett_admin` |
| `GET /api/v1/opportunities` · `GET /api/v1/opportunities/{id}` | 02 | autenticado |
| `GET /api/v1/opportunities/{id}/items` · `/documents` | 02 | autenticado |
| `GET /api/v1/prices?q=&ufs=` | 02 | autenticado |
| `POST /api/v1/companies/{cid}/documents` (upload) · `GET` | 02 | `consultant` |
| `GET /api/v1/documents/{id}/download` (URL assinada) | 02 | authz por escopo do documento |
| `POST /api/v1/companies/{cid}/analyses` · `GET …/analyses/{id}` | 03 | `consultant` |
| `POST /api/v1/companies/{cid}/reviews` | 03 | `consultant` |
| `GET/POST/PATCH /api/v1/companies/{cid}/search-profiles` | 03 | `consultant` |
| `GET/POST/PATCH /api/v1/companies/{cid}/capabilities` | 03 | `consultant` |
| `GET /api/v1/companies/{cid}/radar` (Opportunity + MatchScore) | 03 | `viewer` |
| `GET/POST/PATCH /api/v1/companies/{cid}/pipeline` | 04 | `consultant` |
| `GET /api/v1/metrics/consultants` | 04 | `nett_consultant` (próprias) / `nett_admin` (todas) |

DTOs de request/response ficam em `src/contracts/api/*.ts` — criados pelo dono da rota **no mesmo PR**, revisados pelo 01. Rotas legadas do LicitaFlow (`/api/analyze`, `/api/radar`, `/api/precos`, `/api/pncp/*`, `/api/jobs/*`, `/api/cota`) serão removidas ao fim de F4.

## 5. Interfaces de serviço (TypeScript)

```ts
// src/server/sources/connector.ts — agente 02
export interface SourceConnector {
  key: string;                                   // = Source.key
  fetchPage(cursor: unknown | null): Promise<{ records: Array<{ externalId: string; payload: unknown }>; nextCursor: unknown | null }>;
  normalize(payload: unknown): { opportunity: OpportunityUpsert; items: OpportunityItemUpsert[]; documents: DocumentRef[] } | { skip: string };
}

// src/server/analysis/engine.ts — agente 03
export interface AnalysisEngine {
  id: 'llm' | 'local_rules';
  analyze(input: { kind: AnalysisKind; pages: Array<{ page: number; text: string }>; budget: { maxMs: number; maxTokens: number } }):
    Promise<{ result: unknown; confidence: 'high' | 'medium' | 'low'; warnings: string[]; usage: { tokensIn: number; tokensOut: number; costUsd: string } }>;
}

// src/server/storage/index.ts — agente 02
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<{ sha256: string; sizeBytes: number }>;
  get(key: string): Promise<Uint8Array>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;   // ttl ≤ 600
}

// src/server/auth/guard.ts — agente 01
export function requireSession(): Promise<Session>;
export function requireCompanyAccess(session: Session, companyId: string, minRole: CompanyRole): Promise<void>;

// src/server/jobs/enqueue.ts — agente 02
export function enqueue<N extends JobName>(name: N, payload: JobPayload<N>): Promise<string>;
```

`*Upsert`/`DocumentRef` são derivados com `.omit()` dos schemas canônicos no PR de T-201.

## 6. Identidade visual (contrato de UI)

Somente estas 8 cores. Proibido hex/rgb/hsl fora desta lista em CSS, TSX, SVG, gráficos, PDFs e e-mails. Opacidade sobre essas cores é permitida (`/ 0.x`).

| Token Tailwind (`@theme`) | Hex | Uso | Contraste sobre `#050505` |
| --- | --- | --- | --- |
| `--color-nett-black` | `#050505` | fundo da aplicação | — |
| `--color-nett-surface` | `#0D0D0D` | cartões, painéis | — |
| `--color-nett-raised` | `#111111` | elementos elevados, inputs | — |
| `--color-nett-gold` | `#C9A227` | ação primária, destaque, foco | 8.43 : 1 |
| `--color-nett-gold-light` | `#F0D375` | hover, estado crítico/alerta (com ícone + texto) | 13.86 : 1 |
| `--color-nett-gold-dark` | `#8A6D1A` | bordas, divisores, decorativo | 4.16 : 1 — **não usar para texto < 18,66 px bold / 24 px** |
| `--color-nett-text` | `#ECECEC` | texto principal | 17.25 : 1 |
| `--color-nett-text-muted` | `#AFAFAF` | texto secundário | 9.29 : 1 |

Estados (erro/alerta/sucesso) não ganham cores novas: usam ícone + rótulo textual + peso/borda (ADR-009). Gráficos: tons de dourado + padrões/rotulagem direta. O tema de login do Keycloak deve seguir a mesma paleta (T-104).

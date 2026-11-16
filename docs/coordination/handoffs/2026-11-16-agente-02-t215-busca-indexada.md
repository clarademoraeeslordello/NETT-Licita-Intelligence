# entrega: T-215 busca textual indexada (ADR-024) + HttpError nas rotas (ADR-022)

- De: agente 02 · Para: agente 01 (revisão e merge) · cc: agente 04 · Data: 2026-11-16
- Tarefa(s): T-215 · Branch: `agente-02/ingestao` (integrada com `main` 37cadad)
- Banco: **migration nova `db/migrations/0006_opportunity_search.sql`** (gerada por drizzle-kit; criei `pg_trgm` no início, à mão) + tabela `opportunity_search` em `src/server/db/schema.ts` — **revisar**.
- Contratos tocados: nenhum (`src/contracts/api/opportunities.ts`: `q` agora exige 3+ caracteres).

## O que foi feito
**Tabela não canônica `opportunity_search`** (ADR-024): `opportunity_id` PK com `ON DELETE CASCADE`, `search_text`, `updated_at`; índice GIN `opportunity_search_trgm_idx` (`gin_trgm_ops`). Nenhuma coluna nova em `opportunities` (`test:contracts` 28/28).
- **Escrita**: `source.normalize` grava/atualiza a linha **na mesma transação** da oportunidade (`upsertSearchText`, só regrava se o texto mudou).
- **Texto** (`src/server/sources/read/search-index.ts`): título + objeto + órgão + unidade + município, em minúsculas e sem acento, normalizado **no app** (NFD), limitado a 20 mil caracteres. Sem `unaccent` no SQL.
- **Consulta**: `q` passa pela mesma normalização; todas as palavras (até 8) precisam aparecer, em qualquer ordem; `LIKE '%…%'` com `escapeLike` sobre `search_text` (subconsulta por `opportunity_id`). Mínimo de 3 caracteres.
- **Backfill**: `npm run search:backfill` (só oportunidades sem linha) ou `-- --rebuild` (recalcula todas, após mudar a normalização). Idempotente, retomável, em lotes. `missingSearchRows()` mede a cobertura.
- **ADR-022**: rotas sem wrapper de erro próprio (`HttpError`: `badRequest`/`notFound`/`conflict`); cursor inválido = `InvalidCursor` (HttpError 400); fonte desabilitada = 409 `CONFLICT`.
- **`/prices`**: a busca por descrição do item usa `ILIKE` literal por palavra (sem acento/índice) — o conjunto já é restrito a itens com resultado homologado e só ganha volume com T-214; indexar lá.

## Evidências (local, PostgreSQL 16, 2026-11-16)
```
npx tsc --noEmit                    → ok
drizzle-kit generate                → "No schema changes, nothing to migrate"
migration do zero (bootstrap + 7 migrations) → ok; pg_trgm criada pelo migrator; índice e PK presentes
npm run test:contracts              → pass 28 / fail 0
npm run test:auth / test:http       → 5/5 · 5/5
npm run test:analysis / :integration → 28/28 · 10/10
npm run test:ui                     → 5/5
npm run test:db                     → 10/10
npm run test:jobs / test:storage    → 5/5 · 4/4
npm run test:sources                → 7/7
npm run test:sources:integration    → pass 12 / fail 0
  ok normalize grava o texto de busca (sem acento, minúsculas) na mesma transação
  ok texto acompanha a oportunidade: objeto novo entra, antigo sai, busca com acento/caixa acha o novo
  ok atomicidade: pg-boss falha → nem oportunidade nem texto de busca; retentativa conclui
npm run test:read                   → pass 7 / fail 0 (inclui normalização do texto e das palavras da consulta)
npm run test:read:integration       → pass 11 / fail 0 (2x)
  ok EXPLAIN (seqscan e indexscan desligados) → Bitmap Index Scan on opportunity_search_trgm_idx
  ok backfill idempotente/retomável (lote 1), rebuild recalcula, cobertura = 0 faltando
npm test                            → exit 0
HTTP ponta a ponta (next dev + sessão real + dados reais do PNCP): q=contratacao e q=CONTRATAÇÃO → mesmos resultados;
  q="municipio sao" → São Miguel Arcanjo, São José do Belmonte; inexistente → 0
```

**Medição com volume (40 mil oportunidades sintéticas, banco descartável, `ANALYZE`, planejador sem `enable_*` forçado)** — tabela 45 MB; `opportunity_search` 35 MB + índice GIN 18 MB:
| Consulta (rota real, `listOpportunities`) | Nova | Antiga (`ILIKE` direto) |
| --- | --- | --- |
| palavra rara (nº do edital) | **6,0 ms** (Bitmap Index Scan no GIN) | 325 ms (Seq Scan) |
| inexistente + palavra comum | **3,4 ms** | 325 ms |
| palavra comum (`material`) | 50,8 ms | 354 ms |
| 2 palavras (software + gestão) | 41,3 ms | 355 ms |
| `AQUISIÇÃO` (acento/caixa) | 84,6 ms | — |
| sem busca (listagem) | 56,7 ms | — |
Com palavras muito comuns o planejador escolhe varrer `opportunity_search` e encerra cedo pelo `LIMIT`; com palavra seletiva usa o GIN.

## Pontos de atenção
1. **A listagem sem busca custa ~57 ms a 40 mil linhas**: ordena por `coalesce(published_at,'epoch'), id` sem índice. Com a partição de propostas abertas (T-213, ~17 mil por modalidade) fica na mesma ordem; proponho, se virar problema, um índice de expressão `(coalesce(published_at,'epoch'::timestamptz) desc, id desc)` — migration sua/minha após medir.
2. **Tamanho**: `opportunity_search` ≈ 78% do tamanho da tabela de oportunidades + GIN ≈ 40%. Aceitável; o limite de 20 mil caracteres por texto contém objetos gigantes.
3. **Backfill obrigatório no deploy**: oportunidades gravadas antes desta migration só aparecem em buscas com `q` depois de `npm run search:backfill` (sem `q` aparecem normalmente). Sugiro rodar no deploy logo após `db:migrate`.
4. Em produção o `migrator` precisa poder criar `pg_trgm` (extensão confiável no PostgreSQL ≥ 13).

## Impacto em outros módulos
- Agente 04: `q` exige 3+ caracteres; passa a buscar também por município e unidade; sem acento/caixa.
- Nenhuma mudança de contrato nas respostas.

## Próximo passo esperado
- Agente 01: revisar/mesclar; decidir o item 1.
- Agente 02: T-213 (partição de propostas abertas, ADR-023), depois T-203 e T-211.

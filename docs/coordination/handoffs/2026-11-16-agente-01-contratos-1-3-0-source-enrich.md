# resposta: decisões pedidas pelo agente 02 — contratos 1.3.0 (`source.enrich`), ADR-020 e T-204

- De: agente 01 · Para: agente 02 (cc 03 e 04) · Data: 2026-11-16
- Decisões: ADR-021 (aceita), ADR-020 (proposta) · Contratos: 1.2.0 → **1.3.0** (aditiva)

## Decisões
1. **`source.enrich` aceita** (T-211, dono 02). Fila `{ sourceRecordId }`, política padrão. O handler grava uma NOVA versão enriquecida do SourceRecord e enfileira `source.normalize`. Após as tentativas esgotadas: `AuditEvent` e a oportunidade fica só com a listagem. Implemente em PR própria depois da #15. Já está em `src/contracts/jobs.ts`; o `jobs:setup` cria a fila (idempotente).
2. **Fusão entre fontes (ADR-020, proposta):** só por identificador determinístico (número de controle do PNCP); sem correspondência aproximada. Traga, por fonte candidata, se o payload tem esse identificador. Integrações com dado ou credencial de cliente (Trello) precisam de aprovação da responsável antes de qualquer código. T-205 a T-210 seguem bloqueadas até lá.
3. **T-204:** DTOs em `src/contracts/api/*` no mesmo PR, revisados por mim (CONTRACTS §4).
   - Filtros mínimos de `/api/v1/opportunities`: `q` (objeto, título, órgão, município), `uf[]`, `modalityCode[]`, `status` (efetivo, ADR-018), `minValue`, `maxValue`, `closesFrom`, `closesTo`, `sourceKey`; ordenação por `proposalsCloseAt` ou `publishedAt`; paginação por cursor (`pageOf`), limite máximo 100.
   - Esta rota é global (sem empresa). A nota de aderência por empresa é `GET /companies/{cid}/radar` (agente 03, T-305).
   - Busca textual: índice (sem varredura completa). Se precisar de `unaccent` ou índice GIN, a migration vai na sua PR e eu reviso.

## Evidências (local, PostgreSQL 16 novo)
```
tsc ok · test:contracts 28/28 (novo: source.enrich) · jobs:setup ×2 ok (fila source.enrich criada)
test:jobs 5/5 · test:db 10/10 · test:http 5/5
```

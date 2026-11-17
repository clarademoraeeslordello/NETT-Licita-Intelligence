# entrega e pedido de merge: T-216 API de SearchProfile e CompanyCapability (guarda "sem perfil ativo")

- De: agente 03 · Para: agente 01 (revisão e merge) · Data: 2026-11-17
- Tarefa(s): T-216 · Branch: `agente-03/t305-match-score` (a `main` 8c249ef entrou por fast-forward: a branch já a continha, sem merge commit, sem rebase, sem force-push) · PR: a abrir pelo 01
- Contratos tocados: **nenhum**. Não alterei `src/contracts`, `.github`, `package.json` nem `docs/coordination/*.md` (quadro e CONTRACTS são seus).

## O que foi feito
Rotas (`CONTRACTS §4`; GET = `viewer`, POST/PATCH = `consultant`, autorização por empresa via `requireCompanyAccess`, `withApi` cuida de origem e erro):

| Rota | Métodos |
| --- | --- |
| `/api/v1/companies/{cid}/search-profiles` | GET (lista, cursor, `?active=`), POST |
| `/api/v1/companies/{cid}/search-profiles/{id}` | GET, PATCH |
| `/api/v1/companies/{cid}/capabilities` | GET (lista, cursor, `?active=`), POST |
| `/api/v1/companies/{cid}/capabilities/{id}` | GET, PATCH |

Código: `src/server/profiles/` (`dto.ts`, `service.ts`, `handlers.ts`, `wiring.ts`) e as 4 `route.ts` em `src/app/api/v1/companies/[companyId]/`.

- **Guarda "sem perfil ativo"** (`reprocessDecision`, pura): `match.profile` só é enfileirado quando o perfil resultante está **ativo**, a empresa está **ativa** e houve criação, reativação ou mudança em campo que afeta o match (`includeTerms`, `excludeTerms`, `ufs`, `modalityCodes`, `minValue`, `maxValue`, `sourceKeys`). Criar inativo, desativar (mesmo mudando termos na mesma chamada), empresa suspensa e edição só de `name`/`minScore`/`alertChannel` **não** enfileiram. Termos são comparados como o casamento os vê (`tokens`: sem caixa, sem acento, radical), ordem de listas não conta, decimais por valor (`"1000"` = `"1000.0000"`). PATCH sem mudança real não grava, não audita e não mexe em `updated_at` (não invalida notas já calculadas).
- A resposta traz `{ profile, reprocess }`, com `reprocess` ∈ `queued | skipped_inactive_profile | skipped_inactive_company | skipped_unchanged | failed`.
- Desativar um perfil não apaga notas: `getMatchSummaries` (e o radar da T-217) só leem perfis ativos. No worker, `fanOutProfile` já devolve 0 para perfil inativo (coberto por teste).
- Segurança: `companyId` vem só do caminho e `ownerUserId` é o usuário da sessão (ambos recusados no corpo, `.strict()`); id de outra empresa = 404; corpo ≤ 100 KB; termos até 50 por lista, 80 caracteres; `sourceKeys` por regex; `evidenceDocumentId` precisa ser documento **da mesma empresa** (422). Auditoria na mesma transação (`search_profile.created/updated`, `capability.created/updated`) com só contagens e nomes de campo, sem termos. Regras de `companyCapability` (contrato 1.2.0) reaplicadas no PATCH depois do merge com o estado gravado.

## Evidências (local; Node v26.13.1, PostgreSQL 16.16 descartável, papel `nett_app`, banco migrado + `jobs:setup`)
```
npx tsc --noEmit                                   → exit 0
npm test                                           → exit 0
npm run build                                      → Compiled successfully; as 4 rotas novas aparecem
npx tsx --test src/server/profiles/profiles.test.ts          → tests 13 · pass 13 · fail 0   (sem banco)
npx tsx --test src/server/profiles/profiles.integration.ts   → tests 17 · pass 17 · fail 0   (2 execuções seguidas)
test:db 10/10 · test:http:integration 3/3 · test:jobs 5/5 · test:analysis:integration 28/28 · test:sources:integration 12/12 · test:read:integration 12/12
```
Cobertura da integração (handlers com `authorizeCompany` real sobre `memberships`): viewer lê e não escreve; quem não é da empresa recebe 403 e nada é gravado; perfil criado inativo não enfileira; empresa suspensa (acesso `nett_admin`) cria sem enfileirar; PATCH só de nome/nota/canal não enfileira; desativar+mudar termos não enfileira e o `fanOutProfile` devolve 0; reativar enfileira e o fan-out enfileira a oportunidade aberta para a empresa certa; ponta a ponta perfil → `scoreOpportunity` → nota visível → desativar tudo → `getMatchSummaries` vazio e `match.score` sem gravar; faixa de valores invertida pelo merge → 422 sem alterar a linha; 404 entre empresas (GET e PATCH); falha da fila → perfil mantido, `reprocess: 'failed'` e auditoria `search_profile.reprocess_failed`; paginação por cursor sem repetir/pular e cursor inválido → 422; capacidades: criar/ler/listar/alterar, `financialIndicators` e `subject` no PATCH, evidência de outra empresa, isolamento.

Mutações (cada uma reprova ao menos um teste, depois restaurei o arquivo): sem a guarda de perfil inativo (unit 1 + integração 3), sem a guarda de empresa inativa (1 + 1), sempre reprocessar (1 + 2), sem filtro de empresa no GET (integração 1), sem checagem do documento de evidência (integração 1).

Limpeza: contagem de perfis, capacidades e fontes **idêntica antes e depois** da minha suíte (0 perfis ativos deixados), nas duas execuções. Resíduo: empresas, usuários e vínculos, porque `audit_events` é somente inclusão e os referencia (mesma regra do `reviews.integration`).

Nota de ambiente (não é bug do repositório): o PostgreSQL de Windows em pt-BR responde "permissão negada", e `test:db` (3) e `test:http:integration` (1) e `reviews.integration` (1) comparam com "permission denied". Rodei com `alter database … set lc_messages='C'` no banco descartável; no CI (imagem em inglês) isso não ocorre.

## Pedidos ao agente 01
1. **`package.json`**: incluir os dois arquivos novos nos scripts (não tenho permissão): em `test:analysis` acrescentar `"src/server/profiles/**/*.test.ts"` e em `test:analysis:integration` acrescentar `src/server/profiles/profiles.integration.ts` (o CI já executa esse script). Sem isso, `npm test` não roda os 13 testes sem banco nem o CI roda os 17 de integração.
2. **DTOs**: pelo `CONTRACTS §4` os DTOs ficam em `src/contracts/api/`, mas não escrevo lá; deixei em `src/server/profiles/dto.ts` (Zod, `.strict()`). Se quiser movê-los para `src/contracts/api/search-profiles.ts`/`capabilities.ts`, só trocar o import; o comportamento não muda.
3. **Quadro**: T-216 → `em revisão`; ao mesclar, `concluída` e liberar T-217.

## Impacto em outros módulos
Nenhum arquivo de outro agente alterado. Agente 04: o contrato de resposta é `{ profile, reprocess }` no POST/PATCH de perfil; as listas são `{ items, nextCursor }`. Agente 02: nenhum.

## Pendências e riscos
- **Enfileiramento depois do commit, não transacional** (o `enqueue` usa pool próprio do pg-boss): se a fila cair entre o commit e o `send`, o perfil fica gravado sem reprocesso e a resposta diz `failed` (auditado). Não há reenvio automático: `match.refresh` só reavalia oportunidades perto do prazo. Se quiser, faço uma rota/ação de "reprocessar perfil" ou o outbox transacional (`enqueue(..., { tx })`), mas isso pede acesso ao cliente `pg` da transação (área do 01: `src/server/db`).
- `sourceKeys` não é validado contra a tabela `sources` (fonte sem linha ainda é válida até a 1ª sincronização): uma chave com erro de digitação cria um perfil que nunca casa.
- Limites por empresa (número de perfis/capacidades) não foram definidos; só limites por requisição. Diga se quer um teto.

## Próximo passo esperado
- Agente 01: item 1 (scripts), revisão, PR e merge; quadro.
- Agente 03 (depois do merge): T-217 `GET /companies/{cid}/radar`.

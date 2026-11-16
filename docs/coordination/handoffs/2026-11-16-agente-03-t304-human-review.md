# entrega + pedido: T-304 API de HumanReview e regras de reviewStatus

- De: agente 03 · Para: agente 01 (revisão, merge) e agente 04 (consumo) · Data: 2026-11-16
- Tarefa: T-304 · PR: o agente 01 abre a partir da branch · Branch: `agente-03/ia`
- Contratos tocados: `src/contracts/api/reviews.ts` (novo, DTOs da rota, CONTRACTS §4); `src/contracts/index.ts` intocado

## O que foi feito
- `GET /api/v1/companies/{companyId}/reviews?subjectType=&subjectId=&limit=&cursor=` (papel `viewer`): pareceres da empresa para um assunto, mais recentes primeiro, paginação por cursor (`pageOf`) sobre `(created_at, id)` usando o timestamp textual do banco (preserva microssegundos). Só devolve pareceres da própria empresa.
- `POST /api/v1/companies/{companyId}/reviews` (`src/app/api/v1/companies/[companyId]/reviews/route.ts`): papel mínimo `consultant`, `withApi` (origem + limite), corpo validado por Zod `.strict()` e limitado a 200 KB. **O revisor é o usuário da sessão e a empresa vem do caminho; nenhum dos dois é aceito no corpo.**
- `src/server/analysis/reviews/handlers.ts`: handlers com dependências injetadas (sessão, autorização, banco); `route.ts` só liga os reais e envolve em `withApi`. É o que permite testar a rota sem cookies do Next.
- `src/server/analysis/reviews/service.ts` — `createReview()`: HumanReview, atualização de `AIAnalysis.reviewStatus` e `recordAudit('review.created')` na **mesma transação**; a linha da análise fica travada com `FOR UPDATE`, então reviews concorrentes se serializam.
- `effectiveReviewStatus()` (status por empresa) e `assertBidDecisionAuthorizes()` (portão para a API de pipeline do agente 04).
- Regras de status: `approved → approved`, `approved_with_changes → approved_with_changes`, `rejected → rejected`; o parecer mais recente vale. `pending_review` só enquanto não houver parecer; `superseded` não é revisável.
- A IA nunca escreve `reviewStatus`; auditoria sem comentário nem valores das correções (podem conter dado pessoal).

## Decisões (aceitas pelo agente 01 em 2026-11-16)
1. `bid_decision.subjectId` = id da `Opportunity`; vale o parecer mais recente por empresa × oportunidade.
2. Análise pública (`companyId` null): grava só o HumanReview da empresa e NÃO altera `ai_analyses.reviewStatus` da linha compartilhada; status por empresa via `effectiveReviewStatus()`. Análise privada de outra empresa → 404.
3. `corrections` e `approved_with_changes` só para `ai_analysis`, com `previous` igual ao valor atual (422).
4. `assertBidDecisionAuthorizes` é a implementação canônica da regra; o agente 04 migra a regra da T-406 para ela depois do merge.
5. DTO movido para `src/contracts/api/reviews.ts` (import por `@/contracts/api/reviews`).
6. Script `test:analysis:integration` no `package.json`; o passo no CI fica com o agente 01 depois do merge. Os arquivos de integração se chamam `*.integration.ts`, **fora do glob** `*.test.ts` do `test:analysis` (que roda sem banco).

## Evidências (local, PostgreSQL 16 descartável, papel `nett_app`)
```
npx tsc --noEmit                         → sem erros
npm test                                 → exit 0 (unit 59 · contracts 27 · auth 4 · http 5 · analysis 28 · ui 5 · routes 16 · css ok)
npm run test:analysis:integration        → tests 10 · pass 10 · fail 0
npm run test:db                          → pass 10 · fail 0
npm run test:http:integration            → pass 3 · fail 0
```
- Mutação 1: remover o isolamento por empresa de `createReview` quebra o teste 4. Mutação 2: remover o filtro de empresa de `listReviews` quebra o teste 10. Restaurado: 10/10.
- A rota é coberta chamando os handlers exportados: **401** sem sessão, **403** de outra empresa (com `authz.denied` auditado), **403** de leitor no POST, **403** de `companyId` inválido, **422** de corpo inválido (sem gravar), **400** JSON quebrado, **413** corpo gigante, **201** com revisor vindo da sessão; GET: leitor lista, paginação sem repetição e isolamento.
- Defeito achado pelo teste e corrigido: um cursor inválido só era rejeitado depois de abrir a conexão com o banco; agora é validado antes.

## Pendências e riscos
- O `withApi` ainda mapeia só `AuthError`: os erros 404/409/422/413 saem do handler como resposta. Quando o `HttpError` comum do agente 01 entrar, dá para simplificar `handlers.ts`.
- `withApi` (origem, limite) não é exercitado nos testes (precisa de config de auth); os handlers são.
- Papéis de empresa: `consultant` e `company_admin` revisam; `viewer` recebe 403.

## Próximo passo esperado
- Agente 01: abrir a PR a partir de `agente-03/ia`, revisar e mesclar.
- Agente 03: T-305 (`match.score` reaproveitando `scoreCommercial`, com `getMatchSummaries` para os cards do pipeline).

# entrega + pedido: T-304 API de HumanReview e regras de reviewStatus

- De: agente 03 · Para: agente 01 (revisão, merge) e agente 04 (consumo) · Data: 2026-11-16
- Tarefa: T-304 · PR: a abrir (pedido de merge ao agente 01 com esta evidência) · Branch: `agente-03/ia`
- Contratos tocados: nenhum (`src/contracts` intocado)

## O que foi feito
- `POST /api/v1/companies/{companyId}/reviews` (`src/app/api/v1/companies/[companyId]/reviews/route.ts`): papel mínimo `consultant`, `withApi` (origem + limite), corpo validado por Zod `.strict()` e limitado a 200 KB. **O revisor é o usuário da sessão e a empresa vem do caminho; nenhum dos dois é aceito no corpo.**
- `src/server/analysis/reviews/service.ts` — `createReview()`: HumanReview, atualização de `AIAnalysis.reviewStatus` e `recordAudit('review.created')` na **mesma transação**; a linha da análise fica travada com `FOR UPDATE`, então reviews concorrentes se serializam.
- `effectiveReviewStatus()` (status por empresa) e `assertBidDecisionAuthorizes()` (portão para a API de pipeline do agente 04).
- Regras de status: `approved → approved`, `approved_with_changes → approved_with_changes`, `rejected → rejected`; o parecer mais recente vale. `pending_review` só enquanto não houver parecer; `superseded` não é revisável.
- A IA nunca escreve `reviewStatus`; auditoria sem comentário nem valores das correções (podem conter dado pessoal).

## Decisões que precisam da sua validação (implementadas assim; mudo se discordar)
1. `bid_decision.subjectId` = id da `Opportunity` (o contrato não define). O parecer mais recente por empresa × oportunidade vale.
2. **Análise pública** (`companyId` null) é compartilhada: o HumanReview da empresa é gravado, mas o `reviewStatus` da linha compartilhada **não muda** (não vaza decisão entre empresas). O status por empresa vem de `effectiveReviewStatus()`. Análise privada de outra empresa responde 404.
3. `corrections` e `approved_with_changes` só valem para `ai_analysis`. `previous` precisa ser igual ao valor atual do resultado no caminho informado; caminho inexistente, repetido ou sem mudança → 422.
4. `assertBidDecisionAuthorizes(db, { companyId, opportunityId, reviewId })`: o agente 04 deve chamá-la antes de mover um tracking para `proposal` ou além. Vale parecer `bid_decision` aprovado, da empresa, da oportunidade, sem rejeição posterior. O banco já impede `stage >= proposal` sem `bidDecisionReviewId`.
5. CONTRACTS §4 pede o DTO em `src/contracts/api/*.ts`. Deixei em `src/server/analysis/reviews/dto.ts` para respeitar "não altere `src/contracts` sem handoff". Mover na PR ou você move?
6. Adicionei `test:analysis:integration` ao `package.json` (config raiz). Precisa de um passo no CI (`.github/`) após `db:migrate`: sua área.

## Evidências (local, PostgreSQL 16 descartável, papel `nett_app`)
```
npx tsc --noEmit                         → sem erros
npm test                                 → exit 0 (unit 59 · contracts 27 · auth 4 · http 5 · analysis 23 · ui 5 · routes 16 · css ok)
npm run test:analysis:integration        → tests 8 · pass 8 · fail 0
npm run test:db                          → pass 10 · fail 0
npm run test:http:integration            → pass 3 · fail 0
```
Teste de mutação: remover o isolamento por empresa de `createReview` faz o teste 4 falhar (7 pass / 1 fail); restaurado, 8/8.
Cobertura dos testes: aprovação com auditoria na mesma transação, parecer mais recente, append-only (UPDATE/DELETE negados), correções inválidas sem efeito colateral, isolamento entre empresas, análise pública por empresa, análise não concluída ou substituída, concorrência, `assertBidDecisionAuthorizes` e o check do banco no pipeline.

## Pendências e riscos
- **A rota HTTP não tem teste automatizado** (depende de sessão e cookies do Next); a lógica está toda em `service.ts`, testada. Um teste de rota fica para quando houver harness de sessão.
- Não há `GET` de revisões: a T-405 (agente 04) vai precisar listar as revisões de uma análise. Posso incluir na mesma PR se você quiser.
- Papéis de empresa: `consultant` e `company_admin` revisam; `viewer` recebe 403.

## Próximo passo esperado
- Agente 01: respostas às decisões 1–6 e revisão da PR.
- Agente 03: T-305 (`match.score` reaproveitando `scoreCommercial`).

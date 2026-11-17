# feat: T-405 (tela de revisão humana) e T-406 (pipeline persistido + cofre de certidões, só metadados)

- De: agente 04 · Para: agente 01 (revisão e merge) · Data: 2026-11-17
- Tarefa(s): T-405, T-406 · Branch: `agente-04/frontend` (main `8c249ef` integrada por merge, sem rebase)
- Contratos tocados: nenhum (`src/contracts` e `.github` intactos). DTOs novos ficaram em `src/server/pipeline/dto.ts` (ver pedido 1).

## O que foi feito

**T-406 — API (`src/server/pipeline`, rotas em `src/app/api/v1/companies/[companyId]/`)**
- `GET/POST …/pipeline`, `PATCH …/pipeline/{id}`: `OpportunityTracking` persistido. Listagem traz a oportunidade, o parecer de decisão mais recente da empresa e a análise concluída mais recente visível a ela.
- `GET/POST …/certificates`, `PATCH …/certificates/{id}`: `Document(kind = company_certificate)`. Grava só `kind`, `title`, `origin = upload`, `mimeType = application/octet-stream` e o bloco `certificate`. Nunca `storageKey`, `sha256` nem tamanho; a chave do objeto não sai na resposta (`hasFile`).
- Todas pelo `withApi`, com `HttpError` (ADR-022). Leitura exige `viewer`; escrita, `consultant`. Empresa vem do caminho e usuário da sessão; corpo com campo extra → 422. Item de outra empresa → 404. O papel é conferido antes de ler o corpo e a validação roda antes de tocar o banco.
- Regra de etapa: entrar em `proposal`, `dispute` ou `result` exige `bidDecisionReviewId`, conferido por `assertBidDecisionAuthorizes` (a mesma implementação do agente 03, não duplicada). A regra vale na entrada da etapa ou ao trocar o parecer; editar nota depois não a reabre. Sair de `result` limpa o resultado, e resultado só existe em `result`. Responsável precisa ter vínculo com a empresa.
- Auditoria na mesma transação: `pipeline.created|reopened|stage_changed|discarded|updated`, `document.certificate_created|updated`. Sem notas nem valores nos metadados.
- Descartar usa `discardedAt`; adicionar de novo uma oportunidade descartada a reabre na triagem.

**T-406 — telas**
- `/pipeline` lê e grava pela API (kanban com arrastar, gaveta de detalhe, KPIs). Busca de oportunidade pela API da T-204 para adicionar. Quando o servidor recusa, a tela mostra o motivo. A UI antecipa a regra (`podeMover`), mas o servidor é a autoridade.
- `/documentos` virou "Cofre de certidões" pela API: situação e prontidão por validade (dia em Brasília), "Renovei" (emissão hoje + validade usual), formulário de metadados. Informa que o arquivo ainda não é enviado.
- `DecisaoParticipacaoForm`: parecer `bid_decision` (participar ou não, `subjectId` = id da oportunidade) pela API de reviews da T-304. Usado na gaveta do pipeline e na revisão.
- Dinheiro: string decimal no contrato; soma em centavos inteiros (BigInt); entrada pt-BR convertida em `paraDecimal`.
- Selos de contagem do menu (Pipeline e Documentos) removidos: vinham do `localStorage`.

**T-405 — `/revisao/{analysisId}`**
- Página no servidor: empresa ativa da sessão, análise pública ou da própria empresa (outra → 404), resultado validado por `parseAnalysisResult`, situação por `effectiveReviewStatus`, histórico por `listReviews`.
- `tender_summary`: resumo, campos com evidência (status, trecho, página, motivo da inferência), pontos de atenção e limitações. Cada campo com `value` tem "Corrigir", que gera `{path, previous, corrected, note}`.
- `fit_assessment`: parecer preliminar marcado como "não é decisão", notas, requisitos, riscos, pendências, evidências e alerta de instrução embutida.
- Decisão: Aprovar / Aprovar com N ajustes / Rejeitar, que vira `approved`, `approved_with_changes` ou `rejected`. Rejeitar exige comentário e descarta as correções. `risk_review` fica só leitura (sem formato no contrato).

## Evidências

```
npm test            → EXIT 0 (typecheck ok; test:analysis pass 41; test:read pass 7; test:pipeline pass 11;
                      test:ui pass 26; test:routes ok; test:css "só paleta oficial")
npx next build      → EXIT 0 (rotas novas: /revisao/[id], /pipeline, 4 rotas /api/v1/companies/[companyId]/{pipeline,certificates})
```
Os testes novos exercitam DTOs, handlers (401, 403, 400, 413, 422, 404 sem tocar o banco) e a lógica pura de UI: `podeMover`, dinheiro, validade do cofre, `blocosEvidencia`, `montarCorrecao`, e o corpo de revisão aprovado pelo `reviewInput` do servidor. Um teste confere que todo caminho de correção oferecido existe segundo o `resolvePath` do 03.

**NÃO verificado (sem Postgres, Keycloak nem Docker nesta máquina)**
- `src/server/pipeline/pipeline.integration.ts` está escrito e compila, mas **não foi executado**. Cobre isolamento por empresa, regra do parecer (aprovado, rejeitado, revogado depois, de outra oportunidade), resultado, vínculo do responsável, auditoria e o cofre sem campos de arquivo. Rodar: `npm run test:pipeline:integration` com `DATABASE_URL_TEST`.
- As telas **não foram abertas no navegador** nem passaram por axe, console de CSP ou mobile. O 01 precisa validar com o banco e o Keycloak locais.

## Arquivos fora da minha área (motivo)
- `package.json` (config raiz): scripts `test:pipeline` e `test:pipeline:integration`, e `test:pipeline` em `npm test`. Mesma exceção da T-403.
- `src/app/api/v1/companies/[companyId]/{pipeline,certificates}`: rotas do 04 em `CONTRACTS §4` e na linha Document; contrato aprovado.

## Pedidos ao agente 01
1. **DTOs** em `src/contracts/api/pipeline.ts`: o §4 pede DTOs lá, mas não posso editar `src/contracts`. Eles estão em `src/server/pipeline/dto.ts`; mova se quiser (os imports mudam em 3 arquivos).
2. **Sem exclusão de certidão**: o contrato não prevê remover `Document` (sem soft delete). O cofre antigo permitia remover. Decida: `DELETE …/certificates/{id}` auditado ou soft delete.
3. **Listagem sem cursor**: o pipeline devolve até 100 itens (`limit`, máximo 200) e `truncated`, sem `pageOf`, porque o volume por empresa é pequeno. Se preferir cursor, é mudança pequena.
4. **T-303 / T-217**: `/revisao/{id}` lê `ai_analyses` direto (`src/app/(plataforma)/revisao/[id]/dados.ts`) porque `GET …/analyses/{id}` não existe. Trocar quando a T-303 sair. A T-404 (radar) continua bloqueada pela T-217.

## Impacto em outros módulos
- 03: só consumo `createReview`/`listReviews`/`effectiveReviewStatus`/`assertBidDecisionAuthorizes`/`parseAnalysisResult` (somente leitura, sem alterações).
- 02: T-212 (anexar arquivo da certidão) pode seguir; o cofre expõe `hasFile` e nunca grava campos de arquivo.

## Pendências e riscos
1. Radar, Oportunidade, Painel e Agenda ainda usam o `localStorage`. "Adicionar ao pipeline" no radar legado grava localmente e não aparece no pipeline persistido. Quem alimenta é "Adicionar oportunidade" no próprio pipeline. Migra com T-404/T-502.
2. Sem cursor de reviews no histórico (20 mais recentes). Sem teste de navegador. `proposalValue` volta com 4 casas do `numeric(18,4)`; a UI formata.
3. A tela de pipeline envia `bidDecisionReviewId` do parecer mais recente ao entrar em etapa que exige parecer; o servidor revalida.

## Próximo passo esperado
- Agente 01: revisar, rodar `test:pipeline:integration` e a navegação com banco/Keycloak, decidir os pedidos 1–3 e mesclar.
- Agente 04: T-404 após a T-217; T-407 depois de T-406 e T-304 mescladas.

# entrega: contratos 1.4.0 no match.score — primaryCategory gravada, match.refresh e match.profile

- De: agente 03 · Para: agente 01 (revisão, merge) · Data: 2026-11-16
- Tarefa: consequência dos contratos 1.4.0 (ADR-025) · Branch: `agente-03/t305-match-score` (integra a `main` dafc617/9614e70 por merge, sem rebase)
- Contratos tocados: nenhum (só consumi o 1.4.0)

## O que foi feito
- **`primaryCategory` gravada** no `match.score` (coluna do 1.4.0). `getMatchSummaries` passa a **ler o valor gravado**; só deriva a categoria (como reserva) quando a linha gravada está sem categoria (linha anterior ao 1.4.0). Em empate de nota entre perfis, prefere a linha que tem categoria.
- **`match.refresh {}`** (`src/server/matching/fanout.ts`): diário, 05:10 America/Sao_Paulo (padrão do `SOURCE_SYNC_CRON`: variável `MATCH_REFRESH_CRON`, valor vazio desliga). Não pontua nada: enfileira `match.score {opportunityId}` para oportunidades **abertas** (`published`, `receiving_proposals`) com `proposalsCloseAt` em `[agora − 1 dia, agora + 8 dias]`, em lotes de 500 por chave (keyset por id). Se não há nenhum perfil ativo de empresa ativa, não enfileira nada.
- **`match.profile {searchProfileId}`**: percorre as abertas em lotes de 500 e enfileira `match.score {opportunityId, companyId}`. **Pré-filtra em SQL** com os mesmos filtros duros do `eligibility.ts` (UF, modalidade, faixa de valor, fonte) **como superconjunto**: UF, modalidade e valor desconhecidos ou sigilosos entram; os termos ficam para o `match.score` (precisam de texto). Perfil inexistente, inativo ou de empresa suspensa → não enfileira nada (e nada a repetir).
- Registro em `buildRegistry` e agendamento via `matchSchedules()`.

## Arquivos de outro agente alterados (com motivo)
- `src/server/jobs/handlers.ts` (registro dos dois handlers; o próprio arquivo prevê handlers de 03/04).
- **`worker/index.ts` — uma linha**: `schedules: [...sourceSchedules(), ...matchSchedules()]` (e o import). Você pediu para avisar se eu precisasse mexer em `worker/`; é só isso. O runner (`Schedule.name: JobName`) já aceitava qualquer fila, então `runner.ts` não mudou.
- `src/server/sources/sources.integration.test.ts`: a lista de handlers registrados passou a incluir `match.profile` e `match.refresh` (a mesma linha que eu já tinha ajustado para `match.score`).

## Evidências (local, PostgreSQL 16 descartável, papel `nett_app`)
```
npx tsc --noEmit                         → sem erros
npm test                                 → exit 0
npm run test:analysis:integration        → tests 28 · pass 28 · fail 0   (2 execuções seguidas)
npm run test:db 10 · test:http:integration 3 · test:jobs 5 · test:sources:integration 10 · test:read:integration 10   → todos passam
```
Mutações detectadas (cada uma reprova o teste correspondente): SQL ignora a UF; SQL descarta UF desconhecida; janela do refresh larga demais; só o primeiro lote; `getMatchSummaries` ignora a categoria gravada; não gravar `primaryCategory`.
Teste de lotes: 1100 oportunidades de uma fonte exclusiva → exatamente 1100 enfileiradas, sem repetição e sem perda. Teste de superconjunto: tudo que o filtro em memória mantém, o SQL mantém.
Os testes que criam dados (perfis, 1100 oportunidades) os removem em `after`; contei perfis ativos antes e depois de cada suíte e a minha não deixa nenhum.

## Limites e riscos
- **Não testei o disparo real pelo pg-boss** (cron e fila): os handlers de fan-out recebem `enqueue` injetado nos testes e o registro é verificado, mas não rodei um worker de ponta a ponta com o cron. O `enqueueWith` e o runner são do agente 02 e já têm teste próprio.
- **Sem caso de teste para "nenhum perfil ativo → não enfileira"** no `match.refresh`: o banco de teste é compartilhado entre suítes que rodam em paralelo, e desativar perfis globalmente seria inseguro. A guarda existe (`anyActiveProfile`), mas não está coberta.
- O keyset do `match.profile` é por `id`; com centenas de milhares de oportunidades abertas cada lote reordena o conjunto filtrado. Não medi nesse volume; meça antes de confiar na primeira varredura grande (você pediu para medir antes de qualquer marcador negativo — vale o mesmo aqui).

## Próximo passo esperado
- Agente 01: PR e merge desta branch.
- Agente 03: T-216 (API de SearchProfile e CompanyCapability; ao criar/alterar perfil enfileira `match.profile`) → T-217 (radar) → T-302 → `qualification.ts` → T-306.

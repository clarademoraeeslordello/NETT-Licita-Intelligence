# entrega: T-305b não persistir nota irrelevante + descarte rápido (agora na main só a metade)

- De: agente 03 · Para: agente 01 (revisão, merge) · Data: 2026-11-16
- Tarefa: T-305b · Branch: `agente-03/t305-match-score` (integra a `main` 45ff1a6 por merge, sem rebase)
- Contratos tocados: nenhum. **Não mexi em `src/contracts`**; aguardo o aviso do 1.4.0.

## O que há de novo (3 commits sobre a main)
1. **`762e51e` descarte rápido** — este commit **não estava na PR #21** (o envio foi recusado quando você integrou a main, e só chegou agora). `src/server/matching/eligibility.ts`: filtros duros em memória (fonte, UF, modalidade, faixa de valor, termos de inclusão) antes de qualquer consulta pesada; só perfis elegíveis são classificados e gravados; itens só são lidos quando necessário. Medição local: ~3,5–4 ms e 3 consultas por job que descarta (5 ou 50 perfis), sem gravação. Nota de perfil que deixou de casar é **removida**. Detalhes no handoff `2026-11-16-agente-03-t305-match-score.md`.
2. **T-305b** — `UNPERSISTED_CAPS = ['no_term_match', 'excluded_term']`: depois de calcular, se uma dessas travas vale, **não grava**; se já havia linha para o perfil, **apaga**. `ScoreRun` ganhou `unmatched`. `cancelled` continua gravando (nota travada em 5); diga se quer o mesmo tratamento.
3. **Limpeza dos meus testes de integração**: eles criavam `SearchProfile` ativos e os deixavam no banco compartilhado. Isso quebrou o `test:sources:integration` do agente 02 (8/10) porque o sync enriquece o que casa com **qualquer** perfil ativo (341 perfis acumulados, um com o termo "serviços"). Agora cada suíte remove os perfis que cria (as notas caem em cascata). Conferido em 3 rodadas seguidas na ordem do CI: analysis:int 22/22 e deixa 0 perfis; sources:int 10/10; read:int 9/9.

## Observação para o agente 02/01 (fora do meu escopo, não alterei)
`src/server/sources/sources.integration.test.ts:108` insere o perfil "Frotas" ativo e não o remove: cada execução deixa +1 perfil ativo no banco compartilhado. Hoje é inofensivo, mas é o mesmo tipo de vazamento que eu corrigi nos meus.

## Evidências (local, PostgreSQL 16 descartável, papel `nett_app`)
```
npx tsc --noEmit                         → sem erros
npm test                                 → exit 0 (unit 59 · … · analysis+matching 41 · read · ui · routes 16 · css ok)
npm run test:analysis:integration        → tests 22 · pass 22 · fail 0   (3 execuções seguidas)
npm run test:db 10 · test:http:integration 3 · test:jobs 5 · test:sources:integration 10 · test:read:integration 9   → todos passam
```
Mutações detectadas (T-305b): sempre gravar (testes 21 e 22), não apagar a nota antiga (22), esquecer `excluded_term` (21 e 22). Descarte rápido: sem filtro de UF, sem filtro de valor, sem remoção de nota obsoleta, sem leitura dos itens (cada uma reprova o teste correspondente).

## Limites e riscos
- Uma combinação perfil × oportunidade com trava **não deixa marca**: o `match.refresh` diário (1.4.0) vai reclassificá-la a cada dia enquanto estiver na janela de prazo. Custo baixo por job, mas proporcional a (perfis elegíveis × oportunidades na janela). Se pesar, gravo um marcador negativo leve no 1.4.0.
- A lista de perfis ativos é lida a cada job; com milhares de perfis vale um cache de 30 s no worker.

## Próximo passo esperado
- Agente 01: PR e merge desta branch; aviso do contrato 1.4.0.
- Agente 03: T-216 (API de SearchProfile e CompanyCapability) → T-217 (radar) → T-302 → `qualification.ts` → T-306, nessa ordem.

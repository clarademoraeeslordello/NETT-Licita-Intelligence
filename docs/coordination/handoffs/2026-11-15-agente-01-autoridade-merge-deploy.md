# resposta: autoridade do agente 01 sobre merge e deploy; CI das filas, armazenamento e fontes

- De: agente 01 · Para: todos · Data: 2026-11-15
- Decisão: ADR-017 (responsável humana, 2026-11-15), ADR-018 (situação efetiva da oportunidade)

## O que muda para vocês
- **Comunicação entre agentes está liberada**, sem aprovação humana. Usem mensagem direta e handoff livremente.
- **Quem mescla e faz deploy: só o 01**, depois de analisar. Vocês não mesclam, nem a própria PR. Peçam o merge no handoff ou por mensagem, com a evidência (comandos + saída).
- **Minhas recomendações valem**: ordem de tarefas, contratos, ADRs, resolução de conflitos. Discordância vai em handoff com alternativas; eu decido e registro.
- **Dependência nova, migration e mudança de contrato** passam pela minha análise e não precisam mais de aprovação humana extra.
- **Continua com a responsável humana**: gasto e serviços pagos (Railway, Keycloak hospedado, provedor de IA), aceite de termos, escolha/orçamento do provedor de IA (T-007), dados de produção irreversíveis, decisões de impacto legal. Não assumam que a autorização cobre isso.

## Entregue agora
- PR #8 (agente 02) mesclada: T-105, T-106, T-201 concluídas. T-201 mantém uma pendência: o teste ao vivo do enriquecimento (PNCP `/pncp/v1` estava 503); repetir quando a fonte voltar.
- CI: `jobs:setup` ×2 e `test:jobs` no job de banco; `test:storage` e `test:sources` no job rápido; `src/server/storage/**`, `src/server/sources/**`, `src/lib/pncp/**` nos caminhos de alto impacto.
- ADR-018: `Opportunity.status` guarda só o que a fonte informa; `effectiveStatus(opportunity, now)` calcula `receiving_proposals`/`closed` na leitura (agente 02 implementa em T-204).

## Evidências (local, PG 16, banco novo)
```
db:bootstrap, db:migrate ×2, jobs:setup ×2  → ok (idempotentes)
test:db 9/9 · test:http:integration 3/3 · test:jobs 5/5
tsc ok · test:contracts 24/24 · test:auth 4/4 · test:http 4/4 · test:storage 4/4 · test:sources 7/7
drizzle-kit generate → sem mudança pendente · YAML do workflow válido
```

## Próximo passo
- 01: contratos 1.2.0 (pedidos do 02 e do 03). Aguardem o handoff antes de mexer em `src/contracts`.
- 02: T-202 (`source.sync`/`source.normalize`) e T-203. 03: T-302 (`document.extract`) e T-304. 04: T-403 com `getSession()`.

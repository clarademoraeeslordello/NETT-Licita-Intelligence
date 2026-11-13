# Handoff — Agente 02 (Engenharia de Dados e Integrações)

## Entrega 1 — 13/11/2026 — serviço de integrações (branch `claude/agente-02-integracoes`)

### Contexto e decisões
- `AGENTS.md` e `docs/coordination/*` **não existiam** neste repositório nem no repositório base. Foram criados como rascunho (`PROJECT_CONTEXT.md`, `TASK_BOARD.md`, `CONTRACTS.md`) — **Agente 01 deve revisar/aprovar**.
- Contrato de oportunidade e migration são **propostas** (`0.1.0-proposta`, `src/db/migrations/0001_integracao.sql`, schema isolado `integracao`). Não aplicar em ambiente compartilhado antes da aprovação.
- Cliente PNCP portado de `Enzo47961/licitaflow-licitacoes` (MIT) e generalizado para todas as fontes.
- Nenhuma IA de classificação: o dicionário comercial é filtro determinístico por termos; aderência é do Agente 03.

### O que foi entregue
| Item | Onde | Situação |
| --- | --- | --- |
| Cliente HTTP (limitador por fonte, cache, deduplicação de requisições, retentativa com backoff, Retry-After, segredos fora de URLs/logs) | `src/http/cliente.ts` | Pronto |
| Arquitetura de conectores | `src/conectores/tipos.ts`, `src/fontes.ts` | Pronto |
| PNCP (consulta por atualização; itens; arquivos; consulta pontual) | `src/conectores/pncp` | **Testado ao vivo** |
| Compras.gov.br (dados abertos, independente) | `src/conectores/comprasgov` | **Testado ao vivo** |
| SIGA/RJ | `src/conectores/siga-rj` | **Bloqueado** — reporta indisponibilidade, sem dados simulados |
| Trello somente leitura (board, listas, etiquetas, cards, descrições, prazos, checklists, anexos, comentários, movimentações; webhook com HMAC; sync de segurança horária; vínculo card↔PNCP) | `src/conectores/trello` | **Implementado, NÃO validado** (sem credenciais) |
| Normalização, deduplicação, prioridade de fonte, histórico de versões e de origem | `src/repositorio`, `src/dedupe` | Pronto |
| Fila persistente (SKIP LOCKED, dedupe, backoff, `morto`, lease, orçamento/h) | `src/fila/fila.ts` | Pronto |
| Coleta horária retomável (cursor por partição, releitura de segurança de dias fechados) | `src/coleta`, `src/agendador.ts`, `src/worker.ts` | Pronto |
| API interna + eventos + métricas | `src/api/servidor.ts`, `docs/coordination/CONTRACTS.md` | Pronto (proposta) |

### Evidência de execução real (worker + API locais, banco local, dicionário de EXEMPLO)
Execução de ~7 min em 13/11/2026 23:08–23:16 UTC, `PNCP_MODALIDADES=4,6`, `COMPRASGOV_MODALIDADES=5`, `COLETA_MAX_PAGINAS=40`:
- PNCP (execução 1): 40 páginas, 1.998 registros lidos, 69 aderentes, 69 novas, 68 enfileiradas (1 cancelada), 0 erros, 207 s, status `parcial` (limite de páginas; cursor guardado).
- Compras.gov.br (execução 2): 3 páginas, 1.021 registros, 54 aderentes, 50 novas, **4 já existentes vindas do PNCP (dedupe entre fontes ao vivo)**, 0 erros, 3,9 s, `sucesso`.
- Ao fim: 187 oportunidades, 41 processadas (documentos/itens), 145 pendentes na fila aguardando orçamento — **nada descartado**; 293 documentos; 4 oportunidades com duas origens; 1 possível duplicata sinalizada; 0 jobs com falha.
- Esse log revelou um bug (agendador recriava a coleta da mesma janela após concluí-la). Corrigido com `enfileirarUnico` + teste.

### Testes
- `npm test`: 16 testes de unidade (amostras reais das APIs em `tests/fixtures`).
- `npm run test:integracao`: 23 testes contra PostgreSQL real; PNCP e Compras.gov **ao vivo**; Trello contra servidor local simulado (valida só a lógica — rotulado no arquivo).

### Pendências (bloqueiam aceite)
1. **Trello**: credenciais somente leitura (`TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_ID`, `TRELLO_APP_SECRET`) como segredos do ambiente, URL pública para `/webhooks/trello` e aprovação para registrar o webhook (`npm run trello:webhook -- --confirmar`, ação manual). Até lá, critério "Trello sincronizado" **não atendido**.
2. **Dicionário comercial oficial** em `config/dicionario-comercial.json` (o de exemplo é `oficial: false`; a execução registra versão e flag em `execucao_coleta.detalhe`).
3. **SIGA/RJ**: definir forma de acesso autorizada. Compras do RJ publicadas no PNCP já são capturadas.
4. **Agente 01**: aprovar contrato `0.1.0-proposta`, migration e hospedagem (worker contínuo + API + PostgreSQL).
5. Capacidade: PNCP respondeu ~5 s/página; pregão eletrônico teve 97 páginas/dia por atualização. Com `COLETA_MAX_PAGINAS=300` e janela de 1 dia, a coleta horária fica em ~25 min; ajustar modalidades/limites após o dicionário oficial.
6. Não há alerta ativo (só métricas/logs); definir destino de alertas com o Agente 01.

### Para o Agente 03
Consumir `GET /v1/eventos?tipo=oportunidade.pronta_para_avaliacao&apos=<cursor>` e buscar `GET /v1/oportunidades/{id}`. Versão muda a cada alteração relevante; reavaliar quando `versao` aumentar.

### Para o Agente 04
Somente a API interna (`CONTRACTS.md` C-02.3). Nenhuma chamada direta a portais.

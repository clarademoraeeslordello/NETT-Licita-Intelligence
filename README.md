# NETT Licita Intelligence — Integrações (Agente 02)

Serviço de coleta, normalização, deduplicação e entrega de oportunidades de licitação (PNCP, Compras.gov.br; SIGA/RJ pendente) e espelho somente leitura do board Trello da Nett.

**Estado:** contratos e migration são propostas pendentes do Agente 01. Ver [handoff](docs/coordination/handoffs/agent-02.md) e [contratos](docs/coordination/CONTRACTS.md).

## Rodar localmente

Requisitos: Node ≥ 22, PostgreSQL 16 (com `gen_random_uuid`, nativo no PG ≥ 13).

```bash
npm install
cp .env.example .env   # ajuste DATABASE_URL e API_TOKEN_INTERNO
npm run db:migrar
```

```bash
npm run worker   # agenda coletas horárias e consome a fila
npm run api      # API interna em :3200
```

Coleta imediata (diagnóstico): `npm run coletar`.

## Testes

```bash
npm test                 # unidade
npm run test:integracao  # PostgreSQL de teste + APIs públicas ao vivo (requer rede)
```

`DATABASE_URL_TESTE` deve apontar para um banco cujo nome contenha `teste`; o schema `integracao` dele é recriado.

## Estrutura

```
src/http          cliente HTTP comum (limitador, cache, retentativas)
src/conectores    pncp, comprasgov, siga-rj, trello
src/coleta        orquestrador de coleta, execuções, processador
src/fila          fila persistente PostgreSQL
src/repositorio   persistência, histórico, consultas da API
src/contrato      schema da oportunidade normalizada (proposta)
src/api           API interna e webhook Trello
src/db            pool e migrations (proposta)
```

Código PNCP derivado de [Enzo47961/licitaflow-licitacoes](https://github.com/Enzo47961/licitaflow-licitacoes) (MIT).

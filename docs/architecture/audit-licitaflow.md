# Auditoria do LicitaFlow — base do NETT Licita Intelligence

- Autor: Agente 01 (Tech Lead) · Data: 2026-11-13
- Origem: `Enzo47961/licitaflow-licitacoes`, commit `a4ed99f8e359a4f74b9b4531e873e75a15aad018` (2026-09-23), importado sem alterações no commit `chore: importa snapshot do LicitaFlow como base`.
- Método: leitura estática do código. **Build e testes não foram executados** nesta auditoria (instalação de dependências não autorizada na sessão). Ver pendência P-01.

## 1. O que é

Aplicação Next.js para **empresas fornecedoras** do governo: radar de editais do PNCP com nota de aderência, análise de edital em PDF com IA, preços homologados, pipeline (kanban), cofre de certidões e agenda. Demonstração pública, sem login.

## 2. Inventário técnico

| Item | Encontrado | Arquivo/evidência |
| --- | --- | --- |
| Framework | Next.js `^15.5.25`, React 19, App Router, Tailwind v4 | `package.json` |
| Dependências de produção | 5 (`next`, `react`, `react-dom`, `unpdf`, `zod`). README diz 6 | `package.json` |
| Gerenciador | npm (`package-lock.json`) | raiz |
| Autenticação | **inexistente** | nenhuma rota/middleware de auth |
| Multiempresa | **inexistente** | workspace único por navegador |
| Persistência de negócio | `localStorage` (`arremate.workspace.v1`): perfil, pipeline, documentos, descartadas | `src/lib/plataforma/workspace.ts`, `src/components/plataforma/workspace-provider.tsx` |
| Persistência de análises | memória do processo (40 jobs, TTL 6 h) + gravação opcional via RPC Supabase | `src/lib/store.ts`, `src/lib/persistencia.ts`, `src/lib/banco.ts` |
| Banco | Supabase (PostgREST RPC) com schema `arremate`; 2 migrations SQL avulsas, sem ORM nem controle de versão de schema | `supabase/migrations/*.sql` |
| Cota de IA | hash de IP + id de dispositivo; memória ou Supabase | `src/lib/limite.ts`, `src/lib/dispositivo.ts` |
| Integração PNCP | cliente com timeout, backoff só para 5xx, dedupe, cache em memória, disjuntor no `/consulta`, `mapLimit` 3–5 | `src/lib/pncp/client.ts`, `api.ts`, `radar.ts`, `precos.ts` |
| Fallback PNCP | fixture real `pncp-amostra.json`, sinalizada na UI | `src/lib/fixtures/` |
| IA | DeepSeek ou Gemini (API compatível OpenAI), JSON mode; mapa-redução por blocos; fallback determinístico local | `src/lib/ai/*`, `src/lib/analysis.ts`, `src/lib/chunking.ts` |
| Modelo de evidência | `found` / `inferred` / `not_found` + `quote` + `source` (página) | `src/lib/schema.ts`, `src/lib/evidence.ts` |
| PDF do relatório | HTML de impressão + navegador headless local (caminhos Windows Chrome/Edge) | `src/lib/report/browser.ts` |
| Filas/workers | **inexistentes**; análise roda dentro da requisição (SSE) | `src/lib/service.ts`, `src/lib/stream.ts` |
| Object storage | **inexistente**; PDFs só em memória | — |
| Testes | scripts Node próprios (`test-unit`, `verify-routes`, `audit-css`, `test-e2e`), sem Vitest/Playwright | `scripts/` |
| Segurança HTTP | `nosniff`, `Referrer-Policy`, `X-DNS-Prefetch-Control`. Sem CSP, sem HSTS, sem rate limit geral | `next.config.ts` |
| Identidade visual | paleta azul/teal/ink (`--color-brand-*`, `--color-accent-*`) | `src/app/globals.css` |
| Hospedagem | Vercel (serverless) | README, `.gitignore` |
| Licença | MIT, © 2026 Enzo Ferrara | `LICENSE` |

## 3. Ativos a preservar

1. **Modelo de evidência** (`found/inferred/not_found` com trecho e página) → base do contrato `AIAnalysis`.
2. **Cliente PNCP resiliente** (backoff sem retry em 429, disjuntor, concorrência limitada) → base do conector PNCP do agente 02.
3. **Nota de aderência auditável** (fatores nomeados, travas) → base do `matching` do agente 03.
4. **Pipeline de análise mapa-redução** com orçamento de tempo/tokens e fallback local.
5. Regras puras em `src/lib/plataforma` (documentos, agenda, preços).

## 4. Lacunas e riscos (priorizados)

| # | Severidade | Lacuna | Destino |
| --- | --- | --- | --- |
| L-01 | Crítica | Sem autenticação, autorização ou isolamento por empresa | ADR-005, agente 01 |
| L-02 | Crítica | Dados de negócio em `localStorage` e memória; perda em restart; não escala horizontalmente | ADR-003/010, agentes 01/04 |
| L-03 | Alta | Análise de IA síncrona na requisição; sem fila nem retomada | ADR-006, agentes 02/03 |
| L-04 | Alta | Supabase RPC com segredo compartilhado (`ARREMATE_SEGREDO`) em vez de acesso direto ao Postgres | ADR-004 |
| L-05 | Alta | Sem armazenamento persistente de documentos (PDFs de edital) | ADR-007, agente 02 |
| L-06 | Alta | Texto de edital enviado a LLM externo sem política de provedor aprovada; risco de prompt injection via PDF | ADR-008, agente 03 |
| L-07 | Média | Geração de PDF depende de Chrome/Edge instalado (caminhos Windows) — incompatível com container Railway sem ajuste | agente 03 |
| L-08 | Média | Sem CSP/HSTS; sem rate limit fora da cota de IA | agente 01 |
| L-09 | Média | Caches PNCP em memória por instância | agente 02 |
| L-10 | Média | Marca legada "Arremate"/"LicitaFlow" em chaves, env vars (`ARREMATE_*`), schema SQL | todos, na área de cada um |
| L-11 | Média | Paleta fora da identidade Nett | ADR-009, agente 04 |
| L-12 | Baixa | Testes em scripts próprios, sem runner padrão nem CI | ADR-012, agente 01 |
| L-13 | Baixa | Nomes misturados pt/en nos tipos | ADR-011 |
| L-14 | Jurídica | Licença MIT exige manter aviso de copyright nas partes derivadas; "plataforma proprietária" é viável, mas precisa validação humana | Pendência P-02 |

## 5. Pendências da auditoria

- **P-01** Executar `npm ci && npm test` e `npm run build` no snapshot e anexar resultado (agente 01, T-004).
- **P-02** Validação jurídica humana do uso da base MIT em produto proprietário.
- **P-03** Confirmar com a responsável o modelo de negócio (multiempresa com consultores Nett atendendo várias empresas clientes) — premissa usada em `CONTRACTS.md`.

# entrega: T-107 endurecimento HTTP, T-108 auditoria e T-004 build/testes

- De: agente 01 · Para: todos · Data: 2026-11-15
- Tarefas: T-107, T-108, T-004 · Contratos: 1.0.0 → **1.1.0** (adiciona `AuditEvent`, compatível)
- Decisão: ADR-016

## O que foi feito
- **T-108** `src/contracts/audit.ts`, tabela `audit_events` (migrations 0003/0004: trigger append-only, sem UPDATE/DELETE/TRUNCATE para `nett_app`, metadata ≤ 8 KB), `recordAudit` / `recordAuditSafe` com remoção de chaves sensíveis. Eventos já emitidos: `auth.login` (sucesso/falha/negado), `auth.logout`, `authz.denied` (motivo: `invalid_id`, `no_membership`, `company_inactive`, `insufficient_role`).
- **T-107** `src/middleware.ts` (CSP com nonce, `x-request-id`), `next.config.ts` (HSTS, X-Frame-Options, COOP, Permissions-Policy, sem X-Powered-By), limite de requisições no Postgres (`rate_limit_buckets`) em `withApi` (300/min) e no login/callback (20/min por IP), IP do cliente com hash (HMAC).
- Layout raiz agora é dinâmico (`await headers()`) para o nonce funcionar.

## Para os agentes
- Toda escrita de negócio relevante chama `recordAudit(tx, …)` **na mesma transação** (lista em CONTRACTS §5).
- Não usar `<script>` inline nem `dangerouslySetInnerHTML` com script; CSP bloqueia. Estilos inline continuam permitidos.
- Não criar outra tabela/arquivo de log de auditoria.

## Evidências (local: Postgres 16.15, Keycloak 26.4.2)
```
npx tsc --noEmit → 0 · npm test → exit 0 (59 unidade herdados, 24 contratos, 4 auth, 4 http, 16 rotas, CSS ok)
npm run test:http:integration → 3/3 (append-only/TRUNCATE negado, authz.denied com motivo, limite atômico com 10 concorrentes → 3 permitidos)
npm run test:db 9/9 · KEYCLOAK_TEST=1 npm run test:auth:integration 4/4 (0 pulados)
next build → ok (todas as páginas dinâmicas)
next start (produção) + Chromium, 8 telas (/, /radar, /pipeline, /precos, /documentos, /perfil, /agenda, /analisador)
  → 200, hidratadas, 0 violações de CSP
  → <img onerror> injetado NÃO executa (bloqueado pela CSP)
  → cabeçalhos: CSP com nonce, HSTS, X-Frame-Options DENY, COOP, Permissions-Policy, x-request-id
next dev: /api/auth/login 20×302 → 429 (Retry-After); IP forjado à esquerda do XFF ignorado
next dev: login → /me 200 → logout → /me 401; audit_events: auth.login e auth.logout com ator e request id
```

## Pendências
- Retenção da trilha de auditoria e acesso de leitura (tela admin) — depende da política LGPD (humano).
- `style-src 'unsafe-inline'` a revisar com o agente 04.

# feat: T-403 — shell autenticado e seletor de empresa

- De: agente 04 · Para: agente 01 (revisão e merge) · Data: 2026-11-15
- Tarefa: T-403 · PR: branch `agente-04/frontend`
- Contratos tocados: nenhum. Usa `getSession`, `requireSession`, `requireCompanyAccess` (`src/server/auth`) e `listAccessibleCompanies` (a mesma fonte de `/api/v1/me`).

## O que foi feito

**`src/app/(plataforma)/layout.tsx`**
- O layout é server component.
- Sem sessão válida, redireciona para `/api/auth/login?returnTo=…`.
- Com sessão, lista as empresas acessíveis e resolve a empresa ativa.
- Entrega ao cliente só nome, e-mail, papéis globais e a lista `{id, legalName, role}`. Sem token nem segredo.

**`src/app/(plataforma)/acoes-sessao.ts`** — Server Action `selecionarEmpresa`:
- entrada validada com Zod (`uuid`);
- `requireSession` e depois `requireCompanyAccess(…, 'viewer')`, que audita a negação;
- grava o cookie `nett_empresa` (`HttpOnly`, `SameSite=Lax`, `Secure` conforme `APP_URL`, 30 dias) e redireciona para a mesma página, também validada.
- O Next valida Origin/Host da action. Nenhuma rota `/api` nova.

**`src/components/sessao/`**
- `empresa-atual.ts` (lógica pura, testada): empresa ativa = a do cookie se estiver na lista acessível, senão a primeira em ordem alfabética. Um id forjado no cookie é ignorado.
- `SessaoProvider` / `useSessao`: contexto para as próximas telas (T-404 a T-407) lerem a empresa ativa.
- `CartaoSessao`: usuário, papel global, seletor de empresa (formulário com botão "Trocar", sem script inline) e "Sair" (POST `/api/auth/logout`).
- Estado vazio: "Nenhuma empresa vinculada…".

**`app-shell.tsx`**
- O cartão de sessão substitui o cartão herdado, que lia o `localStorage`.
- Marca "NETT Licita Intelligence" na barra lateral (ADR-001: remoção gradual da marca antiga).

**`package.json`** (config raiz, aprovação do 01): script `test:ui` (`tsx --test "src/components/**/*.test.ts"`), incluído em `npm test`.

## Evidências (local: Postgres 16.10 e Keycloak 26.4.2 do `docker-compose.yml`, `next dev`)

```
npm test                                      → EXIT 0 (test:ui # pass 5 · # fail 0; demais suítes verdes;
                                                 test:css ✓ classes geram CSS ✓ só paleta oficial)
KEYCLOAK_TEST=1 npm run test:auth:integration → # pass 4 · # fail 0
npm run test:db                               → # pass 10 · # fail 0
npx tsc --noEmit                              → ok
npx next build                                → ✓ Compiled successfully

HTTP sem sessão:  /radar, /precos?q=x, /  → 307 /api/auth/login?returnTo=%2F

Playwright + Keycloak real (usuários do realm local, empresas fictícias):
  consultor sem vínculo         → "Nenhuma empresa vinculada ao seu usuário…"
  consultor com 2 vínculos      → opções [Alfa (teste), Beta (teste)]; ativa = Alfa (1ª alfabética); "Seu papel: Leitura"
  Trocar → Beta                 → volta para /pipeline; "Seu papel: Consultor"; cookie nett_empresa httpOnly, SameSite=Lax; persiste após recarregar
  cookie forjado (empresa Gama) → Gama não listada; ativa volta para Alfa
  action com id forjado (Gama)  → 303; empresa ativa inalterada; cookie não gravado; auditoria "authz.denied denied no_membership"
  axe WCAG 2 A/AA em /pipeline  → 0 violações
  erros de CSP no console       → 0; nenhum erro de hidratação em 8 rotas
  Sair                          → /api/v1/me → 401
  admin (390 px, menu mobile)   → 3 empresas ativas; "Seu papel: Administrador"
```

## Pendências e riscos

1. **Agente 01 — retorno ao link original após o login.** O layout não tem acesso ao caminho da requisição, então hoje o `returnTo` é sempre `/`.
   - Proposta: no `src/middleware.ts`, definir `headers.set('x-nett-pathname', request.nextUrl.pathname)` e `x-nett-search`.
   - O layout já lê esses cabeçalhos e os sanitiza com `caminhoDeRetorno`; o login aplica `safeReturnTo` de novo.
2. As telas herdadas continuam lendo o `localStorage` (perfil, documentos, pipeline). Saem com T-404, T-406 e T-502.
3. Sem `DATABASE_URL`, as páginas da plataforma não abrem (ADR-010: sem modo demo sem login).
4. A troca de empresa usa cookie por navegador. Se o 01 preferir guardar a preferência no banco (por usuário), é uma tarefa nova.

## Próximo passo esperado

- Agente 01: revisar e mesclar; decidir sobre o item 1.
- Agente 04: T-104 (tema de login do Keycloak).

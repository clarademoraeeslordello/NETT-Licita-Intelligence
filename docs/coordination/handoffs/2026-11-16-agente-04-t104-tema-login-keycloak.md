# feat: T-104 — tema de login do Keycloak na paleta NETT

- De: agente 04 · Para: agente 01 (revisão e merge) · Data: 2026-11-16
- Tarefa: T-104 · PR: branch `agente-04/frontend`, sobre a `main` com a PR #11 (T-403) já mesclada
- Contratos tocados: nenhum.

## O que foi feito
- `docker/keycloak/themes/nett/login/`:
  - tema `nett`, filho do `keycloak.v2`: reaproveita os templates e só troca estilos e marca;
  - `theme.properties` e `resources/css/nett.css` (variáveis do PatternFly v5 e estados);
  - `resources/img/nett-logo.svg` (logo da NETT na paleta).
- `nett.css`:
  - Usa só as 8 cores; variações apenas por opacidade (`color-mix`).
  - Estados: erro, aviso, sucesso e info diferenciados por ícone, texto e borda, sem matiz nova (ADR-009). O erro do formulário usa `#ECECEC`, com ícone de exclamação e mensagem.
  - Foco visível dourado (`outline` 2 px). Botão primário `#C9A227` com texto `#050505` (contraste alto).
  - Campo de senha com botão "mostrar" com cantos contínuos.
- `docker-compose.yml` monta o tema em `/opt/keycloak/themes/nett` (somente leitura).
- `realm-nett.json`: `loginTheme: "nett"` e `displayNameHtml` com o logo. O realm local importa o tema do zero.
- `scripts/audit-css.mjs` (parte de `npm test`): a auditoria de paleta (T-402) agora também varre `docker/keycloak/themes/`.
  - Teste de sanidade: um `#ff0000` colocado no tema faz `test:css` falhar (`✗ cor fora da paleta: …/zz.css: #ff0000`).

## Evidências (local: Keycloak 26.4.2 e Postgres 16.10 do compose, recriados do zero)
```
npm test                       → EXIT 0 (unit 59/59 · contracts 27 · auth 4 · test:ui 5 · http 5 · analysis 18 · routes 16/16
                                 test:css ✓ classes geram CSS ✓ código-fonte, tema e CSS gerado só na paleta)
kcadm get realms/nett          → loginTheme "nett" (realm importado de volume limpo)
Playwright na tela de login do Keycloak, desktop 1440 px e mobile 390 px, estados inicial e erro:
  cores computadas (color, background, borders, outline, SVG, ::before/::after) fora da paleta → 0 nos 4 casos
  axe WCAG 2 A/AA                                                                                 → 0 violações nos 4 casos
T-403 reexecutada na branch atualizada: troca de empresa, cookie forjado, action adulterada (303, auditoria
authz.denied no_membership), Sair → /api/v1/me 401, axe 0 violações, 0 erros de CSP.
Sem sessão, /pipeline?x=1 → 307 /api/auth/login?returnTo=%2Fpipeline%3Fx%3D1 (middleware do agente 01)
```
Capturas das telas: em anexo na PR.

## Impacto
- Só a infraestrutura local e o realm de desenvolvimento.
- **Produção:** o realm de produção precisa do mesmo tema. Isso depende da hospedagem do Keycloak (Railway, T-503); o tema é um diretório estático (`themes/nett`) a copiar para a imagem ou o volume do Keycloak, e `loginTheme: nett` no realm.
- Quem já subiu a infra local com volume antigo: `docker compose down -v && npm run infra:up`, ou definir o tema em Realm settings → Themes → Login theme `nett`.

## Pendências
1. Tema só da tela de login. Páginas de conta e e-mails do Keycloak seguem o padrão.
2. As strings continuam as do `keycloak.v2` (pt-BR no realm).
3. Revisão do 01.

## Próximo passo
- Agente 01: revisar e mesclar (PR #11 e depois esta).
- Agente 04: aguardar T-204/T-305/T-304 para as telas de dados.

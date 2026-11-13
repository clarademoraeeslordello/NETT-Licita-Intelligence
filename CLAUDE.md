# Instruções para agentes de código

Leia e siga `AGENTS.md` antes de qualquer alteração (papéis, branches, fronteiras, política de uso responsável).

## Estilo de resposta (Nett)
- Sem introduções, cumprimentos ou encerramentos.
- Retorne apenas o trecho alterado; prefira diff compacto para mudanças simples.
- Omita explicações conceituais, salvo pedido explícito.
- Se faltar contexto, faça uma pergunta curta em vez de adivinhar.

## Ignorar
`node_modules/`, `.next/`, `dist/`, `build/`, `.test-build/`, `test-output/`, `.git/`.

## Comandos
- `npm run dev` · `npm test` · `npm run build`
- Contratos e schema: `npm run test:contracts`
- Banco: `npm run db:migrate` · `npm run test:db` · nova migration: `npm run db:generate`

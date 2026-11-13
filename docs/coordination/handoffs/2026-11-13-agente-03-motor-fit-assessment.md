# entrega + pedido: motor `fit_assessment` (aderência comercial × habilitação) e testes de prompt injection

- De: agente 03 · Para: agente 01 (revisão e contratos), agente 02 (entrada), agente 04 (saída) · Data: 2026-11-13
- Tarefas: T-307 (concluída nesta PR) · base para T-303/T-305 · PR: a abrir a partir de `agente-03/ia`
- Contratos tocados: nenhum (só importa de `src/contracts`). Há uma proposta de extensão no item "Pedido ao agente 01".

## O que foi feito

Código novo restrito a `src/server/analysis/fit/` (área do agente 03). Só funções puras: sem banco, sem estado em memória, sem dependência nova, sem rota nova.

- **Entrada canônica:** `Opportunity`, `OpportunityItem`, `Document` público com texto por página (vem de T-302), `Company`, `CompanyCapability`, `Document(kind=company_certificate)` e `SearchProfile`. Tudo é validado com os schemas de `src/contracts`. A mistura de tenants é rejeitada: capacidade, certidão ou perfil de outra empresa, e documento privado tratado como documento da licitação.
- **Classificação semântica** nas 6 categorias Nett (`dictionary.ts`, `nett-dictionary-1.0.0`, semente). Usa radical das palavras, proximidade sem ordem fixa, peso por seção do documento e combinação noisy-OR. Uma cláusula genérica de LGPD não transforma merenda em "LGPD".
- **A. Aderência comercial** (`commercial.ts`): os fatores usam as chaves de `matchFactor` (`object`, `region`, `value`, `deadline`, `modality`) e as travas, as de `MatchScore.caps`. O fator objeto vem da classificação; os demais vêm do `SearchProfile`. Reaproveita `diasAte` de `aderencia.ts`.
- **B. Habilitação** (`requirements.ts`, `qualification.ts`), calculada separadamente: atestados, certificações, profissionais, regularidade fiscal, índices contábeis, capacidade operacional, ME/EPP, visita técnica e PoC. Cada requisito traz documento, página, seção e trecho. Dado ausente da empresa fica `unverified`, nunca `met`. Impedimentos eliminatórios são detectados (certificação vencida, exclusiva ME/EPP com `Company.size = DEMAIS` etc.).
- **Parecer** (`opinion.ts`): riscos, pendências, motivos favoráveis e desfavoráveis, motivos de descarte, confiança e recomendação preliminar (`participate | evaluate | discard`), sempre com aviso de decisão humana em `HumanReview(bid_decision)`.
- **Evidências** com status `proven | inferred | unverified`. Um teste confere que todo trecho `proven` existe literalmente na página de origem.
- **T-307 — conteúdo não confiável:** instruções embutidas são detectadas, viram alerta e risco e ficam fora do score e da extração. Um teste prova que notas e requisitos ficam idênticos com e sem a página adulterada.
- **LLM opcional** (`llm.ts`, desligado até P-04): roda por blocos com `buildChunks`, lê o JSON com `parseModelJson` e chama o modelo pelo adaptador de `createJsonCompletion`. O documento vai delimitado como dado. Cada citação é verificada literalmente e as sem lastro são descartadas. **Só texto público vai ao modelo** (ADR-008); um teste garante que capacidades da empresa não vazam para o prompt.
- **Histórico:** `toAIAnalysis()` gera a linha canônica `AIAnalysis` (`kind = fit_assessment`, `reviewStatus = pending_review`, `inputHash` com versões e dados da empresa). Quem persiste é T-303.
- **Parecer humano:** `compareWithReviews()` lê `HumanReview` (`bid_decision` mais as correções `commercial.primaryCategory` e `qualification.eligible` em `ai_analysis`). `divergenceReport()` gera métricas e sugestões com `automaticApply: false`.
- **Evolução versionada:** `WEIGHTS_V1` congelado, `ENGINE_VERSION`, versão do dicionário e do prompt gravadas no resultado. `backtest()` compara uma versão candidata com as decisões humanas, sem aplicar nada.

## Evidências

```
npx tsx --test src/server/analysis/fit/fit.test.ts   → tests 18 · pass 18 · fail 0
npm test   (typecheck + unit 59 + contracts 23 + routes 16 + css)   → exit 0
```

## Pedido ao agente 01 (contratos — nada foi alterado em `src/contracts`)

1. Registrar `fitAssessmentResult` (`src/server/analysis/fit/result.ts`, `fit-assessment/1.0.0`) como schema do `kind = fit_assessment` em `analysis.ts`.
2. Avaliar `nettCategory` (6 categorias) como enum compartilhado, pois é necessário para o agente 04 filtrar e exibir.
3. `CompanyCapability` não tem indicadores contábeis (LG, SG, LC, patrimônio líquido). Hoje requisitos financeiros ficam `unverified`. Proposta: um campo estruturado opcional para `kind = financial_capacity`.
4. `CompanyCapability(kind = certification)` mistura certificação da empresa e de profissional. Proposta: um `subject: 'company' | 'professional'` ou um novo kind.
5. A interface `AnalysisEngine` (CONTRACTS §5) não recebe dados da empresa, então `fit_assessment` não cabe nela. Proposta: um método ou input específico. `completeCapabilityKinds` (tipos que a empresa declara completos) é opção de execução e não precisa ir para o banco.
6. Adicionar o script `"test:analysis": "tsx --test src/server/analysis/**/*.test.ts"` ao `package.json` e incluí-lo em `npm test`.

## Impacto em outros módulos

- **Agente 02:** a avaliação precisa do texto por página dos documentos públicos (T-302, `document.extract`, que é do 03) e de `OpportunityItem`. Nenhuma mudança no 02.
- **Agente 04:** consumir `AIAnalysis.result` validado por `fitAssessmentResult`. Requisitos, riscos e motivos referenciam `evidence[].id`. Exibir sempre `preliminaryRecommendation.notice`.

## Pendências e riscos

- O dicionário e os pesos são **semente**: falta validação comercial da Nett.
- Os testes usam só dados fictícios; falta uma amostra de editais reais aprovada.
- A LLM fica desabilitada até P-04/T-007 (provedor, custo, retenção). Também falta a quota T-109.
- A persistência (`ai_analyses`), a fila `analysis.run` e a rota `/analyses` dependem de T-303. A API de `HumanReview` depende de T-304.
- A cópia provisória feita antes do acesso a este repositório (branch `claude/focused-cray-yp8jnw` em outro repositório) foi substituída por esta entrega.

## Próximo passo esperado

- Agente 01: revisar a PR e responder aos pedidos 1–6.
- Agente 03: T-303 (persistência e cache por `inputHash`) assim que T-105 e T-302 forem liberadas.

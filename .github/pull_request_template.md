## Tarefa
T-xxx · Agente NN · Branch `agente-NN/...`

## O que muda

## Contratos
- [ ] Não altera `src/contracts`
- [ ] Altera `src/contracts` (versão: ___ ; ADR: ___ ; agentes impactados avisados via handoff)

## Checklist (verificado pelo agente 01)
- [ ] Tipos importados de `src/contracts`, sem redefinição de entidade canônica
- [ ] Segurança: authz por empresa, entrada validada (Zod), sem segredo/dado pessoal em log ou commit
- [ ] Persistência: sem estado de negócio em memória/localStorage; migration nova (não edita antiga)
- [ ] Testes novos cobrindo o comportamento; saída anexada abaixo
- [ ] Impactos em outros módulos listados
- [ ] Sem duplicação de funcionalidade existente
- [ ] UI: somente as 8 cores da paleta; contraste verificado

## Evidências (comandos + saída)
```
```

## Handoff
`docs/coordination/handoffs/...`

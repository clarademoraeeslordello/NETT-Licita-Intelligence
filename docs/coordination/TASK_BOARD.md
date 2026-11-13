# TASK_BOARD — NETT Licita Intelligence

> Criado pelo Agente 02 (arquivo oficial inexistente). Agente 01 deve consolidar.

| ID | Tarefa | Responsável | Status | Depende de |
| --- | --- | --- | --- | --- |
| A02-01 | Cliente HTTP comum (rate limit, cache, retentativa, Retry-After) | 02 | Concluída | — |
| A02-02 | Conector PNCP (consulta por atualização, itens, arquivos) | 02 | Concluída — testada ao vivo | — |
| A02-03 | Conector Compras.gov.br (dados abertos, independente) | 02 | Concluída — testada ao vivo | — |
| A02-04 | Conector SIGA/RJ | 02 | **Bloqueada** | Forma de acesso autorizada (Nett) |
| A02-05 | Arquitetura de conectores (`ConectorLicitacoes`) | 02 | Concluída | — |
| A02-06 | Normalização + contrato `0.1.0-proposta` | 02 | Concluída (proposta) | Aprovação A01 |
| A02-07 | Deduplicação (chave canônica + suspeitas) | 02 | Concluída — validada com dados reais PNCP × Compras.gov | — |
| A02-08 | Fila persistente PostgreSQL + worker + agendamento horário + orçamento 50/h | 02 | Concluída | — |
| A02-09 | Histórico de origem e de versões | 02 | Concluída | — |
| A02-10 | Monitoramento (execucao_coleta, /v1/fontes, /metricas, logs JSON) | 02 | Concluída | — |
| A02-11 | API interna para o Agente 04 + eventos para o Agente 03 | 02 | Concluída (proposta) | Aprovação A01; validação A03/A04 |
| A02-12 | Integração Trello somente leitura (sync + webhook) | 02 | **Implementada, não validada** | Credenciais Trello; URL pública; aprovação do registro do webhook |
| A02-13 | Dicionário comercial oficial | Nett | **Pendente** | — |
| A02-14 | Migration `0001_integracao.sql` | 01 | **Aguardando revisão** | — |
| A02-15 | Hospedagem do worker/API/banco e segredos | 01 | Pendente | — |

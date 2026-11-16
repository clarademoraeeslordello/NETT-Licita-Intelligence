# evidência: identificador determinístico por fonte candidata (ADR-020, fusão entre fontes)

- De: agente 02 · Para: agente 01 · Data: 2026-11-16
- Tarefa(s): subsídio à ADR-020 (T-205 a T-210 seguem bloqueadas) · Contratos tocados: nenhum

## Pergunta
Para cada fonte candidata, o payload traz o número de controle do PNCP (`<cnpj>-<n>-<seq6>/<ano>`)?

## Respostas, com evidência
| Fonte | Traz o identificador? | Evidência |
| --- | --- | --- |
| **PNCP** (consulta) | É a própria fonte: `numeroControlePNCP` | `canonicalKey = pncp:<cnpj>-<ano>-<seq>`; 50 registros reais em T-202, todos com o campo |
| **Compras.gov.br** (dados abertos, módulo `1_consultarContratacoes_PNCP_14133`) | **Sim, em 100% da amostra** | 16/11/2026, 2 modalidades, publicação 12–13/11: **942 de 942** registros com `numeroControlePNCP`; **942 no formato oficial**; **942 coerentes** com `orgaoEntidadeCnpj` + `sequencialCompraPncp` + `anoCompraPncp`; `idCompra` único em todos (942). Em 13/11 a sobreposição real PNCP × Compras.gov foi comprovada ao vivo: 4 das 54 compras coletadas pelo Compras.gov já existiam via PNCP e caíram na mesma oportunidade pela chave (branch `claude/agente-02-integracoes`, não mesclada) |
| **SIGA/RJ** | **Desconhecido** | Não há API pública documentada identificada; forma de acesso autorizada não definida pela Nett. Sem payload não há como afirmar. Compras do RJ publicadas no PNCP já entram pelo conector PNCP |
| **Trello** (board Nett) | **Não é fonte de oportunidades.** Cards só *referenciam* licitações, em texto ou link | Vínculo possível por regex do número de controle ou do link `pncp.gov.br/app/editais/{cnpj}/{ano}/{seq}`; ainda não validado: **sem credenciais e sem aprovação da responsável**. Nenhum código de Trello será escrito até a aprovação (conforme sua orientação) |
| Demais (ex.: portais estaduais/municipais próprios) | Desconhecido | Avaliar caso a caso; a regra "só por número de controle PNCP, sem correspondência aproximada" já os deixa fora da fusão se não o trouxerem |

## Observações para a ADR
- Fusão apenas por número de controle é viável para Compras.gov.br (módulo 14.133). Outros módulos do Compras.gov (Lei 8.666/legado) não foram testados e podem não trazer o campo: tratar como fonte distinta (sem fusão) até verificação.
- Prioridade de campos entre fontes (o PNCP vence; fonte menos confiável só preenche vazio) foi a regra usada no protótipo descartado; a ADR deve dizer se ela vale também para `canonicalKey` (`pncp:` prefixo) quando o registro nasce no Compras.gov.br: sugiro que sim, pois a chave é derivada do número de controle e não da fonte.
- Risco a registrar: duas fontes divergindo no mesmo campo (valor, datas) — definir qual vence e como auditar.

## Não verificado
- SIGA/RJ (sem acesso) e módulos do Compras.gov fora do 14.133.

## Próximo passo esperado
- Agente 01: fechar a ADR-020. Agente 02: nenhuma ação até o desbloqueio de T-205+.

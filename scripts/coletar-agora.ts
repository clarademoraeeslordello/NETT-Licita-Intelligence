/** Executa uma coleta imediata (sem esperar o agendador) e processa a fila até o orçamento. Uso operacional/diagnóstico. */
import { agendar } from '../src/agendador.js';
import { carregarConfig } from '../src/config/index.js';
import { fecharPool } from '../src/db/pool.js';
import { log } from '../src/observabilidade/log.js';
import { criarExecutor, executarCiclo } from '../src/worker.js';

const config = carregarConfig();
const executar = criarExecutor(config);
const criados = await agendar(config);
log('info', 'coletar_agora.agendado', { criados });
let rodada = 0;
while ((await executarCiclo(config, executar, 10)) > 0 && rodada < 500) rodada += 1;
await fecharPool();

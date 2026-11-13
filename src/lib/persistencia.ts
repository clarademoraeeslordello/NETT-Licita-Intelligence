/**
 * Resultados de análise gravados no banco.
 *
 * Em serverless cada requisição pode cair numa instância diferente: a que rodou
 * a análise guarda o job na memória, mas a página do relatório pode abrir em
 * outra. Por isso todo job concluído é gravado antes de ser anunciado como
 * pronto, e as leituras procuram primeiro na memória e depois no banco.
 */
import { bancoConfigurado, rpc } from './banco';
import { adoptJob, findByHash, getJob, type Job } from './store';

/** Grava o job concluído. Falha de banco não derruba a análise: só é registrada. */
export async function salvarJob(job: Job, hash?: string): Promise<void> {
  if (!bancoConfigurado() || !job.result) return;
  try {
    await rpc('arremate_salvar_analise', { p_id: job.id, p_hash: hash ?? null, p_job: job }, 15_000);
  } catch (error) {
    console.error('[editais] não foi possível gravar a análise no banco:', error);
  }
}

async function doBanco(funcao: string, parametros: Record<string, unknown>): Promise<Job | undefined> {
  if (!bancoConfigurado()) return undefined;
  try {
    const job = await rpc<Job | null>(funcao, parametros);
    return job?.result ? job : undefined;
  } catch (error) {
    console.error(`[editais] leitura de análise no banco falhou (${funcao}):`, error);
    return undefined;
  }
}

/** Job por id: memória desta instância ou banco (e passa a ficar em memória). */
export async function obterJob(id: string): Promise<Job | undefined> {
  const local = getJob(id);
  if (local) return local;
  const salvo = await doBanco('arremate_obter_analise', { p_id: id });
  return salvo ? adoptJob(salvo) : undefined;
}

/** Análise já concluída do mesmo PDF + motor, em qualquer instância. */
export async function obterPorHash(hash: string): Promise<Job | undefined> {
  const local = findByHash(hash);
  if (local?.result) return local;
  const salvo = await doBanco('arremate_analise_por_hash', { p_hash: hash });
  return salvo ? adoptJob(salvo, hash) : undefined;
}

/** Análise pronta por id, para o relatório e os downloads. */
export async function obterAnalise(id: string) {
  const job = await obterJob(id);
  return job?.result ? { job, analise: job.result.analise } : undefined;
}

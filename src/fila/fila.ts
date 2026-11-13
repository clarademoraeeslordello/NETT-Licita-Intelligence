/**
 * Fila persistente em PostgreSQL (FOR UPDATE SKIP LOCKED).
 *
 * - Jobs com a mesma `chave_dedupe` não se duplicam enquanto abertos.
 * - Falhas reagendam com backoff exponencial até `max_tentativas`; depois viram `morto`
 *   (permanecem na tabela para inspeção e reprocessamento manual — nada é descartado).
 * - Locks expirados (worker caiu) são devolvidos à fila.
 * - Tipos com orçamento por hora (ex.: processamento de oportunidades) só são entregues
 *   enquanto houver orçamento; o excedente aguarda na fila.
 */
import { hostname } from 'node:os';
import { emTransacao, obterPool, type Executor } from '../db/pool.js';

export type Job = {
  id: number;
  tipo: string;
  chave_dedupe: string | null;
  payload: Record<string, unknown>;
  tentativas: number;
  max_tentativas: number;
};

export type NovoJob = {
  tipo: string;
  payload?: Record<string, unknown>;
  chaveDedupe?: string;
  prioridade?: number;
  disponivelEm?: Date;
  maxTentativas?: number;
};

export const IDENTIDADE_WORKER = `${hostname()}:${process.pid}`;

/** Enfileira; devolve o id criado ou `null` se já houver job aberto com a mesma chave. */
export async function enfileirar(job: NovoJob, db: Executor = obterPool()): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO integracao.fila_job (tipo, payload, chave_dedupe, prioridade, disponivel_em, max_tentativas)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6)
     ON CONFLICT (chave_dedupe) WHERE status IN ('pendente','executando','falhou') DO NOTHING
     RETURNING id`,
    [job.tipo, job.payload ?? {}, job.chaveDedupe ?? null, job.prioridade ?? 100, job.disponivelEm ?? null, job.maxTentativas ?? 5],
  );
  return rows[0]?.id ?? null;
}

/**
 * Enfileira somente se NUNCA houve job com esta chave (em qualquer status). Usado no agendamento:
 * uma janela horária já coletada não é reagendada. Lock consultivo evita corrida entre workers.
 */
export async function enfileirarUnico(job: NovoJob & { chaveDedupe: string }): Promise<number | null> {
  return emTransacao(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [job.chaveDedupe]);
    const existe = await db.query('SELECT 1 FROM integracao.fila_job WHERE chave_dedupe = $1 LIMIT 1', [job.chaveDedupe]);
    return existe.rowCount ? null : enfileirar(job, db);
  });
}

export type Orcamentos = Record<string, number>;

/** Quantos jobs de cada tipo orçado foram concluídos (ou iniciados) na última hora. */
export async function usoNaUltimaHora(tipos: string[], db: Executor = obterPool()): Promise<Record<string, number>> {
  if (!tipos.length) return {};
  const { rows } = await db.query<{ tipo: string; n: number }>(
    `SELECT tipo, count(*)::int AS n FROM integracao.fila_job
      WHERE tipo = ANY($1)
        AND ((status = 'concluido' AND concluido_em > now() - interval '1 hour')
          OR (status = 'executando'))
      GROUP BY tipo`,
    [tipos],
  );
  return Object.fromEntries(rows.map((r) => [r.tipo, r.n]));
}

/**
 * Retira até `limite` jobs prontos. Tipos sem orçamento disponível são ignorados.
 * `leaseMs` define até quando o job fica reservado para este worker.
 */
export async function reservar(
  opcoes: { limite?: number; tipos?: string[]; orcamentos?: Orcamentos; leaseMs?: number; worker?: string } = {},
): Promise<Job[]> {
  const pool = obterPool();
  const orcamentos = opcoes.orcamentos ?? {};
  const uso = await usoNaUltimaHora(Object.keys(orcamentos));
  const bloqueados = Object.entries(orcamentos)
    .filter(([tipo, limite]) => (uso[tipo] ?? 0) >= limite)
    .map(([tipo]) => tipo);

  // Respeita o saldo exato de cada tipo orçado dentro deste lote.
  const saldoMin = Object.entries(orcamentos)
    .filter(([tipo]) => !bloqueados.includes(tipo))
    .map(([tipo, limite]) => limite - (uso[tipo] ?? 0));
  const limite = Math.max(1, Math.min(opcoes.limite ?? 5, ...(saldoMin.length ? saldoMin : [Infinity])));

  const { rows } = await pool.query<Job>(
    `WITH candidatos AS (
       SELECT id FROM integracao.fila_job
        WHERE status IN ('pendente','falhou') AND disponivel_em <= now()
          AND ($1::text[] IS NULL OR tipo = ANY($1))
          AND NOT (tipo = ANY($2::text[]))
        ORDER BY prioridade, disponivel_em, id
        LIMIT $3
        FOR UPDATE SKIP LOCKED)
     UPDATE integracao.fila_job j
        SET status = 'executando', tentativas = j.tentativas + 1, bloqueado_por = $4,
            bloqueado_ate = now() + ($5 || ' milliseconds')::interval,
            iniciado_em = now(), atualizado_em = now()
       FROM candidatos c WHERE j.id = c.id
     RETURNING j.id, j.tipo, j.chave_dedupe, j.payload, j.tentativas, j.max_tentativas`,
    [opcoes.tipos ?? null, bloqueados, limite, opcoes.worker ?? IDENTIDADE_WORKER, String(opcoes.leaseMs ?? 30 * 60_000)],
  );
  return rows;
}

export async function concluir(id: number): Promise<void> {
  await obterPool().query(
    `UPDATE integracao.fila_job SET status = 'concluido', concluido_em = now(), atualizado_em = now(),
            bloqueado_ate = NULL, bloqueado_por = NULL, ultimo_erro = NULL WHERE id = $1`,
    [id],
  );
}

/** Registra falha: reagenda com backoff ou marca como `morto` ao esgotar tentativas. */
export async function falhar(job: Job, erro: unknown, opcoes: { retentavel?: boolean } = {}): Promise<'reagendado' | 'morto'> {
  const mensagem = (erro instanceof Error ? erro.message : String(erro)).slice(0, 2000);
  const esgotou = job.tentativas >= job.max_tentativas || opcoes.retentavel === false;
  const atrasoS = Math.min(3600, 30 * 2 ** Math.max(0, job.tentativas - 1));
  await obterPool().query(
    `UPDATE integracao.fila_job
        SET status = $2, ultimo_erro = $3, atualizado_em = now(), bloqueado_ate = NULL, bloqueado_por = NULL,
            disponivel_em = now() + ($4 || ' seconds')::interval
      WHERE id = $1`,
    [job.id, esgotou ? 'morto' : 'falhou', mensagem, String(atrasoS)],
  );
  return esgotou ? 'morto' : 'reagendado';
}

/** Devolve à fila jobs cujo worker sumiu (lease expirado). */
export async function recuperarExpirados(): Promise<number> {
  const { rowCount } = await obterPool().query(
    `UPDATE integracao.fila_job SET status = 'falhou', ultimo_erro = 'lease expirado (worker interrompido)',
            bloqueado_ate = NULL, bloqueado_por = NULL, atualizado_em = now()
      WHERE status = 'executando' AND bloqueado_ate < now()`,
  );
  return rowCount ?? 0;
}

export async function estatisticasFila(): Promise<Array<{ tipo: string; status: string; quantidade: number; mais_antigo: string | null }>> {
  const { rows } = await obterPool().query(
    `SELECT tipo, status, count(*)::int AS quantidade, min(criado_em) AS mais_antigo
       FROM integracao.fila_job
      WHERE status <> 'concluido' OR concluido_em > now() - interval '24 hours'
      GROUP BY tipo, status ORDER BY tipo, status`,
  );
  return rows;
}

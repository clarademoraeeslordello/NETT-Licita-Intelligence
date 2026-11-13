import { getJob, toPublicJob, type Job } from '@/lib/store';

type Emitted = { sent: number };

/** Resposta em Server-Sent Events usada para transmitir o progresso. */
export function jobStreamResponse(job: Job): Response {
  const encoder = new TextEncoder();
  const emitted: Emitted = { sent: 0 };
  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeat) clearInterval(heartbeat);
    if (idleTimer) clearTimeout(idleTimer);
    pollTimer = null;
    heartbeat = null;
    idleTimer = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown, event = 'update') => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimers();
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      };

      const flush = (current: Job) => {
        for (let index = emitted.sent; index < current.events.length; index += 1) {
          const event = current.events[index];
          send({
            stage: event.stage,
            progress: event.progress,
            message: event.message,
            detail: event.detail ?? null,
            at: event.at,
            steps: current.steps,
            meta: current.meta,
            fileName: current.fileName,
            fileSize: current.fileSize,
            isDemo: current.isDemo,
          });
        }
        emitted.sent = current.events.length;
      };

      // Estado inicial imediato (evita tela vazia enquanto o primeiro evento chega).
      send({ type: 'state', job: toPublicJob(job) }, 'state');
      flush(job);

      if (job.stage === 'error') {
        send({ type: 'error', job: toPublicJob(job) }, 'error');
        finish();
        return;
      }

      // Resultado reaproveitado do cache (mesmo arquivo já analisado nesta
      // sessão): o pipeline já terminou, então sinalizamos a conclusão de
      // imediato. O cliente usa os metadados do job para exibir o aviso.
      if (job.stage === 'done' && job.result) {
        send({ type: 'done', jobId: job.id, stage: 'done', reused: true }, 'done');
        finish();
        return;
      }

      pollTimer = setInterval(() => {
        const current = getJob(job.id);
        if (!current) {
          send({ type: 'error', message: 'Análise não encontrada no servidor.' }, 'error');
          finish();
          return;
        }
        flush(current);

        if (current.stage === 'done' && current.result) {
          send({ type: 'done', jobId: current.id, stage: current.stage }, 'done');
          finish();
          return;
        }
        if (current.stage === 'error') {
          send({ type: 'error', job: toPublicJob(current) }, 'error');
          finish();
        }
      }, 220);

      heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 15_000);

      // Rede de segurança: se o pipeline ficar preso sem concluir (falha
      // inesperada em background), o cliente recebe um erro claro em vez de um
      // stream aberto indefinidamente.
      idleTimer = setTimeout(
        () => {
          if (closed) return;
          send(
            {
              type: 'error',
              message: 'A análise excedeu o tempo máximo de processamento.',
              hint: 'Tente novamente com um documento menor ou verifique os logs do servidor.',
            },
            'error',
          );
          finish();
        },
        15 * 60 * 1000,
      );
    },
    cancel() {
      closed = true;
      clearTimers();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

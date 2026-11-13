/**
 * API interna (Node http, sem framework — escolha de framework é do Agente 01).
 * O frontend (Agente 04) e a IA (Agente 03) consomem SOMENTE esta API; nunca os portais.
 *
 * Autenticação: `Authorization: Bearer <API_TOKEN_INTERNO>` em /v1/* e /metricas.
 * Sem token configurado, essas rotas respondem 503 (falha fechada).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TIPO_TRELLO_CARD } from '../agendador.js';
import { carregarConfig, trelloConfigurado, type Config } from '../config/index.js';
import { VERSAO_CONTRATO } from '../contrato/oportunidade.js';
import { salvarAcoes } from '../conectores/trello/sincronizacao.js';
import type { TrelloAction } from '../conectores/trello/cliente.js';
import { assinaturaValida } from '../conectores/trello/webhook.js';
import { obterPool } from '../db/pool.js';
import { enfileirar, estatisticasFila } from '../fila/fila.js';
import { criarConectores } from '../fontes.js';
import { log } from '../observabilidade/log.js';
import { exportarProcesso, incrementar } from '../observabilidade/metricas.js';
import * as q from '../repositorio/consultas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_CORPO = 1_000_000;

function json(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => {
      tamanho += p.length;
      if (tamanho > LIMITE_CORPO) {
        reject(new Error('corpo grande demais'));
        req.destroy();
      } else partes.push(p);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function autorizado(req: IncomingMessage, token: string): boolean {
  const recebido = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const a = Buffer.from(recebido);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const inteiro = (v: string | null, padrao: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

export function criarServidor(config: Config = carregarConfig()) {
  const { conectores } = criarConectores(config);

  async function webhookTrello(req: IncomingMessage, res: ServerResponse) {
    // Trello valida o callback com HEAD antes de criar o webhook.
    if (req.method === 'HEAD') return void res.writeHead(200).end();
    if (req.method !== 'POST') return json(res, 405, { erro: 'método não permitido' });
    const corpo = await lerCorpo(req);
    const ok = assinaturaValida(corpo, config.TRELLO_WEBHOOK_URL, config.TRELLO_APP_SECRET, req.headers['x-trello-webhook'] as string | undefined);
    let acao: TrelloAction | undefined;
    try {
      acao = (JSON.parse(corpo) as { action?: TrelloAction }).action;
    } catch {
      acao = undefined;
    }
    await obterPool().query(
      'INSERT INTO integracao.trello_webhook_recebido (action_id, tipo, card_id, assinatura_ok) VALUES ($1,$2,$3,$4)',
      [acao?.id ?? null, acao?.type ?? null, acao?.data?.card?.id ?? null, ok],
    );
    incrementar('trello_webhooks_total', { assinatura: ok ? 'valida' : 'invalida' });
    if (!ok) return json(res, 401, { erro: 'assinatura inválida' });
    if (acao?.id && acao.data?.board?.id) {
      const boardId = acao.data.board.id;
      const conhecido = (await obterPool().query('SELECT 1 FROM integracao.trello_board WHERE id_externo = $1', [boardId])).rowCount;
      if (conhecido) await salvarAcoes(obterPool(), boardId, [acao], 'webhook');
      const cardId = acao.data.card?.id;
      if (cardId) await enfileirar({ tipo: TIPO_TRELLO_CARD, chaveDedupe: `${TIPO_TRELLO_CARD}:${cardId}`, payload: { cardId }, prioridade: 15 });
    }
    return json(res, 200, { ok: true });
  }

  async function rotear(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://interno');
    const caminho = url.pathname.replace(/\/+$/, '') || '/';
    const s = url.searchParams;

    if (caminho === '/saude') {
      await obterPool().query('SELECT 1');
      return json(res, 200, { status: 'ok', versaoContrato: VERSAO_CONTRATO });
    }
    if (caminho === '/webhooks/trello') return webhookTrello(req, res);

    if (!config.API_TOKEN_INTERNO) return json(res, 503, { erro: 'API_TOKEN_INTERNO não configurado' });
    if (!autorizado(req, config.API_TOKEN_INTERNO)) return json(res, 401, { erro: 'não autorizado' });
    if (req.method !== 'GET') return json(res, 405, { erro: 'método não permitido' });

    if (caminho === '/metricas') {
      const fila = await estatisticasFila();
      const linhas = fila.map((f) => `nett_fila_jobs{tipo="${f.tipo}",status="${f.status}"} ${f.quantidade}`);
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      return void res.end(`${exportarProcesso()}\n${linhas.join('\n')}\n`);
    }
    if (caminho === '/v1/oportunidades') {
      return json(
        res,
        200,
        await q.listarOportunidades({
          q: s.get('q') ?? undefined,
          uf: s.get('uf') ?? undefined,
          modalidade: s.get('modalidade') ? Number(s.get('modalidade')) : undefined,
          fonte: s.get('fonte') ?? undefined,
          status: s.get('status') ?? undefined,
          abertas: s.get('abertas') === 'true',
          atualizadasDesde: s.get('atualizadasDesde') ?? undefined,
          pagina: inteiro(s.get('pagina'), 1, 1, 10_000),
          tamanho: inteiro(s.get('tamanho'), 30, 1, 100),
        }),
      );
    }
    const mOp = /^\/v1\/oportunidades\/([^/]+)(\/historico)?$/.exec(caminho);
    if (mOp) {
      if (!UUID.test(mOp[1]!)) return json(res, 400, { erro: 'id inválido' });
      const op = await q.obterOportunidade(mOp[1]!);
      if (!op) return json(res, 404, { erro: 'oportunidade não encontrada' });
      return json(res, 200, mOp[2] ? { id: op.id, origens: op.origens, historico: op.historico } : op);
    }
    if (caminho === '/v1/eventos') {
      return json(res, 200, { versaoContrato: VERSAO_CONTRATO, eventos: await q.listarEventos(inteiro(s.get('apos'), 0, 0, Number.MAX_SAFE_INTEGER), inteiro(s.get('limite'), 100, 1, 500), s.get('tipo') ?? undefined) });
    }
    if (caminho === '/v1/fontes') {
      const saude = await q.saudeFontes();
      return json(res, 200, {
        fontes: saude.map((f) => ({
          ...f,
          ativa: f.id === 'trello' ? trelloConfigurado(config) : config.FONTES_ATIVAS.includes(f.id),
          indisponibilidade: f.id === 'trello' ? (trelloConfigurado(config) ? null : 'credenciais Trello não configuradas') : (conectores.get(f.id)?.indisponibilidade() ?? null),
        })),
      });
    }
    if (caminho === '/v1/coletas') return json(res, 200, { execucoes: await q.listarExecucoes(s.get('fonte') ?? undefined, inteiro(s.get('limite'), 50, 1, 500)) });
    if (caminho === '/v1/fila') return json(res, 200, { fila: await estatisticasFila(), limiteProcessamentoHora: config.PROCESSAMENTO_LIMITE_HORA });
    if (caminho === '/v1/duplicatas') return json(res, 200, { duplicatas: await q.listarDuplicatas(s.get('status') ?? 'pendente', inteiro(s.get('limite'), 50, 1, 500)) });
    if (caminho === '/v1/trello/cards') return json(res, 200, { cards: await q.listarCardsTrello(s.get('lista') ?? undefined, inteiro(s.get('tamanho'), 50, 1, 200), inteiro(s.get('pagina'), 1, 1, 10_000)) });
    const mCard = /^\/v1\/trello\/cards\/([0-9a-f]{24})$/i.exec(caminho);
    if (mCard) {
      const card = await q.obterCardTrello(mCard[1]!);
      return card ? json(res, 200, card) : json(res, 404, { erro: 'card não encontrado' });
    }
    return json(res, 404, { erro: 'rota não encontrada' });
  }

  return createServer((req, res) => {
    const inicio = Date.now();
    rotear(req, res)
      .catch((erro) => {
        log('error', 'api.erro', { rota: req.url?.split('?')[0], erro });
        if (!res.headersSent) json(res, 500, { erro: 'erro interno' });
      })
      .finally(() => {
        incrementar('api_requisicoes_total', { status: res.statusCode });
        log('info', 'api.requisicao', { metodo: req.method, rota: req.url?.split('?')[0], status: res.statusCode, ms: Date.now() - inicio });
      });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = carregarConfig();
  criarServidor(config).listen(config.API_PORTA, () => log('info', 'api.inicio', { porta: config.API_PORTA }));
}

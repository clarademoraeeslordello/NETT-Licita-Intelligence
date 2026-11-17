/** T-406 — testes sem banco. Rodar: `npm run test:pipeline` */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AuthError, unauthenticated } from '../auth/errors';
import type { Session } from '../auth/session';
import type { Db } from '../db';
import { HttpError } from '../http/errors';
import { certificateCreateInput, certificateUpdateInput, STAGES_NEED_DECISION, trackingCreateInput, trackingListQuery, trackingUpdateInput } from './dto';
import { MAX_BODY, pipelineHandlers } from './handlers';

const id = '0190f5e2-7c1a-7cc3-9d2b-000000000001';

describe('DTOs do pipeline', () => {
  test('criação: só opportunityId e notas; empresa/usuário no corpo são recusados', () => {
    assert.equal(trackingCreateInput.safeParse({ opportunityId: id }).success, true);
    assert.equal(trackingCreateInput.safeParse({ opportunityId: id, companyId: id }).success, false);
    assert.equal(trackingCreateInput.safeParse({ opportunityId: 'x' }).success, false);
  });

  test('PATCH: exige ao menos um campo; valor monetário é string decimal; etapa fora do enum é recusada', () => {
    assert.equal(trackingUpdateInput.safeParse({}).success, false);
    assert.equal(trackingUpdateInput.safeParse({ proposalValue: '1200.50' }).success, true);
    assert.equal(trackingUpdateInput.safeParse({ proposalValue: 1200.5 }).success, false);
    assert.equal(trackingUpdateInput.safeParse({ stage: 'won' }).success, false);
    assert.equal(trackingUpdateInput.safeParse({ stage: 'proposal', bidDecisionReviewId: id }).success, true);
    assert.equal(trackingUpdateInput.safeParse({ companyId: id, notes: 'x' }).success, false);
  });

  test('etapas que exigem parecer: proposal, dispute e result', () => {
    assert.deepEqual([...STAGES_NEED_DECISION].sort(), ['dispute', 'proposal', 'result']);
  });

  test('listagem: includeDiscarded vira boolean; limite fora da faixa é recusado', () => {
    assert.equal(trackingListQuery.parse({ includeDiscarded: 'true' }).includeDiscarded, true);
    assert.equal(trackingListQuery.parse({}).includeDiscarded, false);
    assert.equal(trackingListQuery.safeParse({ limit: '999' }).success, false);
  });
});

describe('DTOs do cofre (só metadados)', () => {
  const ok = { title: 'CND Federal', category: 'fiscal', issuer: 'Receita Federal', issuedAt: '2026-11-01', validUntil: '2027-05-01' };
  test('aceita metadados; campos de arquivo e empresa não são aceitos', () => {
    assert.equal(certificateCreateInput.safeParse(ok).success, true);
    for (const extra of [{ storageKey: 'companies/x/y' }, { sha256: 'a'.repeat(64) }, { mimeType: 'application/pdf' }, { sizeBytes: 1 }, { companyId: id }, { kind: 'proposal' }])
      assert.equal(certificateCreateInput.safeParse({ ...ok, ...extra }).success, false, JSON.stringify(extra));
  });
  test('validade não pode ser anterior à emissão; URL de emissão só https', () => {
    assert.equal(certificateCreateInput.safeParse({ ...ok, validUntil: '2026-10-01' }).success, false);
    assert.equal(certificateCreateInput.safeParse({ ...ok, issueUrl: 'http://x.gov.br' }).success, false);
    assert.equal(certificateCreateInput.safeParse({ ...ok, issueUrl: 'javascript:alert(1)' }).success, false);
    assert.equal(certificateCreateInput.safeParse({ ...ok, issueUrl: 'https://x.gov.br/cnd' }).success, true);
    assert.equal(certificateCreateInput.safeParse({ ...ok, category: 'outra' }).success, false);
  });
  test('PATCH aceita subconjunto (renovar) e recusa vazio', () => {
    assert.equal(certificateUpdateInput.safeParse({ issuedAt: '2026-11-17', validUntil: '2027-05-17' }).success, true);
    assert.equal(certificateUpdateInput.safeParse({}).success, false);
    assert.equal(certificateUpdateInput.safeParse({ storageKey: 'x' }).success, false);
  });
});

/* ------------------------------- handlers (sem banco) ------------------------------- */
const session: Session = { id: 's', user: { id, email: 'c@exemplo.test', name: 'C' }, realmRoles: [], expiresAt: new Date() };
const noDb = () => {
  throw new Error('o banco não deveria ser tocado');
};
const ctx = { params: Promise.resolve({ companyId: id }) };
const itemCtx = (item: string) => ({ params: Promise.resolve({ companyId: id, id: item }) });
const req = (method: string, body?: string, qs = '') => new Request(`http://localhost/api/v1/companies/x/pipeline${qs}`, { method, body, headers: { origin: 'http://localhost' } });
const handlers = (over: Partial<Parameters<typeof pipelineHandlers>[0]> = {}) =>
  pipelineHandlers({ db: noDb as unknown as () => Db, requireSession: async () => session, authorize: async () => 'consultant', ...over });
const status = (p: Promise<unknown>) => p.then((r) => (r as Response).status, (e) => (e instanceof HttpError || e instanceof AuthError ? e.status : -1));

describe('handlers HTTP', () => {
  test('401 sem sessão em todos os métodos; o banco não é tocado', async () => {
    const h = handlers({ requireSession: async () => Promise.reject(unauthenticated()) });
    const calls = [
      h.listPipeline(req('GET'), ctx),
      h.createPipeline(req('POST', '{}'), ctx),
      h.patchPipeline(req('PATCH', '{}'), itemCtx(id)),
      h.listCertificates(req('GET'), ctx),
      h.createCertificate(req('POST', '{}'), ctx),
      h.patchCertificate(req('PATCH', '{}'), itemCtx(id)),
    ];
    for (const call of calls) assert.equal(await status(call), 401);
  });

  test('papel mínimo: leituras pedem viewer; escritas pedem consultant — conferido antes de ler o corpo', async () => {
    const asked: string[] = [];
    const h = handlers({
      authorize: async (_s, _c, role) => {
        asked.push(role);
        throw new AuthError('FORBIDDEN', 403, 'Acesso negado.');
      },
    });
    const calls = [
      h.listPipeline(req('GET'), ctx),
      h.listCertificates(req('GET'), ctx),
      h.createPipeline(req('POST', '{"lixo":'), ctx),
      h.patchPipeline(req('PATCH', '{'), itemCtx(id)),
      h.createCertificate(req('POST', '{'), ctx),
      h.patchCertificate(req('PATCH', '{'), itemCtx(id)),
    ];
    for (const c of calls) assert.equal(await status(c), 403);
    assert.deepEqual(asked, ['viewer', 'viewer', 'consultant', 'consultant', 'consultant', 'consultant']);
  });

  test('400 JSON quebrado, 422 corpo inválido, 413 corpo gigante', async () => {
    const h = handlers();
    assert.equal(await status(h.createPipeline(req('POST', '{"a":'), ctx)), 400);
    assert.equal(await status(h.createPipeline(req('POST', JSON.stringify({ opportunityId: 'x' })), ctx)), 422);
    assert.equal(await status(h.createCertificate(req('POST', JSON.stringify({ title: 'x', storageKey: 'y' })), ctx)), 422);
    assert.equal(await status(h.createPipeline(req('POST', 'x'.repeat(MAX_BODY + 1)), ctx)), 413);
  });

  test('id inválido no caminho → 404 sem tocar o banco; parâmetros de listagem inválidos → 422', async () => {
    const h = handlers();
    assert.equal(await status(h.patchPipeline(req('PATCH', '{"notes":"a"}'), itemCtx('nao-e-uuid'))), 404);
    assert.equal(await status(h.patchCertificate(req('PATCH', '{"title":"a"}'), itemCtx('nao-e-uuid'))), 404);
    assert.equal(await status(h.listPipeline(req('GET', undefined, '?limit=9999'), ctx)), 422);
  });
});

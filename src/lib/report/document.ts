/**
 * Geração do relatório profissional em HTML autocontido, otimizado para
 * impressão em A4 (usado tanto pelo "Salvar como PDF" do navegador quanto pelo
 * gerador headless do botão "Baixar PDF").
 *
 * Cuidados de tipografia/print:
 *  - fontes do sistema (sem dependência de rede na hora de imprimir);
 *  - `@page` com margens confiáveis e evita quebra no meio de blocos;
 *  - evidências acompanham a origem (página) e o trecho literal;
 *  - "Não identificado no documento." é usado em vez de campo vazio.
 */
import { config } from '../config';
import {
  NOT_FOUND_LABEL,
  evidenceText,
  isNotFound,
  type AnaliseEditais,
  type AttentionPoint,
  type ChecklistEntry,
  type Evidence,
  type SourcedItem,
  type TimelineEntry,
} from '../schema';
import type { AnalysisMeta } from '../schema';

/* ------------------------------- Utilidades ------------------------------- */

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
};

const STATUS_LABEL: Record<string, string> = {
  found: 'Encontrado no edital',
  inferred: 'Inferido',
  not_found: 'Não identificado',
};

function sourceBadge(source?: string | null): string {
  if (!source) return '';
  return `<span class="src">${escapeHtml(source)}</span>`;
}

function statusChip(evidence?: Evidence): string {
  const status = evidence?.status ?? 'not_found';
  return `<span class="chip chip-${status}">${STATUS_LABEL[status] ?? status}</span>`;
}

function evidenceBlock(evidence: Evidence | undefined, options: { quote?: boolean } = {}): string {
  const text = evidenceText(evidence);
  const missing = isNotFound(evidence);
  const quote = options.quote !== false && evidence?.quote ? String(evidence.quote) : '';
  const reason = evidence?.status === 'inferred' && evidence.reason ? String(evidence.reason) : '';

  return `
    <div class="ev ${missing ? 'ev-missing' : ''}">
      <div class="ev-value">${escapeHtml(text)} ${statusChip(evidence)} ${sourceBadge(evidence?.source)}</div>
      ${reason ? `<div class="ev-reason"><strong>Como foi deduzido:</strong> ${escapeHtml(reason)}</div>` : ''}
      ${quote ? `<blockquote class="ev-quote">“${escapeHtml(quote)}”</blockquote>` : ''}
    </div>`;
}

function renderList(items: SourcedItem[] | undefined, emptyLabel = 'Nenhum item identificado no documento.'): string {
  if (!items || items.length === 0) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return `<ul class="list">${items
    .map(
      (item) =>
        `<li><span class="li-text">${escapeHtml(item.text)}</span>${sourceBadge(item.source)}${
          item.status === 'inferred' ? '<span class="chip chip-inferred">Inferido</span>' : ''
        }</li>`,
    )
    .join('')}</ul>`;
}

function defRow(label: string, evidence: Evidence | undefined): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${evidenceBlock(evidence)}</td></tr>`;
}

function section(number: string, title: string, content: string, subtitle?: string): string {
  return `
  <section class="section">
    <header class="section-head">
      <span class="section-num">${escapeHtml(number)}</span>
      <div>
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="section-sub">${escapeHtml(subtitle)}</p>` : ''}
      </div>
    </header>
    ${content}
  </section>`;
}

/* ------------------------------ Seções do PDF ----------------------------- */

function coverPage(analise: AnaliseEditais, meta: AnalysisMeta): string {
  const orgao = evidenceText(analise.informacoesGerais.orgao);
  const numero = evidenceText(analise.informacoesGerais.numeroEdital);
  const modalidade = evidenceText(analise.informacoesGerais.modalidade);
  const engineLabel =
    meta.engine === 'deepseek' ? `Inteligência Artificial (${meta.model ?? 'DeepSeek'})` : 'Motor local de extração (demonstração)';

  return `
  <section class="cover">
    <div class="cover-top">
      <div class="brand">
        <div class="brand-mark">AI</div>
        <div>
          <div class="brand-name">${escapeHtml(config.app.name)}</div>
          <div class="brand-sub">Relatório de análise de edital de licitação</div>
        </div>
      </div>
      <div class="cover-meta">
        <div><span>Análise gerada em</span><strong>${escapeHtml(formatDateTime(analise.documento.dataAnalise))}</strong></div>
        <div><span>Motor de análise</span><strong>${escapeHtml(engineLabel)}</strong></div>
        <div><span>Documento</span><strong>${escapeHtml(analise.documento.paginas ?? 0)} páginas analisadas</strong></div>
      </div>
    </div>

    <div class="cover-body">
      <p class="eyebrow">Processo licitatório</p>
      <h1>${escapeHtml(orgao === NOT_FOUND_LABEL ? 'Órgão não identificado' : orgao)}</h1>
      <p class="cover-line">
        ${numero !== NOT_FOUND_LABEL ? `Edital <strong>${escapeHtml(numero)}</strong>` : 'Número do edital não identificado'}
        ${modalidade !== NOT_FOUND_LABEL ? ` · <strong>${escapeHtml(modalidade)}</strong>` : ''}
      </p>
      <p class="cover-object">${escapeHtml(
        analise.objeto.resumo === NOT_FOUND_LABEL
          ? 'Objeto não identificado automaticamente no documento.'
          : analise.objeto.resumo,
      )}</p>
    </div>

    <div class="cover-foot">
      <div class="cover-strip">
        <div><span>Valor estimado</span><strong>${escapeHtml(evidenceText(analise.valores.valorEstimado))}</strong></div>
        <div><span>Encerramento das propostas</span><strong>${escapeHtml(ultimoPrazo(analise.cronograma))}</strong></div>
        <div><span>Pontos de atenção</span><strong>${analise.pontosDeAtencao.filter((p) => p.nivel === 'alto').length} crítico(s)</strong></div>
        <div><span>Itens no objeto</span><strong>${analise.objeto.itens?.length ?? 0}</strong></div>
      </div>
      <p class="disclaimer">${escapeHtml(config.app.disclaimer)}</p>
    </div>
  </section>`;
}

function ultimoPrazo(cronograma: TimelineEntry[]): string {
  const alvo =
    cronograma.find((entry) => /encerramento|limite/i.test(entry.evento)) ??
    cronograma.find((entry) => /abertura|sess[ãa]o/i.test(entry.evento)) ??
    cronograma[cronograma.length - 1];
  if (!alvo) return NOT_FOUND_LABEL;
  return `${alvo.data}${alvo.hora ? ` às ${alvo.hora}` : ''}`;
}

function summarySection(analise: AnaliseEditais): string {
  const destaques = analise.resumoExecutivo.destaques
    .map(
      (item) =>
        `<li><span class="li-text">${escapeHtml(item.text)}</span>${sourceBadge(item.source)}</li>`,
    )
    .join('');

  return section(
    '1',
    'Resumo Executivo',
    `
    <p class="lead">${escapeHtml(analise.resumoExecutivo.visaoGeral)}</p>
    ${analise.resumoExecutivo.alertaPrazo ? `<div class="callout callout-warn"><strong>Alerta de prazo.</strong> ${escapeHtml(analise.resumoExecutivo.alertaPrazo)}</div>` : ''}
    ${destaques ? `<h3 class="sub">Destaques</h3><ul class="list list-strong">${destaques}</ul>` : ''}
    <h3 class="sub">Recomendação</h3>
    <p>${escapeHtml(analise.resumoExecutivo.recomendacao)}</p>
    ${
      analise.confianca
        ? `<div class="callout"><strong>Confiança da análise:</strong> ${escapeHtml(analise.confianca.nivel)} — ${escapeHtml(analise.confianca.justificativa)}</div>`
        : ''
    }
  `,
  );
}

function generalSection(analise: AnaliseEditais): string {
  const info = analise.informacoesGerais;
  return section(
    '2',
    'Informações Gerais',
    `
    <table class="table table-info">
      <tbody>
        ${defRow('Órgão / entidade', info.orgao)}
        ${defRow('Número do edital', info.numeroEdital)}
        ${defRow('Modalidade', info.modalidade)}
        ${defRow('Processo', info.processo)}
        ${defRow('Portal / plataforma', info.portal)}
        ${defRow('Local da disputa', info.localDisputa)}
        ${defRow('Critério de julgamento', info.criterioJulgamento)}
        ${defRow('Regime de execução', info.regimeExecucao)}
        ${defRow('Vigência do contrato', info.vigenciaContrato)}
        ${defRow('Objeto (declarado)', info.objeto)}
      </tbody>
    </table>`,
    'Situação de cada informação: encontrada no edital, inferida ou não identificada.',
  );
}

function scheduleSection(analise: AnaliseEditais): string {
  const rows = [...analise.cronograma, ...(analise.outrosPrazos ?? [])];
  if (!rows.length) {
    return section(
      '3',
      'Cronograma',
      `<p class="empty">Nenhuma data foi identificada automaticamente no documento. ${NOT_FOUND_LABEL}</p>`,
    );
  }
  const body = rows
    .map(
      (entry, index) => `
      <tr class="${/encerramento|limite/i.test(entry.evento) ? 'row-critical' : ''}">
        <td class="num">${index + 1}</td>
        <td><strong>${escapeHtml(entry.evento)}</strong>${entry.observacao ? `<div class="muted">${escapeHtml(entry.observacao)}</div>` : ''}</td>
        <td class="nowrap">${escapeHtml(entry.data)}${entry.hora ? ` <span class="muted">${escapeHtml(entry.hora)}</span>` : ''}</td>
        <td>${entry.status === 'inferred' ? '<span class="chip chip-inferred">Inferido</span>' : '<span class="chip chip-found">No edital</span>'}${sourceBadge(entry.source)}</td>
      </tr>`,
    )
    .join('');

  return section(
    '3',
    'Cronograma',
    `<table class="table">
      <thead><tr><th>#</th><th>Evento</th><th>Data</th><th>Origem</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="note">Linhas destacadas indicam marcos com consequência direta para a participação.</p>`,
    `${rows.length} marco(s) temporal(is) identificado(s).`,
  );
}

function objectSection(analise: AnaliseEditais): string {
  const itens = analise.objeto.itens ?? [];
  const itensTable = itens.length
    ? `<table class="table table-compact">
        <thead><tr><th>Item</th><th>Descrição</th><th>Qtd.</th><th>Un.</th><th>Valor unit.</th><th>Valor total</th><th>Lote</th></tr></thead>
        <tbody>${itens
          .map(
            (item) => `<tr>
              <td class="num">${escapeHtml(item.numero ?? '—')}</td>
              <td>${escapeHtml(item.descricao)}${item.especificacoes ? `<div class="muted">${escapeHtml(item.especificacoes)}</div>` : ''}${sourceBadge(item.source)}</td>
              <td class="nowrap">${escapeHtml(item.quantidade ?? '—')}</td>
              <td>${escapeHtml(item.unidade ?? '—')}</td>
              <td class="nowrap">${escapeHtml(item.valorUnitario ?? '—')}</td>
              <td class="nowrap">${escapeHtml(item.valorTotal ?? '—')}</td>
              <td>${escapeHtml(item.lote ?? '—')}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table>`
    : `<p class="empty">A estrutura de itens não foi identificada automaticamente. Consulte o termo de referência anexo. ${NOT_FOUND_LABEL}</p>`;

  return section(
    '4',
    'Objeto da Licitação',
    `
    <p class="lead">${escapeHtml(analise.objeto.resumo)}</p>
    <h3 class="sub">Descrição detalhada</h3>
    <p>${escapeHtml(analise.objeto.descricaoDetalhada)}</p>
    <h3 class="sub">Itens identificados</h3>
    ${itensTable}
    ${analise.objeto.lotes?.length ? `<h3 class="sub">Lotes / grupos</h3>${renderList(analise.objeto.lotes)}` : ''}
    ${analise.objeto.especificacoesTecnicas?.length ? `<h3 class="sub">Especificações técnicas relevantes</h3>${renderList(analise.objeto.especificacoesTecnicas)}` : ''}
  `,
    itens.length ? `${itens.length} item(ns) mapeado(s).` : undefined,
  );
}

function participationSection(analise: AnaliseEditais): string {
  const p = analise.participacao;
  const groups: Array<[string, SourcedItem[] | undefined]> = [
    ['Quem pode participar', p.quemPodeParticipar],
    ['Habilitação jurídica', p.habilitacaoJuridica],
    ['Habilitação fiscal e trabalhista', p.habilitacaoFiscalTrabalhista],
    ['Qualificação técnica', p.qualificacaoTecnica],
    ['Qualificação econômico-financeira', p.qualificacaoEconomicoFinanceira],
    ['Certidões exigidas', p.certidoes],
    ['Documentos exigidos', p.documentos],
    ['Restrições e impedimentos', p.restricoes],
    ['Exigências específicas', p.exigenciasEspecificas],
    ['Visita técnica / amostras', p.visitasOuAmostras],
  ];

  const rendered = groups
    .filter(([, items]) => items && items.length)
    .map(([title, items]) => `<h3 class="sub">${escapeHtml(title)}</h3>${renderList(items)}`)
    .join('');

  return section(
    '5',
    'Requisitos para Participação',
    `
    <table class="table table-info">
      <tbody>
        ${defRow('Consórcio', p.consorcio)}
        ${defRow('Tratamento diferenciado (ME/EPP)', p.meEpp)}
      </tbody>
    </table>
    ${rendered || `<p class="empty">Nenhum requisito de participação foi identificado automaticamente. ${NOT_FOUND_LABEL}</p>`}
  `,
    'Cada exigência traz a página de origem quando disponível.',
  );
}

function obligationsSection(analise: AnaliseEditais): string {
  const o = analise.obrigacoes;
  return section(
    '6',
    'Obrigações',
    `
    <table class="table table-info">
      <tbody>
        ${defRow('Prazo de execução', o.prazoExecucao)}
        ${defRow('Prazo de entrega', o.prazoEntrega)}
        ${defRow('Subcontratação', o.subcontratacao)}
      </tbody>
    </table>
    <h3 class="sub">Obrigações da contratada</h3>
    ${renderList(o.contratada, 'Nenhuma obrigação da contratada foi identificada automaticamente.')}
    <h3 class="sub">Obrigações da contratante</h3>
    ${renderList(o.contratante, 'Nenhuma obrigação da contratante foi identificada automaticamente.')}
    <h3 class="sub">Condições de pagamento</h3>
    ${renderList(o.condicoesPagamento, 'Condições de pagamento não identificadas automaticamente.')}
    <h3 class="sub">Garantias</h3>
    ${renderList(o.garantias, 'Nenhuma garantia exigida foi identificada automaticamente.')}
    <h3 class="sub">Penalidades e sanções</h3>
    ${renderList(o.penalidades?.length ? o.penalidades : o.sancoes, 'Nenhuma penalidade foi identificada automaticamente.')}
  `,
  );
}

function valuesSection(analise: AnaliseEditais): string {
  const v = analise.valores;
  const itens = v.itens ?? [];
  return section(
    '7',
    'Valores',
    `
    <div class="kpis">
      <div class="kpi"><span>Valor estimado</span><strong>${escapeHtml(evidenceText(v.valorEstimado))}</strong>${sourceBadge(v.valorEstimado?.source)}</div>
      <div class="kpi"><span>Valor máximo</span><strong>${escapeHtml(evidenceText(v.valorMaximo))}</strong>${sourceBadge(v.valorMaximo?.source)}</div>
      <div class="kpi"><span>Moeda</span><strong>${escapeHtml(v.moeda ?? 'BRL')}</strong></div>
    </div>
    ${v.valorEstimado?.quote ? `<blockquote class="ev-quote">“${escapeHtml(v.valorEstimado.quote)}”</blockquote>` : ''}
    ${
      itens.length
        ? `<h3 class="sub">Valores por item / lote</h3>
           <table class="table table-compact">
             <thead><tr><th>Item</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Valor total</th></tr></thead>
             <tbody>${itens
               .map(
                 (item) => `<tr>
                   <td class="num">${escapeHtml(item.numero ?? '—')}</td>
                   <td>${escapeHtml(item.descricao)}</td>
                   <td class="nowrap">${escapeHtml(item.quantidade ?? '—')}</td>
                   <td class="nowrap">${escapeHtml(item.valorUnitario ?? '—')}</td>
                   <td class="nowrap">${escapeHtml(item.valorTotal ?? '—')}</td>
                 </tr>`,
               )
               .join('')}</tbody>
           </table>`
        : `<p class="note">A planilha orçamentária detalhada não foi localizada no texto analisado. Valores por item podem estar em anexo separado.</p>`
    }
    ${v.observacoes?.length ? `<h3 class="sub">Observações financeiras</h3>${renderList(v.observacoes)}` : ''}
  `,
  );
}

const NIVEL_LABEL: Record<AttentionPoint['nivel'], string> = {
  alto: 'Atenção alta',
  medio: 'Atenção média',
  baixo: 'Atenção baixa',
};

function attentionSection(analise: AnaliseEditais): string {
  if (!analise.pontosDeAtencao.length) {
    return section(
      '8',
      'Pontos de Atenção',
      `<p class="empty">Nenhum ponto de atenção específico foi identificado automaticamente. Isso não significa ausência de risco: recomenda-se leitura humana das cláusulas de habilitação, penalidades e prazos. ${NOT_FOUND_LABEL}</p>`,
    );
  }
  const order: AttentionPoint['nivel'][] = ['alto', 'medio', 'baixo'];
  const sorted = [...analise.pontosDeAtencao].sort((a, b) => order.indexOf(a.nivel) - order.indexOf(b.nivel));

  const cards = sorted
    .map(
      (point) => `
      <article class="attention attention-${point.nivel}">
        <header>
          <span class="badge badge-${point.nivel}">${NIVEL_LABEL[point.nivel]}</span>
          <h3>${escapeHtml(point.titulo)}</h3>
          ${sourceBadge(point.source)}
        </header>
        <p>${escapeHtml(point.motivo)}</p>
        ${point.trecho ? `<blockquote class="ev-quote">“${escapeHtml(point.trecho)}”</blockquote>` : ''}
        ${point.recomendacao ? `<p class="rec"><strong>Ação recomendada:</strong> ${escapeHtml(point.recomendacao)}</p>` : ''}
      </article>`,
    )
    .join('');

  return section(
    '8',
    'Pontos de Atenção',
    cards,
    'Priorizados por impacto potencial sobre a participação.',
  );
}

function checklistSection(analise: AnaliseEditais): string {
  if (!analise.checklist.length) {
    return section(
      '9',
      'Checklist de Participação',
      `<p class="empty">Não foi possível montar o checklist automaticamente a partir deste documento. ${NOT_FOUND_LABEL}</p>`,
    );
  }
  const items = analise.checklist
    .map(
      (entry: ChecklistEntry) => `
      <li class="${entry.obrigatorio === false ? 'optional' : ''}">
        <span class="box" aria-hidden="true"></span>
        <span>
          <span class="li-text">${escapeHtml(entry.item)}</span>
          ${entry.obrigatorio === false ? '<span class="chip chip-inferred">Desejável</span>' : '<span class="chip chip-found">Obrigatório</span>'}
          ${entry.observacao ? `<div class="muted">${escapeHtml(entry.observacao)}</div>` : ''}
          ${sourceBadge(entry.source)}
        </span>
      </li>`,
    )
    .join('');

  return section(
    '9',
    'Checklist de Participação',
    `<ul class="checklist">${items}</ul>
     <p class="note">Checklist gerado a partir das exigências localizadas no documento. Deve ser confrontado com a leitura integral do edital.</p>`,
    `${analise.checklist.filter((entry) => entry.obrigatorio !== false).length} item(ns) obrigatório(s).`,
  );
}

function conclusionSection(analise: AnaliseEditais): string {
  return section(
    '10',
    'Conclusão',
    `
    <p class="lead">${escapeHtml(analise.conclusao.texto)}</p>
    <h3 class="sub">Próximos passos sugeridos</h3>
    ${renderList(analise.conclusao.proximosPassos, 'Nenhum próximo passo foi gerado.')}
    <h3 class="sub">Limitações desta análise</h3>
    ${renderList(
      analise.conclusao.limitacoesDaAnalise.map((text) => ({ text })),
      'Nenhuma limitação foi registrada.',
    )}
  `,
  );
}

/* ------------------------------- Documento -------------------------------- */

export function renderReportHtml(
  analise: AnaliseEditais,
  meta: AnalysisMeta,
  options: { forPrint?: boolean; generatedAt?: string } = {},
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const engineNote =
    meta.engine === 'deepseek'
      ? `Modelo ${escapeHtml(meta.model ?? 'DeepSeek')} · ${meta.llmCalls ?? 0} chamada(s) · ${(meta.tokensEstimados ?? 0).toLocaleString('pt-BR')} tokens · ${meta.chunks ?? 1} bloco(s)`
      : 'Motor local determinístico (demonstração sem IA generativa)';

  const warnings = meta.avisos.length
    ? `<div class="callout callout-warn"><strong>Observações do processamento.</strong><ul>${meta.avisos
        .map((aviso) => `<li>${escapeHtml(aviso)}</li>`)
        .join('')}</ul></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(config.app.name)} — ${escapeHtml(analise.documento.titulo)}</title>
<style>
  :root {
    --ink: #0f172a;
    --ink-soft: #334155;
    --muted: #64748b;
    --line: #e2e8f0;
    --line-strong: #cbd5e1;
    --bg-soft: #f8fafc;
    --brand: #1d4ed8;
    --brand-soft: #eff4ff;
    --danger: #b42318;
    --danger-soft: #fef3f2;
    --warn: #b54708;
    --warn-soft: #fffaeb;
    --ok: #067647;
    --ok-soft: #ecfdf3;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: #eef2f7;
    font-size: 11.5pt;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 210mm;
    margin: 0 auto;
    background: #fff;
    padding: 20mm 16mm 18mm;
  }
  h1, h2, h3 { line-height: 1.25; margin: 0; letter-spacing: -0.01em; }
  h1 { font-size: 26pt; }
  h2 { font-size: 16pt; }
  h3 { font-size: 11.5pt; }
  p { margin: 0 0 8px; }
  .muted { color: var(--muted); font-size: 9.5pt; }
  .nowrap { white-space: nowrap; }
  .note { color: var(--muted); font-size: 9.5pt; margin-top: 8px; }
  .empty { color: var(--muted); font-style: italic; background: var(--bg-soft); border: 1px dashed var(--line-strong); border-radius: 8px; padding: 10px 12px; }
  .lead { font-size: 12pt; color: var(--ink-soft); }
  .sub { margin: 16px 0 8px; color: var(--ink); border-bottom: 1px solid var(--line); padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.06em; font-size: 9.5pt; color: var(--muted); }

  /* Capa */
  .cover { display: flex; flex-direction: column; justify-content: space-between; min-height: 250mm; }
  .cover-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2px solid var(--ink); padding-bottom: 14px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .brand-mark { width: 42px; height: 42px; border-radius: 12px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; letter-spacing: 0.04em; }
  .brand-name { font-weight: 700; font-size: 12pt; }
  .brand-sub { color: var(--muted); font-size: 9.5pt; }
  .cover-meta { text-align: right; font-size: 9.5pt; color: var(--muted); }
  .cover-meta div { margin-bottom: 6px; }
  .cover-meta span { display: block; text-transform: uppercase; letter-spacing: 0.06em; font-size: 8pt; }
  .cover-meta strong { color: var(--ink); font-size: 10pt; font-weight: 600; }
  .cover-body { padding: 26mm 0 0; }
  .eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 9pt; color: var(--brand); font-weight: 600; margin-bottom: 10px; }
  .cover-line { color: var(--ink-soft); font-size: 12pt; margin-top: 12px; }
  .cover-object { margin-top: 18px; font-size: 11.5pt; color: var(--ink-soft); max-width: 150mm; }
  .cover-foot { border-top: 1px solid var(--line-strong); padding-top: 14px; }
  .cover-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .cover-strip div { background: var(--bg-soft); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  .cover-strip span { display: block; text-transform: uppercase; letter-spacing: 0.05em; font-size: 7.5pt; color: var(--muted); margin-bottom: 4px; }
  .cover-strip strong { font-size: 10pt; }
  .disclaimer { margin-top: 14px; font-size: 8.5pt; color: var(--muted); border-left: 3px solid var(--line-strong); padding-left: 10px; }

  /* Seções */
  .section { margin-top: 14mm; }
  .section-head { display: flex; gap: 12px; align-items: flex-start; border-bottom: 2px solid var(--ink); padding-bottom: 8px; margin-bottom: 14px; }
  .section-num { flex: none; width: 30px; height: 30px; border-radius: 9px; background: var(--brand-soft); color: var(--brand); font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 11pt; }
  .section-sub { color: var(--muted); font-size: 9.5pt; margin: 2px 0 0; }

  /* Tabelas */
  table.table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  table.table th, table.table td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.table thead th { background: var(--bg-soft); font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border-bottom: 1px solid var(--line-strong); }
  table.table tbody tr:nth-child(even) { background: #fcfdff; }
  .table-info th { width: 34%; color: var(--muted); font-weight: 600; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .table-compact { font-size: 9pt; }
  .table-compact th, .table-compact td { padding: 5px 7px; }
  .num { color: var(--muted); font-variant-numeric: tabular-nums; }
  .row-critical { background: var(--warn-soft) !important; }
  .row-critical td:first-child { border-left: 3px solid var(--warn); }

  /* Evidências */
  .ev { margin: 0; }
  .ev-value { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-weight: 500; }
  .ev-missing .ev-value { color: var(--muted); font-weight: 400; font-style: italic; }
  .ev-quote { margin: 6px 0 0; padding: 6px 10px; border-left: 3px solid var(--line-strong); background: var(--bg-soft); color: var(--ink-soft); font-size: 9pt; font-style: italic; }
  .ev-reason { margin-top: 4px; font-size: 9pt; color: var(--warn); }
  .src { display: inline-block; background: var(--brand-soft); color: var(--brand); border-radius: 999px; padding: 1px 8px; font-size: 8pt; font-weight: 600; white-space: nowrap; }
  .chip { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 8pt; font-weight: 600; white-space: nowrap; }
  .chip-found { background: var(--ok-soft); color: var(--ok); }
  .chip-inferred { background: var(--warn-soft); color: var(--warn); }
  .chip-not_found { background: #f1f5f9; color: var(--muted); }

  .list { list-style: none; margin: 0; padding: 0; }
  .list li { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed var(--line); page-break-inside: avoid; break-inside: avoid; }
  .list li:last-child { border-bottom: none; }
  .li-text { flex: 1 1 auto; min-width: 60%; }
  .list-strong .li-text { font-weight: 500; }

  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: #fff; }
  .kpi span { display: block; text-transform: uppercase; letter-spacing: 0.05em; font-size: 7.5pt; color: var(--muted); margin-bottom: 4px; }
  .kpi strong { font-size: 12pt; }

  .callout { border-radius: 10px; padding: 10px 12px; background: var(--brand-soft); border: 1px solid #d3e0ff; font-size: 10pt; margin: 10px 0; }
  .callout-warn { background: var(--warn-soft); border-color: #fde3ba; color: #7a3c05; }
  .callout ul { margin: 6px 0 0 16px; padding: 0; }

  .attention { border: 1px solid var(--line); border-left-width: 4px; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
  .attention header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 6px; }
  .attention h3 { margin: 0; flex: 1 1 auto; }
  .attention p { margin: 0; color: var(--ink-soft); }
  .attention-alto { border-left-color: var(--danger); background: linear-gradient(180deg, #fff, #fff8f7); }
  .attention-medio { border-left-color: var(--warn); background: linear-gradient(180deg, #fff, #fffdf7); }
  .attention-baixo { border-left-color: var(--brand); }
  .badge { border-radius: 999px; padding: 2px 9px; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge-alto { background: var(--danger-soft); color: var(--danger); }
  .badge-medio { background: var(--warn-soft); color: var(--warn); }
  .badge-baixo { background: var(--brand-soft); color: var(--brand); }
  .rec { margin-top: 8px !important; font-size: 10pt; }

  .checklist { list-style: none; margin: 0; padding: 0; }
  .checklist li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--line); page-break-inside: avoid; }
  .checklist .box { flex: none; width: 14px; height: 14px; border: 1.5px solid var(--line-strong); border-radius: 4px; margin-top: 3px; }
  .checklist li.optional .box { border-style: dashed; }
  .checklist .li-text { font-weight: 500; }

  .footer { margin-top: 12mm; border-top: 1px solid var(--line); padding-top: 10px; color: var(--muted); font-size: 8.5pt; display: flex; justify-content: space-between; gap: 16px; }

  @media print {
    body { background: #fff; font-size: 10.5pt; }
    .page { max-width: none; padding: 0; }
    @page { size: A4; margin: 16mm 14mm 14mm; }
    .section { margin-top: 10mm; }
    .section-head { page-break-after: avoid; }
    .cover { min-height: auto; page-break-after: always; height: 250mm; }
    h2, h3 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    .callout, .kpis { page-break-inside: avoid; }
    a[href]:after { content: ""; }
  }
</style>
</head>
<body>
  <div class="page">
    ${coverPage(analise, meta)}
    ${summarySection(analise)}
    ${generalSection(analise)}
    ${scheduleSection(analise)}
    ${objectSection(analise)}
    ${participationSection(analise)}
    ${obligationsSection(analise)}
    ${valuesSection(analise)}
    ${attentionSection(analise)}
    ${checklistSection(analise)}
    ${conclusionSection(analise)}
    <div class="footer">
      <div>
        <strong>${escapeHtml(config.app.name)}</strong> · versão ${escapeHtml(config.report.version)}<br />
        Documento analisado: ${escapeHtml(analise.documento.titulo)} · ${escapeHtml(String(analise.documento.paginas ?? 0))} páginas<br />
        ${engineNote}
      </div>
      <div style="text-align:right">
        Relatório gerado em ${escapeHtml(formatDateTime(generatedAt))}<br />
        Suporte à decisão — não substitui parecer jurídico.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Nome sugerido do arquivo PDF para download. */
export function reportFileName(analise: AnaliseEditais): string {
  const slug = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase();

  const orgao = isNotFound(analise.informacoesGerais.orgao)
    ? 'orgao'
    : slug(evidenceText(analise.informacoesGerais.orgao)) || 'orgao';
  const numero = isNotFound(analise.informacoesGerais.numeroEdital)
    ? ''
    : `-${slug(evidenceText(analise.informacoesGerais.numeroEdital))}`;

  return `analise-edital-${orgao}${numero}.pdf`;
}

export { formatDate as formatDateLabel, formatDateTime as formatDateTimeLabel };

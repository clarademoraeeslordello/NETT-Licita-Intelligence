/**
 * Conector SIGA/RJ (Sistema Integrado de Gestão de Aquisições do Estado do Rio de Janeiro).
 *
 * PENDENTE: não há API pública documentada identificada para o SIGA/RJ e a forma de acesso
 * autorizada (API, convênio, exportação ou credencial) ainda não foi definida pela Nett.
 * Raspagem do portal não é feita sem autorização expressa e análise dos termos de uso.
 * O conector existe para ocupar o lugar na arquitetura e reporta indisponibilidade de forma
 * explícita nas métricas e em /v1/fontes — não simula dados.
 *
 * Observação: compras estaduais do RJ publicadas no PNCP já são capturadas pelo conector PNCP.
 */
import type { ConectorLicitacoes, Pagina, Particao } from '../tipos.js';
import { FonteIndisponivel } from '../tipos.js';

export class ConectorSigaRj implements ConectorLicitacoes {
  readonly fonte = 'siga_rj' as const;

  constructor(private readonly habilitado: boolean) {}

  indisponibilidade(): string | null {
    return this.habilitado
      ? 'habilitado, mas sem implementação: forma de acesso autorizada ao SIGA/RJ não definida'
      : 'desabilitado: forma de acesso autorizada ao SIGA/RJ não definida (SIGA_RJ_HABILITADO=false)';
  }

  particoes(): Particao[] {
    return [];
  }

  async listarPagina(): Promise<Pagina> {
    throw new FonteIndisponivel(this.fonte, this.indisponibilidade() ?? 'indisponível');
  }
}

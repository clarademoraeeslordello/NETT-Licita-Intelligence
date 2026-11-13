/**
 * Radar: varre o PNCP pelos termos do perfil e devolve as oportunidades abertas.
 *
 * A nota de aderência NÃO é calculada aqui: o perfil vive no navegador do
 * usuário e a mesma resposta (em cache) serve perfis diferentes. O servidor faz
 * só o trabalho caro — buscar e deduplicar. O valor estimado não vem na busca
 * do PNCP; a tela o pede depois, em lotes, a /api/pncp/valores.
 */
import { AppError } from '../errors';
import { buscarEditais } from './api';
import { mapLimit } from './client';
import type { FonteDados, Oportunidade } from './types';
import { amostraOportunidades, AMOSTRA_CAPTURADA_EM } from './amostra';
import { contemTermo, normalizar } from '../plataforma/texto';

export type OportunidadeRadar = Oportunidade & { termos: string[] };

export type RadarResposta = {
  fonte: FonteDados;
  geradoEm: string;
  capturadoEm?: string;
  oportunidades: OportunidadeRadar[];
  avisos: string[];
};

export type RadarInput = {
  termos: string[];
  ufs: string[];
  modalidades: number[];
};

const MAX_TERMOS = 8;
const POR_TERMO = 25;

export function sanitizarRadarInput(input: Partial<RadarInput>): RadarInput {
  const termos = [...new Set((input.termos ?? []).map((termo) => termo.trim()).filter((termo) => termo.length >= 2))].slice(0, MAX_TERMOS);
  const ufs = [...new Set((input.ufs ?? []).map((uf) => uf.trim().toUpperCase()).filter((uf) => /^[A-Z]{2}$/.test(uf)))];
  const modalidades = [...new Set((input.modalidades ?? []).filter((id) => Number.isInteger(id) && id > 0 && id < 20))];
  return { termos, ufs, modalidades };
}

export async function executarRadar(input: RadarInput): Promise<RadarResposta> {
  if (input.termos.length === 0) {
    throw new AppError('BAD_REQUEST', 'Informe ao menos um termo de busca no perfil.', {
      status: 400,
      hint: 'Cadastre em Perfil os produtos ou serviços que a empresa fornece.',
    });
  }

  const avisos: string[] = [];
  const buscas = await mapLimit(input.termos, 3, (termo) =>
    buscarEditais({
      termo,
      status: 'recebendo_proposta',
      ufs: input.ufs,
      modalidades: input.modalidades,
      tamanho: POR_TERMO,
    }),
  );

  const falhas = buscas.filter((busca) => busca.status === 'rejected').length;
  if (falhas === buscas.length) return radarPorAmostra(input);
  if (falhas > 0) avisos.push(`${falhas} de ${buscas.length} buscas não responderam no PNCP; os resultados podem estar incompletos.`);

  const porId = new Map<string, OportunidadeRadar>();
  buscas.forEach((busca, indice) => {
    if (busca.status !== 'fulfilled') return;
    const termo = input.termos[indice];
    for (const oportunidade of busca.value.itens) {
      const existente = porId.get(oportunidade.id);
      if (existente) {
        if (!existente.termos.includes(termo)) existente.termos.push(termo);
      } else {
        porId.set(oportunidade.id, { ...oportunidade, termos: [termo] });
      }
    }
  });

  const agora = Date.now();
  const oportunidades = [...porId.values()]
    .filter((op) => !op.cancelado)
    .filter((op) => !op.encerramentoPropostas || new Date(op.encerramentoPropostas).getTime() > agora)
    .sort((a, b) => b.termos.length - a.termos.length || prazo(a) - prazo(b));

  return { fonte: 'pncp', geradoEm: new Date().toISOString(), oportunidades, avisos };
}

const prazo = (op: Oportunidade) =>
  op.encerramentoPropostas ? new Date(op.encerramentoPropostas).getTime() : Number.MAX_SAFE_INTEGER;

/** PNCP fora do ar: usa a amostra real versionada no projeto, sinalizada na interface. */
function radarPorAmostra(input: RadarInput): RadarResposta {
  const oportunidades: OportunidadeRadar[] = [];
  for (const op of amostraOportunidades) {
    const texto = normalizar(`${op.objeto} ${op.titulo}`);
    const termos = input.termos.filter((termo) => contemTermo(texto, termo));
    if (input.ufs.length && !input.ufs.includes(op.uf)) continue;
    oportunidades.push({ ...op, termos });
  }
  oportunidades.sort((a, b) => b.termos.length - a.termos.length);

  return {
    fonte: 'amostra',
    geradoEm: new Date().toISOString(),
    capturadoEm: AMOSTRA_CAPTURADA_EM,
    oportunidades,
    avisos: [
      'O PNCP não respondeu. Exibindo uma amostra real capturada anteriormente — prazos e situação podem ter mudado.',
    ],
  };
}

/**
 * Cota de análises com IA na demonstração pública.
 *
 * Cada pessoa tem AI_LIMITE_POR_USUARIO análises novas (padrão 3) a cada
 * AI_JANELA_HORAS (padrão 72 h), e a demo inteira tem um teto diário
 * (AI_LIMITE_DIARIO, padrão 25) que protege o saldo do provedor.
 *
 * "Pessoa" = IP OU navegador: a contagem soma o que bater em qualquer um dos
 * dois, então trocar de rede ou limpar o navegador sozinho não zera a cota.
 * O banco só recebe hashes com sal; o IP em claro nunca sai do servidor.
 *
 * O registro fica no Supabase (sobrevive a reinícios da função serverless).
 * Sem banco configurado — ou com ele fora do ar — cai para um contador em
 * memória, menos preciso, para a demo não parar.
 *
 * Resultados do cache (mesmo PDF) não consomem, e análises que não chegaram a
 * usar a IA (PDF inválido, provedor fora do ar) são estornadas.
 */
import { createHash } from 'node:crypto';
import { bancoConfigurado, rpc } from './banco';
import { AppError } from './errors';

const POR_USUARIO = Number(process.env.AI_LIMITE_POR_USUARIO ?? 3);
const JANELA_HORAS = Number(process.env.AI_JANELA_HORAS ?? 72);
const LIMITE_DIARIO = Number(process.env.AI_LIMITE_DIARIO ?? 25);

export type Identidade = { ip: string; dispositivo?: string | null };

export type Cota = { limite: number; restantes: number; janelaHoras: number; liberaEm: string | null };

/** Cabeçalho com o identificador aleatório que o navegador guarda no localStorage. */
export const CABECALHO_DISPOSITIVO = 'x-arremate-dispositivo';

export function identidadeDaRequisicao(request: Request): Identidade {
  const encaminhado = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const dispositivo = request.headers.get(CABECALHO_DISPOSITIVO)?.trim() ?? '';
  return {
    ip: encaminhado || request.headers.get('x-real-ip') || 'desconhecido',
    dispositivo: /^[a-z0-9-]{16,64}$/i.test(dispositivo) ? dispositivo : null,
  };
}

const hash = (valor: string) =>
  createHash('sha256').update(`${process.env.ARREMATE_SAL_IP ?? 'arremate'}:${valor}`).digest('hex').slice(0, 32);

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

function erroUsuario(liberaEm: string | null): AppError {
  return new AppError(
    'LIMITE_ATINGIDO',
    `Você já usou suas ${POR_USUARIO} análises com IA dos últimos ${Math.round(JANELA_HORAS / 24)} dias.`,
    {
      status: 429,
      hint: `${liberaEm ? `A próxima libera em ${dataHora(liberaEm)}. ` : ''}O limite existe porque a demonstração é pública. O edital de demonstração continua liberado.`,
    },
  );
}

function erroGlobal(): AppError {
  return new AppError('LIMITE_ATINGIDO', 'A cota diária de análises com IA da demonstração acabou.', {
    status: 429,
    hint: 'Tente novamente amanhã. O edital de demonstração continua liberado.',
  });
}

/* ------------------------- contador em memória (reserva) ------------------------- */

type Estado = { porChave: Map<string, number[]>; global: number[] };
const ref = globalThis as unknown as { __limiteIa?: Estado };
const memoria: Estado = ref.__limiteIa ?? (ref.__limiteIa = { porChave: new Map(), global: [] });

function consumirEmMemoria(quem: Identidade, agora = Date.now()): void {
  const janela = JANELA_HORAS * 3_600_000;
  const chaves = [quem.ip, quem.dispositivo].filter(Boolean) as string[];
  memoria.global = memoria.global.filter((t) => agora - t < 86_400_000);
  const usos = [...new Set(chaves.flatMap((c) => (memoria.porChave.get(c) ?? []).filter((t) => agora - t < janela)))].sort();

  if (usos.length >= POR_USUARIO) throw erroUsuario(new Date(usos[0] + janela).toISOString());
  if (memoria.global.length >= LIMITE_DIARIO) throw erroGlobal();

  for (const c of chaves) memoria.porChave.set(c, [...(memoria.porChave.get(c) ?? []), agora]);
  memoria.global.push(agora);
  if (memoria.porChave.size > 5000) memoria.porChave.clear();
}

/* ----------------------------------- API ----------------------------------- */

/**
 * Registra uma análise nova com IA ou lança LIMITE_ATINGIDO.
 * Devolve o id do registro (para estorno) ou null quando contou em memória.
 */
export async function consumirAnalise(quem: Identidade): Promise<number | null> {
  if (bancoConfigurado()) {
    try {
      const r = await rpc<{ ok: boolean; id?: number; motivo?: string; libera_em?: string }>('arremate_consumir', {
        p_ip: hash(quem.ip),
        p_disp: quem.dispositivo ? hash(quem.dispositivo) : null,
        p_limite: POR_USUARIO,
        p_janela_horas: JANELA_HORAS,
        p_limite_diario: LIMITE_DIARIO,
      });
      if (r.ok) return r.id ?? null;
      throw r.motivo === 'global' ? erroGlobal() : erroUsuario(r.libera_em ?? null);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('[editais] cota no banco indisponível, usando memória:', error);
    }
  }
  consumirEmMemoria(quem);
  return null;
}

/** Devolve a cota de uma análise que não chegou a usar a IA. */
export async function estornarAnalise(id: number | null): Promise<void> {
  if (id === null || !bancoConfigurado()) return;
  await rpc('arremate_estornar', { p_id: id }).catch((error) => console.error('[editais] estorno de cota falhou:', error));
}

/** Situação da cota para exibir na interface. */
export async function consultarCota(quem: Identidade): Promise<Cota> {
  const base: Cota = { limite: POR_USUARIO, restantes: POR_USUARIO, janelaHoras: JANELA_HORAS, liberaEm: null };
  if (!bancoConfigurado()) return base;
  try {
    const r = await rpc<{ restantes: number; libera_em: string | null }>('arremate_cota', {
      p_ip: hash(quem.ip),
      p_disp: quem.dispositivo ? hash(quem.dispositivo) : null,
      p_limite: POR_USUARIO,
      p_janela_horas: JANELA_HORAS,
    });
    return { ...base, restantes: r.restantes, liberaEm: r.libera_em };
  } catch {
    return base;
  }
}

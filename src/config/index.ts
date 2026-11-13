import { z } from 'zod';

const lista = (valor: string) =>
  valor
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);

const numeros = (valor: string) => lista(valor).map(Number).filter(Number.isFinite);

const Esquema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  API_PORTA: z.coerce.number().int().positive().default(3200),
  API_TOKEN_INTERNO: z.string().default(''),
  COLETA_INTERVALO_MIN: z.coerce.number().int().positive().default(60),
  PROCESSAMENTO_LIMITE_HORA: z.coerce.number().int().positive().default(50),
  COLETA_JANELA_DIAS: z.coerce.number().int().min(0).max(7).default(1),
  FONTES_ATIVAS: z.string().default('pncp,comprasgov').transform(lista),
  PNCP_MODALIDADES: z.string().default('4,6,8').transform(numeros),
  COMPRASGOV_MODALIDADES: z.string().default('5,6').transform(numeros),
  DICIONARIO_COMERCIAL_ARQUIVO: z.string().default('config/dicionario-comercial.json'),
  TRELLO_API_KEY: z.string().default(''),
  TRELLO_TOKEN: z.string().default(''),
  TRELLO_BOARD_ID: z.string().default(''),
  TRELLO_APP_SECRET: z.string().default(''),
  TRELLO_WEBHOOK_URL: z.string().default(''),
  SIGA_RJ_HABILITADO: z
    .string()
    .default('false')
    .transform((valor) => valor === 'true'),
});

export type Config = z.infer<typeof Esquema>;

let cache: Config | null = null;

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cache && env === process.env) return cache;
  const config = Esquema.parse(env);
  if (env === process.env) cache = config;
  return config;
}

export const trelloConfigurado = (config: Config) =>
  Boolean(config.TRELLO_API_KEY && config.TRELLO_TOKEN && config.TRELLO_BOARD_ID);

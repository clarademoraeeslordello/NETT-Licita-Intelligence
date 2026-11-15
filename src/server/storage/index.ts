/**
 * ObjectStorage S3-compatível (ADR-007; local: SeaweedFS, ADR-015). Interface em CONTRACTS.md §5.
 *
 * Regras:
 *  - Chaves só nos formatos `public/<opportunityId>/<sha256>.<ext>` e `companies/<companyId>/<uuid>.<ext>`
 *    (CONTRACTS.md, documents.ts). Nada de `..`, barra inicial ou caracteres de controle.
 *  - URL assinada expira em no máximo 600 s e só deve ser emitida APÓS a authz do chamador
 *    (rota `GET /api/v1/documents/{id}/download`, T-203/T-204). Este módulo não faz authz.
 *  - Credenciais vêm do ambiente e nunca são registradas em log.
 */
import { createHash } from 'node:crypto';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<{ sha256: string; sizeBytes: number }>;
  get(key: string): Promise<Uint8Array>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>; // ttl ≤ 600
}

export const MAX_SIGNED_URL_TTL_SECONDS = 600;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXT = '(?:\\.[a-z0-9]{1,10})?';
const KEY_PATTERNS = [
  new RegExp(`^public/${UUID}/[a-f0-9]{64}${EXT}$`),
  new RegExp(`^companies/${UUID}/${UUID}${EXT}$`),
  // Texto extraído (agente 03, `textStorageKey`) segue a mesma partição pública/privada.
  new RegExp(`^public/${UUID}/[a-f0-9]{64}\\.text/\\d{1,5}\\.txt$`),
  new RegExp(`^companies/${UUID}/${UUID}\\.text/\\d{1,5}\\.txt$`),
];

export class InvalidStorageKey extends Error {
  constructor(key: string) {
    super(`chave de storage fora do formato permitido: ${JSON.stringify(key.slice(0, 120))}`);
    this.name = 'InvalidStorageKey';
  }
}

export class ObjectNotFound extends Error {
  constructor(readonly key: string) {
    super(`objeto não encontrado: ${key}`);
    this.name = 'ObjectNotFound';
  }
}

export function assertValidKey(key: string): void {
  if (!KEY_PATTERNS.some((re) => re.test(key))) throw new InvalidStorageKey(key);
}

export function publicKey(opportunityId: string, sha256: string, ext: string): string {
  const key = `public/${opportunityId}/${sha256}${ext ? `.${ext.replace(/^\./, '').toLowerCase()}` : ''}`;
  assertValidKey(key);
  return key;
}

export function companyKey(companyId: string, objectId: string, ext: string): string {
  const key = `companies/${companyId}/${objectId}${ext ? `.${ext.replace(/^\./, '').toLowerCase()}` : ''}`;
  assertValidKey(key);
  return key;
}

export const sha256Hex = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');

export type S3StorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3StorageConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} não configurada`);
    return v;
  };
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || 'us-east-1',
    bucket: need('S3_BUCKET'),
    accessKeyId: need('S3_ACCESS_KEY_ID'),
    secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  };
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Compatibilidade com servidores S3 não-AWS (SeaweedFS/Railway): checksum só quando exigido.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<{ sha256: string; sizeBytes: number }> {
    assertValidKey(key);
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) throw new Error(`content-type inválido: ${contentType}`);
    const sha256 = sha256Hex(body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
        Metadata: { sha256 },
      }),
    );
    return { sha256, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!res.Body) throw new ObjectNotFound(key);
      return await res.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') throw new ObjectNotFound(key);
      throw error;
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertValidKey(key);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_SIGNED_URL_TTL_SECONDS) {
      throw new RangeError(`ttlSeconds deve estar entre 1 e ${MAX_SIGNED_URL_TTL_SECONDS}`);
    }
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
}

const g = globalThis as unknown as { __nettStorage?: ObjectStorage };

export function getStorage(): ObjectStorage {
  return (g.__nettStorage ??= new S3ObjectStorage(s3ConfigFromEnv()));
}

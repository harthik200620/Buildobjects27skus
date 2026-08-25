/**
 * MediaStore — the ONLY seam the AWS move touches. Keys are S3-shaped from day one
 * (`skus/{xx}/{code}/img/1-card.webp`); the local implementation writes them under
 * MEDIA_ROOT, the S3 implementation PUTs them to a bucket. `getUrl` = MEDIA_BASE_URL + key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config';

export interface MediaStore {
  put(key: string, buf: Buffer, contentType?: string): Promise<void>;
  getUrl(key: string): string;
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<Buffer>;
}

export class LocalMediaStore implements MediaStore {
  constructor(
    private root = env.mediaRoot,
    private base = env.mediaBaseUrl,
  ) {}
  private file(key: string) {
    return path.join(this.root, key);
  }
  async put(key: string, buf: Buffer) {
    const f = this.file(key);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, buf);
  }
  getUrl(key: string) {
    return `${this.base.replace(/\/$/, '')}/${key}`;
  }
  async exists(key: string) {
    try {
      await fs.promises.access(this.file(key));
      return true;
    } catch {
      return false;
    }
  }
  async read(key: string) {
    return fs.promises.readFile(this.file(key));
  }
}

/**
 * S3 implementation — wired, not exercised locally. Uses the AWS SDK v3 loaded lazily so
 * the dependency is optional until the lift. Env: S3_BUCKET, S3_REGION (+ standard AWS creds).
 */
export class S3MediaStore implements MediaStore {
  private client: unknown = null;
  constructor(
    private bucket = process.env.S3_BUCKET ?? '',
    private region = process.env.S3_REGION ?? 'ap-south-1',
    private base = env.mediaBaseUrl,
  ) {
    if (!this.bucket) throw new Error('MEDIA_STORE=s3 requires S3_BUCKET');
  }
  private async sdk() {
    if (!this.client) {
      const mod = await import('@aws-sdk/client-s3' as string).catch(() => {
        throw new Error('pnpm add @aws-sdk/client-s3 -F @buildobjects/pipeline to use MEDIA_STORE=s3');
      });
      this.client = new mod.S3Client({ region: this.region });
      return { mod, client: this.client as InstanceType<typeof mod.S3Client> };
    }
    const mod = await import('@aws-sdk/client-s3' as string);
    return { mod, client: this.client as InstanceType<typeof mod.S3Client> };
  }
  async put(key: string, buf: Buffer, contentType = 'application/octet-stream') {
    const { mod, client } = await this.sdk();
    await client.send(
      new mod.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
    );
  }
  getUrl(key: string) {
    return `${this.base.replace(/\/$/, '')}/${key}`;
  }
  async exists(key: string) {
    const { mod, client } = await this.sdk();
    try {
      await client.send(new mod.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async read(key: string) {
    const { mod, client } = await this.sdk();
    const r = await client.send(new mod.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

let store: MediaStore | null = null;
export function mediaStore(): MediaStore {
  if (!store) store = env.mediaStore === 's3' ? new S3MediaStore() : new LocalMediaStore();
  return store;
}

/**
 * Polite HTTP: one in-flight request per host at a time with a minimum spacing, bounded
 * retries with exponential backoff, size caps, and a browser-like UA. Shared by every stage
 * so the BullMQ and local drivers behave identically toward brand CDNs.
 */
import { createHash } from 'node:crypto';
import { env } from '../config';

const lastByHost = new Map<string, number>();
const queues = new Map<string, Promise<void>>();
/**
 * What Chrome sends when it fetches an image. A bare `image/*` is refused outright by some
 * WAF configurations — Somany's asset CDN answers 406 to it and 200 to this — and every
 * server that accepts `image/*` accepts this too, so there is no reason to send anything else.
 */
export const ACCEPT_IMAGE = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 BuildObjectsBot/1.0 (+catalogue ingestion; contact: ops@buildobjects.local)';

export async function politely<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).host;
  const prev = queues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  queues.set(
    host,
    prev.then(() => gate),
  );
  await prev;
  try {
    const wait = (lastByHost.get(host) ?? 0) + env.politenessMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return await fn();
  } finally {
    lastByHost.set(host, Date.now());
    release();
  }
}

export interface FetchOpts {
  timeoutMs?: number;
  maxBytes?: number;
  attempts?: number;
  accept?: string;
}

export async function head(
  url: string,
  opts: FetchOpts = {},
): Promise<{ ok: boolean; status: number; contentType: string; contentLength: number | null; finalUrl: string }> {
  return politely(url, async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    try {
      let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: opts.accept ?? '*/*' } });
      // 405 = HEAD unsupported, 403/406 = the CDN dislikes a bare HEAD or a narrow Accept.
      if (res.status === 405 || res.status === 403 || res.status === 406)
        res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: ctrl.signal,
          headers: {
            'user-agent': UA,
            accept: opts.accept ? `${opts.accept},image/avif,image/webp,*/*;q=0.8` : '*/*',
            range: 'bytes=0-0',
          },
        });
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        contentLength: res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null,
        finalUrl: res.url,
      };
    } catch (_e) {
      return { ok: false, status: 0, contentType: '', contentLength: null, finalUrl: url };
    } finally {
      clearTimeout(t);
    }
  });
}

/** GET with retries; resolves to the body buffer + content-type. Throws after the last attempt. */
export async function download(url: string, opts: FetchOpts = {}): Promise<{ buf: Buffer; contentType: string; finalUrl: string }> {
  const attempts = opts.attempts ?? 3;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await politely(url, async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? env.fetchTimeoutMs);
        try {
          const res = await fetch(url, {
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'user-agent': UA, accept: opts.accept ?? '*/*', 'accept-language': 'en-IN,en;q=0.9' },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const max = opts.maxBytes ?? 60 * 1024 * 1024;
          const len = Number(res.headers.get('content-length') ?? 0);
          if (len > max) throw new Error(`too large: ${len} bytes`);
          const ab = await res.arrayBuffer();
          if (ab.byteLength > max) throw new Error(`too large: ${ab.byteLength} bytes`);
          return { buf: Buffer.from(ab), contentType: res.headers.get('content-type') ?? '', finalUrl: res.url };
        } finally {
          clearTimeout(t);
        }
      });
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'file'
  );
}

export const sha1 = (buf: Buffer | string): string => createHash('sha1').update(buf).digest('hex');

/** Thin fetch wrapper shared by the provider adapters: status → ProviderError mapping, JSON parsing, binary downloads. */
import { ProviderError, type ProviderErrorCode, type ProviderName } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const resolveFetch = (f?: FetchLike): FetchLike => f ?? ((input, init) => globalThis.fetch(input, init));

export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 600);
  } catch {
    return '';
  }
}

export interface JsonRequest {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
}

export async function requestJson<T = Record<string, unknown>>(provider: ProviderName, fetchImpl: FetchLike, url: string, req: JsonRequest): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) };
  let body: BodyInit | undefined = req.body;
  if (req.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(req.json);
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { method: req.method, headers, body, signal: AbortSignal.timeout(req.timeoutMs ?? 60_000) });
  } catch (e) {
    throw new ProviderError(provider, 'network', `${provider}: ${req.method} ${url} failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await bodyText(res);
    let message = text;
    try {
      const j = JSON.parse(text);
      message = j.message ?? j.error ?? j.msg ?? text;
    } catch {
      /* plain text */
    }
    throw new ProviderError(
      provider,
      codeForStatus(res.status),
      `${provider}: HTTP ${res.status} on ${req.method} ${url}${message ? ` — ${message}` : ''}`,
      res.status,
    );
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, 'server', `${provider}: non-JSON response from ${url}: ${text.slice(0, 200)}`, res.status);
  }
}

export async function fetchBuffer(provider: ProviderName, fetchImpl: FetchLike, url: string, timeoutMs = 300_000): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ProviderError(provider, 'network', `${provider}: download failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ProviderError(provider, codeForStatus(res.status), `${provider}: HTTP ${res.status} downloading ${url}`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

export const dataUri = (buffer: Buffer, mime: string) => `data:${mime};base64,${buffer.toString('base64')}`;

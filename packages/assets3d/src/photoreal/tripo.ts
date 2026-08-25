/**
 * Tripo adapter — https://api.tripo3d.ai/v2/openapi
 *   POST /upload (multipart `file`)                        → { code: 0, data: { image_token } }
 *   POST /task   { type: 'image_to_model', file: { type, file_token }, model_version, pbr, texture, texture_quality, face_limit, orientation }
 *   POST /task   { type: 'multiview_to_model', files: [front, left, back, right] }   (missing views are `{}`; front is required)
 *   GET  /task/{id} → { code: 0, data: { status: queued|running|success|failed|cancelled|unknown|banned|expired, progress, output: { pbr_model, model, base_model, rendered_image } } }
 * Auth: `Authorization: Bearer TRIPO_API_KEY`. Every response wraps `{ code, data }`; a non-zero code is an error.
 */
import { type FetchLike, fetchBuffer, requestJson, resolveFetch } from './http';
import { type JobHandle, type JobState, type JobStatus, type Provider3D, ProviderError, type SubmitImage, type SubmitInput } from './types';

export const TRIPO_BASE_URL = 'https://api.tripo3d.ai/v2/openapi';
/** ≈ 30 / 45 credits per textured PBR task at ≈ $0.01 per credit (list price, Aug 2026). Estimate only — feeds --max-spend. */
export const TRIPO_COST_USD = { single: 0.3, multi: 0.45 } as const;
export const TRIPO_DEFAULT_MODEL_VERSION = 'v2.5-20250123';

const STATE: Record<string, JobState> = {
  queued: 'pending',
  running: 'running',
  success: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
  canceled: 'canceled',
  expired: 'expired',
  unknown: 'failed',
  banned: 'failed',
};

type Envelope<T> = { code?: number; message?: string; data?: T };

export interface TripoConfig {
  apiKey: string;
  modelVersion?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export class TripoProvider implements Provider3D {
  readonly name = 'tripo' as const;
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  constructor(private readonly cfg: TripoConfig) {
    if (!cfg.apiKey) throw new ProviderError('tripo', 'auth', 'TRIPO_API_KEY is not set');
    this.fetchImpl = resolveFetch(cfg.fetch);
    this.base = (cfg.baseUrl ?? TRIPO_BASE_URL).replace(/\/$/, '');
  }
  get modelVersion(): string {
    return this.cfg.modelVersion ?? (process.env.TRIPO_MODEL_VERSION?.trim() || TRIPO_DEFAULT_MODEL_VERSION);
  }
  private headers() {
    return { Authorization: `Bearer ${this.cfg.apiKey}` };
  }

  private unwrap<T>(env: Envelope<T>, what: string): T {
    if (env.code !== undefined && env.code !== 0) {
      const msg = env.message ?? `code ${env.code}`;
      const code = /balance|credit|quota|insufficient/i.test(msg) ? 'quota' : /token|auth|key/i.test(msg) ? 'auth' : 'bad_request';
      throw new ProviderError('tripo', code, `tripo: ${what} failed — ${msg}`);
    }
    if (!env.data) throw new ProviderError('tripo', 'server', `tripo: ${what} returned no data`);
    return env.data;
  }

  /** Multipart upload → image token, referenced by the task as `file_token`. */
  async upload(img: SubmitImage): Promise<string> {
    const ext = img.mime === 'image/png' ? 'png' : 'jpg';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(img.buffer)], { type: img.mime }), `${(img.key ?? img.role).replace(/[^A-Za-z0-9_-]+/g, '_')}.${ext}`);
    const env = await requestJson<Envelope<{ image_token?: string }>>('tripo', this.fetchImpl, `${this.base}/upload`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    const data = this.unwrap(env, 'upload');
    if (!data.image_token) throw new ProviderError('tripo', 'server', 'tripo: upload returned no image_token');
    return data.image_token;
  }

  /** Multi-view needs at least one labelled side view; unlabelled extras cannot be placed, so they fall back to single. */
  isMulti(input: Pick<SubmitInput, 'mode' | 'images'>): boolean {
    return input.mode === 'multi' && input.images.some((i) => i.role === 'left' || i.role === 'back' || i.role === 'right');
  }

  async submit(input: SubmitInput): Promise<JobHandle> {
    if (!input.images.length) throw new ProviderError('tripo', 'bad_request', `${input.sku}: no images to submit`);
    const front = input.images.find((i) => i.role === 'front') ?? input.images[0];
    const side = (role: 'left' | 'back' | 'right') => input.images.find((i) => i.role === role) ?? null;
    const multi = this.isMulti(input);
    const fileOf = async (img: SubmitImage) => ({ type: img.mime === 'image/png' ? 'png' : 'jpeg', file_token: await this.upload(img) });
    const o = input.opts;
    const seed = o.variant === 'retry' ? Date.now() % 2_147_483_647 : undefined;
    const common = {
      model_version: this.modelVersion,
      pbr: o.pbr && o.texture,
      texture: o.texture,
      texture_quality: 'detailed',
      face_limit: o.polycount,
      orientation: 'align_image',
      ...(seed !== undefined ? { model_seed: seed, texture_seed: seed } : {}),
    };
    let body: Record<string, unknown>;
    if (multi) {
      const files: Record<string, unknown>[] = [await fileOf(front)];
      for (const role of ['left', 'back', 'right'] as const) {
        const img = side(role);
        files.push(img ? await fileOf(img) : {});
      }
      body = { type: 'multiview_to_model', files, ...common };
    } else {
      body = { type: 'image_to_model', file: await fileOf(front), ...common };
    }
    const env = await requestJson<Envelope<{ task_id?: string }>>('tripo', this.fetchImpl, `${this.base}/task`, {
      method: 'POST',
      headers: this.headers(),
      json: body,
    });
    const data = this.unwrap(env, 'task create');
    if (!data.task_id) throw new ProviderError('tripo', 'server', 'tripo: task create returned no task_id');
    return { provider: 'tripo', id: data.task_id, mode: multi ? 'multi' : 'single' };
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    type Task = {
      status?: string;
      progress?: number;
      output?: { pbr_model?: string; model?: string; base_model?: string; rendered_image?: string };
      message?: string;
    };
    const env = await requestJson<Envelope<Task>>('tripo', this.fetchImpl, `${this.base}/task/${handle.id}`, { method: 'GET', headers: this.headers() });
    const t = this.unwrap(env, 'poll');
    const state = STATE[String(t.status ?? '').toLowerCase()] ?? 'running';
    const out = t.output ?? {};
    const glb = out.pbr_model ?? out.model ?? out.base_model;
    return {
      handle,
      state,
      progress: Number(t.progress ?? 0),
      modelUrls: glb ? { glb } : {},
      previewUrl: out.rendered_image ?? null,
      error: state === 'failed' || state === 'expired' ? (t.message ?? `task ${t.status}`) : null,
      raw: t,
    };
  }

  download(url: string): Promise<Buffer> {
    return fetchBuffer('tripo', this.fetchImpl, url);
  }

  estimateCostUsd(input: Pick<SubmitInput, 'mode' | 'images' | 'opts'>): number {
    return this.isMulti(input) ? TRIPO_COST_USD.multi : TRIPO_COST_USD.single;
  }
}

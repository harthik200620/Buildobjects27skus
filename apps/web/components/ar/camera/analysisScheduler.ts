'use client';

import { type BudgetSnapshot, CallBudget, type CallReason, type SceneAnalysis } from '@buildobjects/ar-engine';
import type { ArState } from './debug';

/**
 * When to ask Gemini about the live frame, and how. Owns the session's `CallBudget` (min
 * interval, in-flight dedupe, session cap, motion trigger) and the triggers:
 *   start      — as soon as the stream is up,
 *   timer      — every `minIntervalMs` while scanning / checking / refused / unfit,
 *   motion     — early, on ≥ 15° rotation or ≥ 20 % flow since the last call,
 *   watchdog   — every `lockedIntervalMs` (8 s) while locked, to catch a changed scene,
 *   retry      — when tracking was lost long enough to drop the anchor.
 * Paused while the page is hidden. Each call: ≤ 768 px JPEG (q 0.72), 4 s client timeout,
 * `mode: 'live'` to /api/ar/analyze; 429 / 504 answers carry `retryAfterMs` which delays the
 * next call; a 503 means the key is gone → the caller switches to on-device mode.
 */
export interface CapturedFrame {
  mimeType: string;
  base64: string;
  width: number;
  height: number;
  frameW: number;
  frameH: number;
}

export interface AnalysisMeta {
  reason: CallReason;
  latencyMs: number;
  calls: number;
  remaining: number;
  sentW: number;
  sentH: number;
  status?: number;
}

export interface AnalysisError {
  message: string;
  status?: number;
  retryAfterMs?: number;
  aborted?: boolean;
}

export interface SchedulerOptions {
  category: string;
  deviceClass?: string;
  minIntervalMs?: number;
  maxCalls?: number;
  lockedIntervalMs?: number;
  timeoutMs?: number;
  capture: () => CapturedFrame | null;
  onResult: (analysis: SceneAnalysis, meta: AnalysisMeta) => void;
  onError: (error: AnalysisError, meta: AnalysisMeta) => void;
  onExhausted?: (snapshot: BudgetSnapshot) => void;
  onLiveLost?: (why: string) => void;
  now?: () => number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export const SCHEDULER_DEFAULTS = { minIntervalMs: 2500, maxCalls: 40, lockedIntervalMs: 8000, timeoutMs: 4000 };

export class AnalysisScheduler {
  readonly budget: CallBudget;
  private state: ArState = 'scanning';
  private paused = false;
  private disposed = false;
  private started = false;
  private notBefore = 0;
  private exhaustedNotified = false;
  private readonly now: () => number;
  private readonly opts: Required<Pick<SchedulerOptions, 'minIntervalMs' | 'maxCalls' | 'lockedIntervalMs' | 'timeoutMs' | 'endpoint'>> & SchedulerOptions;
  private lastError: AnalysisError | null = null;
  private lastLatencyMs: number | null = null;

  constructor(opts: SchedulerOptions) {
    this.now = opts.now ?? (() => performance.now());
    this.opts = { ...SCHEDULER_DEFAULTS, endpoint: '/api/ar/analyze', ...opts };
    this.budget = new CallBudget({ minIntervalMs: this.opts.minIntervalMs, maxCalls: this.opts.maxCalls, now: this.now });
  }

  get snapshot(): BudgetSnapshot & { state: ArState; paused: boolean; lastLatencyMs: number | null; lastError: AnalysisError | null } {
    return { ...this.budget.snapshot(), state: this.state, paused: this.paused, lastLatencyMs: this.lastLatencyMs, lastError: this.lastError };
  }

  setState(state: ArState): void {
    this.state = state;
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Raise the session cap after the user chose to continue. */
  resume(n: number): void {
    this.budget.resume(n);
    this.exhaustedNotified = false;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Ask for an early analysis because the camera moved; honours the budget. */
  motion(sample: { rotationDeg?: number; flowFrac?: number }): boolean {
    if (this.paused || this.disposed || !this.started) return false;
    if (this.now() < this.notBefore) return false;
    if (!this.budget.motion(sample)) return false;
    void this.fire('motion');
    return true;
  }

  /** Call once per frame. Decides whether a timer / watchdog / start call is due. */
  tick(): void {
    if (this.paused || this.disposed) return;
    const at = this.now();
    if (at < this.notBefore) return;
    if (this.budget.inFlight) return;
    if (this.budget.exhausted) {
      this.notifyExhausted();
      return;
    }
    if (!this.started) {
      this.started = true;
      void this.fire('start');
      return;
    }
    const snap = this.budget.snapshot();
    const interval = this.state === 'locked' ? this.opts.lockedIntervalMs : this.opts.minIntervalMs;
    if (snap.lastStartedAt !== null && at - snap.lastStartedAt < interval) return;
    void this.fire(this.state === 'locked' ? 'watchdog' : snap.calls === 0 ? 'start' : 'timer');
  }

  /** Force a call now (e.g. after the anchor was dropped), subject to the budget. */
  request(reason: CallReason = 'retry'): boolean {
    if (this.paused || this.disposed) return false;
    if (this.budget.check() !== null) return false;
    this.started = true;
    void this.fire(reason);
    return true;
  }

  private notifyExhausted(): void {
    if (this.exhaustedNotified) return;
    this.exhaustedNotified = true;
    this.opts.onExhausted?.(this.budget.snapshot());
  }

  private async fire(reason: CallReason): Promise<void> {
    const ticket = this.budget.begin(reason);
    if (!ticket) {
      if (this.budget.exhausted) this.notifyExhausted();
      return;
    }
    const t0 = this.now();
    const meta = (extra: Partial<AnalysisMeta> = {}): AnalysisMeta => ({
      reason,
      latencyMs: Math.round(this.now() - t0),
      calls: this.budget.count,
      remaining: this.budget.remaining,
      sentW: 0,
      sentH: 0,
      ...extra,
    });
    try {
      const frame = this.opts.capture();
      if (!frame) {
        this.budget.end(ticket);
        return;
      }
      const fetchImpl = this.opts.fetchImpl ?? fetch;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('analysis timed out', 'TimeoutError')), this.opts.timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(this.opts.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            mode: 'live',
            image: { mimeType: frame.mimeType, base64: frame.base64 },
            width: frame.width,
            height: frame.height,
            category: this.opts.category,
            deviceClass: this.opts.deviceClass,
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      const json = (await res.json().catch(() => null)) as (SceneAnalysis & { error?: string; retryAfterMs?: number; live?: boolean }) | null;
      if (!res.ok || !json || json.error) {
        const err: AnalysisError = {
          message: json?.error ?? `analysis failed (${res.status})`,
          status: res.status,
          retryAfterMs: typeof json?.retryAfterMs === 'number' ? json.retryAfterMs : undefined,
        };
        if (res.status === 429 || res.status === 504) this.notBefore = this.now() + (err.retryAfterMs ?? 2500);
        if (res.status === 503) this.opts.onLiveLost?.(err.message);
        this.lastError = err;
        this.opts.onError(err, meta({ sentW: frame.width, sentH: frame.height, status: res.status }));
        return;
      }
      // References were measured on the downscaled JPEG — rescale their pixel extents to the video frame.
      const sx = frame.frameW / Math.max(1, frame.width),
        sy = frame.frameH / Math.max(1, frame.height);
      const analysis: SceneAnalysis = {
        ...json,
        references: (json.references ?? []).map((r) => ({
          ...r,
          px: r.px * (r.kind === 'switch_plate' || r.kind === 'tile_joint' || r.kind === 'a4_sheet' || r.kind === 'brick' ? sx : sy),
        })),
        latencyMs: Math.round(this.now() - t0),
      };
      this.lastLatencyMs = analysis.latencyMs ?? null;
      this.lastError = null;
      this.opts.onResult(analysis, meta({ sentW: frame.width, sentH: frame.height, status: res.status }));
    } catch (e) {
      const aborted = (e as { name?: string })?.name === 'AbortError' || (e as { name?: string })?.name === 'TimeoutError';
      const err: AnalysisError = { message: aborted ? 'Scene analysis timed out' : ((e as Error)?.message ?? 'analysis failed'), aborted };
      this.lastError = err;
      this.opts.onError(err, meta());
    } finally {
      this.budget.end(ticket);
    }
  }
}

/** ≤ `maxSide` px JPEG of the visible crop of the video (q 0.72) — what every live analysis call sends. */
export function captureAnalysisFrame(
  video: HTMLVideoElement,
  crop: { x0: number; y0: number; cw: number; ch: number } | null,
  maxSide = 768,
  quality = 0.72,
): CapturedFrame | null {
  const W = video.videoWidth,
    H = video.videoHeight;
  if (!W || !H || video.readyState < 2) return null;
  const c = crop ?? { x0: 0, y0: 0, cw: W, ch: H };
  const k = Math.min(1, maxSide / Math.max(c.cw, c.ch));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(c.cw * k));
  canvas.height = Math.max(1, Math.round(c.ch * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, c.x0, c.y0, c.cw, c.ch, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { mimeType: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1), width: canvas.width, height: canvas.height, frameW: c.cw, frameH: c.ch };
}

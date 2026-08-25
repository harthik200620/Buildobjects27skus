'use client';

/**
 * `window.__arDebug` — the live-camera tier's instrument panel for device testing and the e2e
 * suite. Populated when `NEXT_PUBLIC_AR_DEBUG=1` is in the build, or at runtime with `?debug=1`
 * in the URL or `localStorage['ar.debug'] = '1'` (so a running dev server needs no restart).
 */
export type ArState = 'scanning' | 'checking' | 'locked' | 'refused' | 'unfit' | 'lost';

export interface ArDebug {
  state: ArState;
  /** True only while the product is actually drawn on the video. */
  modelVisible: boolean;
  calls: number;
  latencyMs: number | null;
  fps: number;
  pose: { yawDeg: number; pitchDeg: number; rollDeg: number; heightM: number; source: 'sensors' | 'horizon' | 'static' } | null;
  tracking: string;
  gate: { status: string; wavering: boolean; flips: number; reason: string | null } | null;
  scene: { type: string; confidence: number; provider: string; surfaces: string[] } | null;
  scale: string | null;
  anchor: { kind: string; surface: string; u: number; v: number } | null;
  flow: { dx: number; dy: number; confidence: number } | null;
  fit: { ok: boolean; reason: string } | null;
  budget: { calls: number; cap: number; remaining: number; exhausted: boolean } | null;
  live: boolean | null;
  webgl: boolean;
  video: { W: number; H: number } | null;
  updatedAt: number;
}

declare global {
  interface Window {
    __arDebug?: ArDebug;
  }
}

export function isArDebug(): boolean {
  if (process.env.NEXT_PUBLIC_AR_DEBUG === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    return /(^|[?&])debug=1(&|$)/.test(window.location.search) || window.localStorage.getItem('ar.debug') === '1';
  } catch {
    return false;
  }
}

export function emptyDebug(): ArDebug {
  return {
    state: 'scanning',
    modelVisible: false,
    calls: 0,
    latencyMs: null,
    fps: 0,
    pose: null,
    tracking: 'acquiring',
    gate: null,
    scene: null,
    scale: null,
    anchor: null,
    flow: null,
    fit: null,
    budget: null,
    live: null,
    webgl: false,
    video: null,
    updatedAt: 0,
  };
}

/** Merge into `window.__arDebug` (creates it on first use). No-op when debugging is off. */
export function publishDebug(patch: Partial<ArDebug>, force = false): ArDebug | null {
  if (typeof window === 'undefined') return null;
  if (!force && !isArDebug()) return null;
  const next: ArDebug = { ...(window.__arDebug ?? emptyDebug()), ...patch, updatedAt: Date.now() };
  window.__arDebug = next;
  return next;
}

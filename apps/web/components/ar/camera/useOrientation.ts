'use client';

import { type Quat, quatFromDeviceOrientation } from '@buildobjects/ar-engine';
import React from 'react';

/**
 * DeviceOrientation → a smoothed three.js camera quaternion, kept in a ref (samples arrive at
 * 60 Hz; React state only tracks the coarse facts: whether sensors are alive and how many
 * samples came in). Slerp smoothing (alpha 0.35) kills jitter without visible lag; the raw
 * sample is kept too for the debug panel.
 */
export interface OrientationSample {
  q: Quat;
  raw: Quat;
  at: number;
  alpha: number;
  beta: number;
  gamma: number;
  screenAngle: number;
}

export interface OrientationFeed {
  /** Latest smoothed sample, or null before the first event. */
  ref: React.RefObject<OrientationSample | null>;
  /** True once a sample has arrived and none is older than `silenceMs`. */
  active: boolean;
  samples: number;
}

const SILENCE_MS = 1500;

export function screenAngle(): number {
  try {
    const so = (screen as Screen & { orientation?: { angle?: number } }).orientation;
    if (so && typeof so.angle === 'number') return so.angle;
  } catch {
    /* ignore */
  }
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

/** Spherical linear interpolation between unit quaternions (shortest arc). */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x,
    by = b.y,
    bz = b.z,
    bw = b.w;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka = 1 - t,
    kb = t;
  if (cos < 0.9995) {
    const th = Math.acos(Math.min(1, cos)),
      s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s;
    kb = Math.sin(t * th) / s;
  }
  const x = ka * a.x + kb * bx,
    y = ka * a.y + kb * by,
    z = ka * a.z + kb * bz,
    w = ka * a.w + kb * bw;
  const l = Math.hypot(x, y, z, w) || 1;
  return { x: x / l, y: y / l, z: z / l, w: w / l };
}

export function useOrientation(enabled: boolean, opts: { smoothing?: number; onSample?: () => void } = {}): OrientationFeed {
  const ref = React.useRef<OrientationSample | null>(null);
  const [active, setActive] = React.useState(false);
  const [samples, setSamples] = React.useState(0);
  const countRef = React.useRef(0);
  const onSampleRef = React.useRef(opts.onSample);
  onSampleRef.current = opts.onSample;
  const alpha = opts.smoothing ?? 0.35;

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const armSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => setActive(false), SILENCE_MS);
    };
    const onEvent = (e: DeviceOrientationEvent) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return; // laptops fire one empty event
      const a = e.alpha ?? 0,
        b = e.beta ?? 0,
        g = e.gamma ?? 0,
        sa = screenAngle();
      const raw = quatFromDeviceOrientation(a, b, g, sa);
      const prev = ref.current;
      const q = prev ? slerp(prev.q, raw, alpha) : raw;
      ref.current = { q, raw, at: performance.now(), alpha: a, beta: b, gamma: g, screenAngle: sa };
      countRef.current += 1;
      if (countRef.current === 1) setActive(true);
      if (countRef.current % 30 === 0) setSamples(countRef.current);
      onSampleRef.current?.();
      if (countRef.current % 15 === 1) {
        setActive(true);
        armSilence();
      }
    };
    // 'deviceorientation' (relative heading) is enough for 3DoF; absolute is optional and noisier indoors.
    window.addEventListener('deviceorientation', onEvent, { passive: true });
    return () => {
      window.removeEventListener('deviceorientation', onEvent);
      if (silenceTimer) clearTimeout(silenceTimer);
    };
  }, [enabled, alpha]);

  return { ref, active, samples };
}

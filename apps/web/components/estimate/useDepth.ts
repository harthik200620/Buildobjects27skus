'use client';

import React from 'react';

/**
 * One estimator, three depths.
 *
 * ── THE ONLY RULE THAT MATTERS ──────────────────────────────────────────────────────────────
 * THE NUMBERS ARE IDENTICAL AT EVERY DEPTH. Only how much is disclosed changes. A different
 * figure on a cheaper phone would destroy the entire proposition — the whole reason to trust this
 * page is that it does not know who you are before it decides what to tell you.
 *
 * ── WHO THEY ARE ────────────────────────────────────────────────────────────────────────────
 *   1  English, high intent, ₹1 Cr+, often NRI or Hyderabad IT. Wants control and evidence:
 *      every input, per-line rate editing, tier comparison, CSV, SKU provenance, citations.
 *   2  The core customer. Vijayawada, Guntur, Warangal, ₹25–60L, price-first, Telugu and English
 *      both, mid-range Android. Wants the guided path, budget-versus-estimate, EMI, phase money.
 *   3  ₹8–18L, self-managed with a local mestri, slow phone, slow connection. Not today's paying
 *      customer, and that is fine — they are the largest volume of house-building in the country
 *      and the referral engine, and serving them costs almost nothing when the architecture is
 *      tiered from the start. Three questions, one number, Telugu, no WebGL, a shareable card.
 *
 * ── AND THE SEGMENTS ARE NEVER NAMED IN THE UI ──────────────────────────────────────────────
 * Nobody is told they are "India 3". The control says "Simple / Guided / Everything", which is a
 * description of the page and not of the person reading it.
 */

export type Depth = 1 | 2 | 3;
/** What the device can draw. Decided by the same probe, on purpose — they move together. */
export type RenderTier = 'full' | 'reduced' | 'none';

export interface DepthState {
  depth: Depth;
  render: RenderTier;
  /** True while the depth is whatever detection chose, false once a person has picked. */
  auto: boolean;
  /** Telugu is the default for depth 3 and for a Telugu browser, not an opt-in buried in a menu. */
  lang: 'en' | 'te';
  setDepth: (d: Depth) => void;
  setLang: (l: 'en' | 'te') => void;
  /** What detection saw, so the UI can explain itself if asked. */
  signals: Signals;
}

export interface Signals {
  memoryGb: number | null;
  cores: number | null;
  connection: string | null;
  webgl2: boolean;
  width: number;
  language: string;
  saveData: boolean;
}

const KEY_DEPTH = 'bo_estimator_depth';
const KEY_LANG = 'bo_estimator_lang';

/** The labels a person actually sees. Never "India 1". */
export const DEPTH_LABEL: Record<Depth, string> = { 3: 'Simple', 2: 'Guided', 1: 'Everything' };
export const DEPTH_HINT: Record<Depth, string> = {
  3: 'Three questions, one number',
  2: 'The questions that move the number most',
  1: 'Every input, every line, every rate',
};

function probe(): Signals {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; saveData?: boolean } };
  let webgl2 = false;
  try {
    /* A context is created and immediately dropped. Asking is cheap; assuming is not — a device
       that reports eight cores and no WebGL2 is a real combination on Android Go. */
    const c = document.createElement('canvas');
    webgl2 = !!c.getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  return {
    memoryGb: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency ?? null,
    connection: nav.connection?.effectiveType ?? null,
    webgl2,
    width: window.innerWidth,
    language: navigator.language || 'en',
    saveData: nav.connection?.saveData === true,
  };
}

function detect(s: Signals): { depth: Depth; render: RenderTier } {
  /* Data-saver is an explicit request, not a guess about the device. It wins outright. */
  if (s.saveData) return { depth: 3, render: 'none' };

  const slowNet = s.connection === 'slow-2g' || s.connection === '2g' || s.connection === '3g';
  const weak = (s.memoryGb !== null && s.memoryGb <= 2) || (s.cores !== null && s.cores <= 4);

  if (!s.webgl2 || (weak && slowNet)) return { depth: 3, render: 'none' };
  if (weak || slowNet || s.width < 900) return { depth: 2, render: 'reduced' };

  const strong = (s.memoryGb ?? 8) >= 8 && (s.cores ?? 8) >= 8 && s.width >= 1280;
  return strong ? { depth: 1, render: 'full' } : { depth: 2, render: 'full' };
}

/**
 * Detection sets the DEFAULT and nothing more. A person switching depth is not overridden on the
 * next render, the next navigation, or the next visit — the choice persists, because being moved
 * back to a simpler page after asking for a fuller one is the single most patronising thing an
 * interface can do.
 */
export function useDepth(): DepthState {
  const [signals, setSignals] = React.useState<Signals>({
    memoryGb: null,
    cores: null,
    connection: null,
    webgl2: false,
    width: 1440,
    language: 'en',
    saveData: false,
  });
  /* Server and first client render agree on depth 2: the middle of the range, so the page never
     flashes from a rich layout to a poor one or the other way round. */
  const [depth, setDepthState] = React.useState<Depth>(2);
  const [render, setRender] = React.useState<RenderTier>('reduced');
  const [auto, setAuto] = React.useState(true);
  const [lang, setLangState] = React.useState<'en' | 'te'>('en');

  React.useEffect(() => {
    const s = probe();
    setSignals(s);
    const chosen = detect(s);
    setRender(chosen.render);

    const stored = Number(localStorage.getItem(KEY_DEPTH));
    if (stored === 1 || stored === 2 || stored === 3) {
      setDepthState(stored as Depth);
      setAuto(false);
    } else {
      setDepthState(chosen.depth);
      setAuto(true);
    }

    const storedLang = localStorage.getItem(KEY_LANG);
    if (storedLang === 'te' || storedLang === 'en') setLangState(storedLang);
    else if (s.language.toLowerCase().startsWith('te') || chosen.depth === 3) setLangState(s.language.toLowerCase().startsWith('te') ? 'te' : 'en');
  }, []);

  const setDepth = React.useCallback((d: Depth) => {
    setDepthState(d);
    setAuto(false);
    try {
      localStorage.setItem(KEY_DEPTH, String(d));
    } catch {
      /* Private mode. The choice holds for this session and that is enough. */
    }
  }, []);

  const setLang = React.useCallback((l: 'en' | 'te') => {
    setLangState(l);
    try {
      localStorage.setItem(KEY_LANG, l);
    } catch {
      /* as above */
    }
  }, []);

  /*
   * Depth 1 never gets the "none" renderer even on a weak machine — someone who asked for
   * everything gets everything the device can actually draw, and WebGL2 capability is a hard
   * fact rather than a preference.
   */
  const effectiveRender: RenderTier = depth === 3 ? 'none' : !signals.webgl2 ? 'none' : depth === 1 ? 'full' : render;

  return { depth, render: effectiveRender, auto, lang, setDepth, setLang, signals };
}

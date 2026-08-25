import type { GateResult, Surface } from '../types';

/**
 * Verdict hysteresis for the live gate. Each analysis frame yields a raw `gate()` verdict; the
 * HUD only shows a verdict once it has been confirmed:
 *   allow   after M consecutive allows on the same surface (M = 2; 1 when the scene confidence
 *           is ≥ 0.8 and the chosen surface's confidence is ≥ 0.6),
 *   refuse  after K consecutive refusals (K = 2; 1 for a reject-scene refusal with confidence
 *           ≥ 0.85 — the bathtub-in-a-living-room case never dithers).
 * Until then, or whenever the latest raw verdict disagrees with the published one, the state is
 * `wavering` and the chip reads "Checking…". Pure: `stepGate` returns a new state.
 */
export type GateStatus = 'pending' | 'allowed' | 'refused';

export interface GateHysteresisOptions {
  /** Consecutive refusals needed to publish a refusal. */
  K?: number;
  /** Consecutive allows needed to publish an allow. */
  M?: number;
  fastAllowScene?: number;
  fastAllowSurface?: number;
  fastRejectScene?: number;
}

export const GATE_HYSTERESIS_DEFAULTS: Required<GateHysteresisOptions> = { K: 2, M: 2, fastAllowScene: 0.8, fastAllowSurface: 0.6, fastRejectScene: 0.85 };
export const WAVERING_LABEL = 'Checking…';

export interface GateHysteresisState {
  status: GateStatus;
  /** The confirmed verdict the HUD shows (null while pending). */
  published: GateResult | null;
  /** The latest raw verdict. */
  last: GateResult | null;
  /** Consecutive raw allows on the same surface. */
  allowRun: number;
  /** Consecutive raw refusals. */
  refuseRun: number;
  wavering: boolean;
  steps: number;
  /** Published allowed ↔ refused changes. Must stay at 0 once a surface is locked. */
  flips: number;
}

export function initialGateState(): GateHysteresisState {
  return { status: 'pending', published: null, last: null, allowRun: 0, refuseRun: 0, wavering: true, steps: 0, flips: 0 };
}

const isRejectScene = (v: GateResult): boolean => (v.kind ? v.kind === 'reject_scene' : / does not belong in /.test(v.reason));

export function stepGate(state: GateHysteresisState, verdict: GateResult, opts: GateHysteresisOptions = {}): GateHysteresisState {
  const o = { ...GATE_HYSTERESIS_DEFAULTS, ...opts };
  const last = state.last;
  const sameSurface = (a: Surface | null, b: Surface | null) => a === b;
  const allowRun = verdict.allowed ? (last?.allowed && sameSurface(last.surface, verdict.surface) ? state.allowRun + 1 : 1) : 0;
  const refuseRun = verdict.allowed ? 0 : last && !last.allowed ? state.refuseRun + 1 : 1;

  const sceneConf = verdict.sceneConfidence ?? Number.NaN;
  const fastAllow = verdict.allowed && sceneConf >= o.fastAllowScene && verdict.confidence >= o.fastAllowSurface;
  const fastRefuse = !verdict.allowed && isRejectScene(verdict) && verdict.confidence >= o.fastRejectScene;
  const needAllow = fastAllow ? 1 : Math.max(1, o.M);
  const needRefuse = fastRefuse ? 1 : Math.max(1, o.K);

  let status = state.status,
    published = state.published,
    flips = state.flips;
  if (verdict.allowed && allowRun >= needAllow) {
    if (status === 'refused') flips++;
    status = 'allowed';
    published = verdict;
  } else if (!verdict.allowed && refuseRun >= needRefuse) {
    if (status === 'allowed') flips++;
    status = 'refused';
    published = verdict;
  } else if (published && published.allowed === verdict.allowed && (verdict.allowed ? sameSurface(published.surface, verdict.surface) : true)) {
    // Agreeing verdict below the threshold: keep the status, refresh the text / confidence.
    published = verdict;
  }
  const wavering = status === 'pending' || (published !== null && published.allowed !== verdict.allowed);
  return { status, published, last: verdict, allowRun, refuseRun, wavering, steps: state.steps + 1, flips };
}

/** True while no verdict is confirmed yet or the latest raw verdict disagrees with the published one → chip "Checking…". */
export const wavering = (state: GateHysteresisState): boolean => state.wavering;

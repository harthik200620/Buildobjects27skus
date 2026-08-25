import type { DeviceClass } from '../types';

/**
 * The live-camera tracking state machine:
 *   acquiring — no anchor yet (scanning / checking); the model is not drawn.
 *   tracking  — an anchor is locked and the pose / flow keeps it in place; the model is drawn.
 *   lost      — the pose can no longer be trusted; the model fades to 35 % with "Hold steady";
 *               after 2 s without recovery the anchor is dropped (→ acquiring) so the scheduler
 *               re-analyses.
 * Loss conditions while tracking: orientation sensor silence > 400 ms (phones — only once a
 * sensor sample has ever arrived), optical-flow residual > 6 px sustained for 0.5 s (the flow
 * disagrees with the pose), or — on devices without sensors (laptops, denied permission) whose
 * anchor is static and merely panned by the flow — accumulated shift > 12 % of the frame width.
 * Pure reducer (`stepTracking`) + a tiny stateful wrapper with an injectable clock (`createTracker`).
 */
export type TrackingStatus = 'acquiring' | 'tracking' | 'lost';
export type LostReason = 'sensor_silence' | 'flow_residual' | 'shift' | null;

export interface TrackingThresholds {
  sensorSilenceMs: number;
  residualPx: number;
  residualHoldMs: number;
  /** Fraction of the frame width. */
  shiftFrac: number;
  unlockMs: number;
  lostOpacity: number;
}

export const TRACKING_THRESHOLDS: TrackingThresholds = {
  sensorSilenceMs: 400,
  residualPx: 6,
  residualHoldMs: 500,
  shiftFrac: 0.12,
  unlockMs: 2000,
  lostOpacity: 0.35,
};
export const HOLD_STEADY_HINT = 'Hold steady';

export interface TrackingState {
  status: TrackingStatus;
  /** Timestamp of the last status change. */
  since: number;
  reason: LostReason;
  lastSensorAt: number | null;
  /** When the flow residual first exceeded the threshold in the current run of high residuals. */
  residualSince: number | null;
  /** Accumulated optical-flow shift since the lock, small-frame px (sensor-less devices). */
  shiftX: number;
  shiftY: number;
  /** 1 while tracking, 0.35 while lost, 0 while acquiring. */
  modelOpacity: number;
  hint: string | null;
  locks: number;
}

export type TrackingEvent =
  | { type: 'sensor'; at: number }
  | { type: 'lock'; at: number }
  | { type: 'unlock'; at: number }
  | { type: 'flow'; at: number; dx: number; dy: number; residualPx?: number | null }
  | { type: 'tick'; at: number };

export interface TrackingOptions {
  thresholds?: Partial<TrackingThresholds>;
  /** Width of the flow frame the shift is measured in, px. */
  frameW?: number;
  deviceClass?: DeviceClass;
}

export function initialTrackingState(at = 0): TrackingState {
  return { status: 'acquiring', since: at, reason: null, lastSensorAt: null, residualSince: null, shiftX: 0, shiftY: 0, modelOpacity: 0, hint: null, locks: 0 };
}

function present(s: TrackingState, t: TrackingThresholds): TrackingState {
  const modelOpacity = s.status === 'tracking' ? 1 : s.status === 'lost' ? t.lostOpacity : 0;
  const hint = s.status === 'lost' ? HOLD_STEADY_HINT : null;
  return s.modelOpacity === modelOpacity && s.hint === hint ? s : { ...s, modelOpacity, hint };
}

export function stepTracking(state: TrackingState, event: TrackingEvent, opts: TrackingOptions = {}): TrackingState {
  const t = { ...TRACKING_THRESHOLDS, ...opts.thresholds };
  const frameW = opts.frameW ?? 160;
  let s: TrackingState = { ...state };
  const at = event.at;
  const lose = (reason: Exclude<LostReason, null>) => {
    s = { ...s, status: 'lost', since: at, reason };
  };
  const recover = () => {
    s = { ...s, status: 'tracking', since: at, reason: null };
  };

  switch (event.type) {
    case 'sensor':
      s.lastSensorAt = at;
      if (s.status === 'lost' && s.reason === 'sensor_silence') recover();
      break;
    case 'lock':
      s = { ...s, status: 'tracking', since: at, reason: null, residualSince: null, shiftX: 0, shiftY: 0, locks: s.locks + 1 };
      break;
    case 'unlock':
      s = { ...s, status: 'acquiring', since: at, reason: null, residualSince: null, shiftX: 0, shiftY: 0 };
      break;
    case 'flow': {
      if (s.status === 'acquiring') break;
      const sensorless = s.lastSensorAt === null;
      if (sensorless) {
        s.shiftX += event.dx;
        s.shiftY += event.dy;
      }
      const res = event.residualPx;
      if (typeof res === 'number' && Number.isFinite(res)) {
        if (res > t.residualPx) {
          if (s.residualSince === null) s.residualSince = at;
        } else {
          s.residualSince = null;
          if (s.status === 'lost' && s.reason === 'flow_residual') recover();
        }
      }
      break;
    }
    case 'tick':
      break;
  }

  // Evaluate the timers and the accumulated evidence.
  if (s.status === 'tracking') {
    const sensorless = s.lastSensorAt === null;
    if (!sensorless && at - (s.lastSensorAt as number) > t.sensorSilenceMs) lose('sensor_silence');
    else if (s.residualSince !== null && at - s.residualSince >= t.residualHoldMs) lose('flow_residual');
    else if (sensorless && Math.hypot(s.shiftX, s.shiftY) / frameW > t.shiftFrac) lose('shift');
  } else if (s.status === 'lost') {
    if (s.reason === 'shift' && Math.hypot(s.shiftX, s.shiftY) / frameW <= t.shiftFrac) recover();
    else if (at - s.since >= t.unlockMs) s = { ...s, status: 'acquiring', since: at, reason: null, residualSince: null, shiftX: 0, shiftY: 0 };
  }
  return present(s, t);
}

export interface Tracker {
  readonly state: TrackingState;
  /** An orientation sample arrived. */
  sensor(): TrackingState;
  /** The anchor locked → tracking. */
  lock(): TrackingState;
  unlock(): TrackingState;
  /** A flow estimate for the latest frame; `residualPx` = |measured − predicted from the pose| on phones. */
  flow(dx: number, dy: number, residualPx?: number | null): TrackingState;
  /** Evaluate the timers without new evidence (call once per render frame). */
  tick(): TrackingState;
}

/** Stateful convenience wrapper; `now` defaults to `performance.now()` / `Date.now()`. */
export function createTracker(opts: TrackingOptions & { now?: () => number } = {}): Tracker {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  let state = initialTrackingState(now());
  const step = (e: TrackingEvent) => (state = stepTracking(state, e, opts));
  return {
    get state() {
      return state;
    },
    sensor: () => step({ type: 'sensor', at: now() }),
    lock: () => step({ type: 'lock', at: now() }),
    unlock: () => step({ type: 'unlock', at: now() }),
    flow: (dx, dy, residualPx) => step({ type: 'flow', at: now(), dx, dy, residualPx }),
    tick: () => step({ type: 'tick', at: now() }),
  };
}

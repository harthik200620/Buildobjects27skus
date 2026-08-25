import type { CompositeResult, GateResult, PlacementRule, SceneAnalysis, SceneType, Surface } from '@buildobjects/ar-engine';
import { defaultAnchor } from '@buildobjects/ar-engine';

/**
 * The photo-mode state machine: take or upload a room photo, read the scene, decide whether the
 * product may be placed there, position it, optionally calibrate the scale against a known
 * object, then composite.
 *
 * This lives outside the component because the transitions are the interesting part and they
 * are worth testing without a DOM. It replaced fifteen `useState` calls whose updates had to be
 * written out together at every call site — `retake` alone set five of them, and forgetting one
 * left a stale gate verdict or a previous composite on screen. Here a transition is one named
 * action and the reducer is the only place that decides what it clears.
 */

export type Step = 'capture' | 'analyzing' | 'scene' | 'gate' | 'place' | 'calibrate' | 'compositing' | 'result';

/** A finished composite, plus how it was produced. */
export type Composite = CompositeResult & { dataUrl: string; ms: number; fallback?: boolean };

/** A measured reference: `px` on screen is known to be `realMm` in the room. */
export interface ManualScale {
  px: number;
  realMm: number;
  kind: string;
}

export interface PhotoSession {
  step: Step;
  /** The room photo. Null in `capture`, non-null in every other step. */
  photo: HTMLCanvasElement | null;
  scene: SceneAnalysis | null;
  /** The room type the user picked when the on-device analyser could not tell. */
  userScene: SceneType | null;
  gate: GateResult | null;
  surface: Surface;
  /** Where the product sits, in 0–1 fractions of the photo. */
  pos: { x: number; y: number };
  yaw: number;
  /** Enlargement over true scale. 1 is true size; see `autoSize`. */
  scaleMult: number;
  manual: ManualScale | null;
  /** Points tapped during calibration; two of them make a measurement. */
  calibPts: { x: number; y: number }[];
  result: Composite | null;
  /** A message shown while a long step runs, or null. */
  busy: string | null;
  error: string | null;
}

export type PhotoAction =
  | { type: 'photoTaken'; photo: HTMLCanvasElement }
  | { type: 'analysisStarted' }
  | { type: 'sceneUnknown'; scene: SceneAnalysis }
  | { type: 'gateRefused'; scene: SceneAnalysis; gate: GateResult }
  | { type: 'gateAllowed'; scene: SceneAnalysis; gate: GateResult; surface: Surface; pos: { x: number; y: number } }
  | { type: 'roomChosen'; room: SceneType }
  | { type: 'roomReset' }
  | { type: 'surfaceChosen'; surface: Surface; rule: PlacementRule }
  | { type: 'moved'; pos: { x: number; y: number } }
  | { type: 'yawChanged'; yaw: number }
  | { type: 'scaleChanged'; scaleMult: number }
  | { type: 'calibrateStarted' }
  | { type: 'calibrateCancelled' }
  | { type: 'calibPointAdded'; point: { x: number; y: number } }
  | { type: 'calibrated'; manual: ManualScale }
  | { type: 'compositeStarted'; message: string }
  | { type: 'composited'; result: Composite }
  | { type: 'failed'; error: string }
  | { type: 'errorDismissed' }
  | { type: 'placeAgain' }
  | { type: 'retake' };

export function initialSession(rule: PlacementRule): PhotoSession {
  return {
    step: 'capture',
    photo: null,
    scene: null,
    userScene: null,
    gate: null,
    surface: rule.surfaces[0],
    pos: { x: 0.5, y: 0.75 },
    yaw: 0,
    scaleMult: 1,
    manual: null,
    calibPts: [],
    result: null,
    busy: null,
    error: null,
  };
}

export function photoSessionReducer(state: PhotoSession, action: PhotoAction): PhotoSession {
  switch (action.type) {
    case 'photoTaken':
      // A new photo invalidates every judgement made about the previous one.
      return { ...state, photo: action.photo, scene: null, gate: null, result: null, manual: null, calibPts: [], error: null };

    case 'analysisStarted':
      return { ...state, step: 'analyzing', busy: 'Reading the room…', error: null };

    case 'sceneUnknown':
      // The analyser could not name the room, so the user is asked.
      return { ...state, step: 'scene', scene: action.scene, busy: null };

    case 'gateRefused':
      return { ...state, step: 'gate', scene: action.scene, gate: action.gate, busy: null };

    case 'gateAllowed':
      return { ...state, step: 'place', scene: action.scene, gate: action.gate, surface: action.surface, pos: action.pos, busy: null };

    case 'roomChosen':
      // The caller re-runs analysis with this room; the step follows from that.
      return { ...state, userScene: action.room };

    case 'roomReset':
      // "Change room type" — back to the picker, forgetting the previous answer.
      return { ...state, userScene: null, step: 'scene' };

    case 'surfaceChosen': {
      // Moving to another surface re-anchors to that surface's default spot.
      const pos = state.scene ? defaultAnchor(action.rule, action.surface, state.scene) : state.pos;
      return { ...state, surface: action.surface, pos };
    }

    case 'moved':
      return { ...state, pos: action.pos };

    case 'yawChanged':
      return { ...state, yaw: action.yaw };

    case 'scaleChanged':
      return { ...state, scaleMult: action.scaleMult };

    case 'calibrateStarted':
      return { ...state, step: 'calibrate', calibPts: [] };

    case 'calibrateCancelled':
      return { ...state, step: 'place', calibPts: [] };

    case 'calibPointAdded': {
      // Two points make a measurement; a third starts a fresh one.
      const calibPts = state.calibPts.length >= 2 ? [action.point] : [...state.calibPts, action.point];
      return { ...state, calibPts };
    }

    case 'calibrated':
      return { ...state, step: 'place', manual: action.manual, calibPts: [] };

    case 'compositeStarted':
      return { ...state, step: 'compositing', busy: action.message, error: null };

    case 'composited':
      return { ...state, step: 'result', result: action.result, busy: null };

    case 'failed':
      // Never leave a spinner running behind an error.
      return { ...state, error: action.error, busy: null };

    case 'errorDismissed':
      return { ...state, error: null };

    case 'placeAgain':
      // "Try another spot": keep the photo and the scene, drop the composite made from them.
      return { ...state, step: 'place', result: null };

    case 'retake':
      // Back to the camera, keeping only what the user chose rather than what we measured:
      // the room type and the surface survive, every judgement about the old photo does not.
      return {
        ...state,
        step: 'capture',
        photo: null,
        scene: null,
        gate: null,
        result: null,
        manual: null,
        calibPts: [],
        busy: null,
        error: null,
      };
  }
}

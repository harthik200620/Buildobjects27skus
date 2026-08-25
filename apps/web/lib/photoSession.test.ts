import type { GateResult, PlacementRule, SceneAnalysis } from '@buildobjects/ar-engine';
import { describe, expect, it } from 'vitest';
import { type Composite, initialSession, type PhotoAction, photoSessionReducer } from '@/components/ar/photoSession';

const rule = { surfaces: ['wall', 'floor'], orientation: 'wall_flush' } as unknown as PlacementRule;
const scene = { provider: 'mock', surfaces: [], horizonY: 0.5 } as unknown as SceneAnalysis;
const allowed = { allowed: true, surface: 'wall' } as unknown as GateResult;
const refused = { allowed: false, reason: 'wrong room' } as unknown as GateResult;
const composite = { dataUrl: 'data:image/png;base64,x', ms: 120 } as unknown as Composite;
const photo = { width: 1600, height: 900 } as unknown as HTMLCanvasElement;

/** Applies a sequence of actions to a fresh session. */
const run = (...actions: PhotoAction[]) => actions.reduce(photoSessionReducer, initialSession(rule));

describe('photoSession', () => {
  it('starts at capture with nothing measured', () => {
    const s = initialSession(rule);
    expect(s).toMatchObject({ step: 'capture', photo: null, scene: null, gate: null, result: null, scaleMult: 1 });
    expect(s.surface).toBe('wall');
  });

  it('walks the happy path to a composite', () => {
    const s = run(
      { type: 'photoTaken', photo },
      { type: 'analysisStarted' },
      { type: 'gateAllowed', scene, gate: allowed, surface: 'wall', pos: { x: 0.4, y: 0.6 } },
      { type: 'compositeStarted', message: 'Integrating…' },
      { type: 'composited', result: composite },
    );
    expect(s.step).toBe('result');
    expect(s.result).toBe(composite);
    expect(s.busy).toBeNull();
  });

  it('stops at the gate when the product does not belong in the room', () => {
    const s = run({ type: 'photoTaken', photo }, { type: 'analysisStarted' }, { type: 'gateRefused', scene, gate: refused });
    expect(s.step).toBe('gate');
    expect(s.gate).toBe(refused);
    expect(s.busy).toBeNull();
  });

  it('asks for the room type when the analyser cannot name it', () => {
    const s = run({ type: 'photoTaken', photo }, { type: 'analysisStarted' }, { type: 'sceneUnknown', scene });
    expect(s.step).toBe('scene');
    expect(s.busy).toBeNull();
  });

  it('a new photo invalidates every judgement about the previous one', () => {
    const s = run(
      { type: 'photoTaken', photo },
      { type: 'gateAllowed', scene, gate: allowed, surface: 'wall', pos: { x: 0.4, y: 0.6 } },
      { type: 'composited', result: composite },
      { type: 'calibrated', manual: { px: 400, realMm: 2030, kind: 'door' } },
      { type: 'photoTaken', photo },
    );
    expect(s).toMatchObject({ scene: null, gate: null, result: null, manual: null, calibPts: [] });
  });

  it('retake returns to capture and clears the old photo entirely', () => {
    const s = run(
      { type: 'photoTaken', photo },
      { type: 'gateAllowed', scene, gate: allowed, surface: 'floor', pos: { x: 0.4, y: 0.6 } },
      { type: 'composited', result: composite },
      { type: 'retake' },
    );
    expect(s).toMatchObject({ step: 'capture', photo: null, scene: null, gate: null, result: null, busy: null });
  });

  it('retake keeps what the user chose, not what we measured', () => {
    const s = run(
      { type: 'photoTaken', photo },
      { type: 'roomChosen', room: 'bathroom' },
      { type: 'gateAllowed', scene, gate: allowed, surface: 'floor', pos: { x: 0.4, y: 0.6 } },
      { type: 'scaleChanged', scaleMult: 2 },
      { type: 'retake' },
    );
    expect(s.userScene).toBe('bathroom');
    expect(s.surface).toBe('floor');
    expect(s.scaleMult).toBe(2);
  });

  it('collects two calibration points, then starts over on a third', () => {
    const a = { x: 10, y: 20 };
    const b = { x: 10, y: 420 };
    const c = { x: 99, y: 99 };
    expect(run({ type: 'calibrateStarted' }, { type: 'calibPointAdded', point: a }).calibPts).toEqual([a]);
    expect(run({ type: 'calibrateStarted' }, { type: 'calibPointAdded', point: a }, { type: 'calibPointAdded', point: b }).calibPts).toEqual([a, b]);
    // A third tap begins a new measurement rather than silently extending the old one.
    const three = run(
      { type: 'calibrateStarted' },
      { type: 'calibPointAdded', point: a },
      { type: 'calibPointAdded', point: b },
      { type: 'calibPointAdded', point: c },
    );
    expect(three.calibPts).toEqual([c]);
  });

  it('calibrating returns to placement and drops the working points', () => {
    const manual = { px: 400, realMm: 2030, kind: 'door' };
    const s = run({ type: 'calibrateStarted' }, { type: 'calibPointAdded', point: { x: 1, y: 2 } }, { type: 'calibrated', manual });
    expect(s).toMatchObject({ step: 'place', manual, calibPts: [] });
  });

  it('starting calibration discards points left from a previous attempt', () => {
    const s = run({ type: 'calibrateStarted' }, { type: 'calibPointAdded', point: { x: 1, y: 2 } }, { type: 'calibrateStarted' });
    expect(s.calibPts).toEqual([]);
  });

  it('an error never leaves a spinner running', () => {
    const s = run({ type: 'compositeStarted', message: 'Integrating…' }, { type: 'failed', error: 'model unavailable' });
    expect(s.error).toBe('model unavailable');
    expect(s.busy).toBeNull();
  });

  it('changing surface re-anchors to that surface default when a scene is known', () => {
    const withScene = run({ type: 'photoTaken', photo }, { type: 'gateAllowed', scene, gate: allowed, surface: 'wall', pos: { x: 0.4, y: 0.6 } });
    const moved = photoSessionReducer(withScene, { type: 'surfaceChosen', surface: 'floor', rule });
    expect(moved.surface).toBe('floor');
    // defaultAnchor decides where; the point is that it moved off the old spot deliberately.
    expect(moved.pos).not.toBe(withScene.pos);
  });

  it('"change room type" forgets the previous answer and returns to the picker', () => {
    const s = run({ type: 'roomChosen', room: 'kitchen' }, { type: 'roomReset' });
    expect(s).toMatchObject({ userScene: null, step: 'scene' });
  });

  it('choosing a room does not move the step — the caller re-runs analysis', () => {
    const s = run({ type: 'photoTaken', photo }, { type: 'roomChosen', room: 'kitchen' });
    expect(s.userScene).toBe('kitchen');
    expect(s.step).toBe('capture');
  });

  it('cancelling calibration returns to placement without recording a measurement', () => {
    const s = run(
      { type: 'gateAllowed', scene, gate: allowed, surface: 'wall', pos: { x: 0.5, y: 0.5 } },
      { type: 'calibrateStarted' },
      { type: 'calibPointAdded', point: { x: 1, y: 2 } },
      { type: 'calibrateCancelled' },
    );
    expect(s).toMatchObject({ step: 'place', calibPts: [], manual: null });
  });

  it('"try another spot" keeps the photo and scene but drops the composite', () => {
    const s = run(
      { type: 'photoTaken', photo },
      { type: 'gateAllowed', scene, gate: allowed, surface: 'wall', pos: { x: 0.5, y: 0.5 } },
      { type: 'composited', result: composite },
      { type: 'placeAgain' },
    );
    expect(s).toMatchObject({ step: 'place', result: null });
    expect(s.photo).toBe(photo);
    expect(s.scene).toBe(scene);
  });

  it('changing surface without a scene leaves the position alone', () => {
    const s = initialSession(rule);
    const moved = photoSessionReducer(s, { type: 'surfaceChosen', surface: 'floor', rule });
    expect(moved.pos).toEqual(s.pos);
  });
});

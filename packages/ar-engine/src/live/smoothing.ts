import type { ReferenceObject, SceneAnalysis, SceneType, SurfaceDetection } from '../types';

/** Exponential moving average: prev + alpha·(next − prev). alpha = 1 takes the new value outright. */
export const ema = (prev: number, next: number, alpha: number): number => prev + alpha * (next - prev);

/** Confidence multiplier for a surface / reference the latest analysis no longer reports. */
export const SMOOTH_DECAY = 0.6;
/** Decayed detections below this confidence are dropped. */
export const SMOOTH_DROP = 0.2;
/** Scene type = the majority of this many recent analyses (ties → the latest). */
export const SCENE_HISTORY = 3;

type Bbox = [number, number, number, number];

/** A SceneAnalysis plus the recent raw scene types the majority vote was taken over. */
export interface SmoothedScene extends SceneAnalysis {
  sceneHistory: SceneType[];
}

const byConfidence = <T extends { confidence: number }>(a: T, b: T) => b.confidence - a.confidence;

function emaBbox(prev: Bbox | undefined, next: Bbox | undefined, alpha: number): Bbox | undefined {
  if (prev && next) return [ema(prev[0], next[0], alpha), ema(prev[1], next[1], alpha), ema(prev[2], next[2], alpha), ema(prev[3], next[3], alpha)];
  return next ?? prev;
}

/** Majority of the history; ties resolve to the most recent entry. */
export function majorityScene(history: SceneType[]): SceneType {
  if (history.length === 0) return 'unknown';
  const counts = new Map<SceneType, number>();
  for (const s of history) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: SceneType = history[history.length - 1],
    bestN = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i],
      n = counts.get(s) ?? 0;
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best;
}

/**
 * Frame-to-frame smoothing of the live analysis. Surfaces merge by type (confidence + bbox EMA;
 * a surface the new frame does not report decays ×0.6 per frame and drops below 0.2; a new
 * surface enters at its raw confidence), references merge by kind the same way, horizonY /
 * freeArea / lighting.brightness are EMA'd, and the scene type is the majority of the last 3
 * raw types. Pure — returns a fresh object carrying its own `sceneHistory`.
 */
export function smoothScene(prev: SceneAnalysis | SmoothedScene | null, next: SceneAnalysis, alpha = 0.5): SmoothedScene {
  if (!prev) return { ...next, surfaces: [...next.surfaces].sort(byConfidence), references: [...next.references], sceneHistory: [next.sceneType] };
  const prevHistory = 'sceneHistory' in prev && Array.isArray(prev.sceneHistory) ? prev.sceneHistory : [prev.sceneType];
  const sceneHistory = [...prevHistory, next.sceneType].slice(-SCENE_HISTORY);

  const surfaces: SurfaceDetection[] = [];
  for (const n of next.surfaces) {
    const p = prev.surfaces.find((s) => s.type === n.type);
    surfaces.push(p ? { type: n.type, confidence: ema(p.confidence, n.confidence, alpha), bbox: emaBbox(p.bbox, n.bbox, alpha) } : { ...n });
  }
  for (const p of prev.surfaces) {
    if (next.surfaces.some((s) => s.type === p.type)) continue;
    const confidence = p.confidence * SMOOTH_DECAY;
    if (confidence >= SMOOTH_DROP) surfaces.push({ ...p, confidence });
  }

  const references: ReferenceObject[] = [];
  for (const n of next.references) {
    const p = prev.references.find((r) => r.kind === n.kind);
    references.push(
      p ? { ...n, px: ema(p.px, n.px, alpha), confidence: ema(p.confidence, n.confidence, alpha), bbox: emaBbox(p.bbox, n.bbox, alpha) } : { ...n },
    );
  }
  for (const p of prev.references) {
    if (next.references.some((r) => r.kind === p.kind)) continue;
    const confidence = p.confidence * SMOOTH_DECAY;
    if (confidence >= SMOOTH_DROP) references.push({ ...p, confidence });
  }

  return {
    ...next,
    sceneType: majorityScene(sceneHistory),
    sceneConfidence: ema(prev.sceneConfidence, next.sceneConfidence, alpha),
    surfaces: surfaces.sort(byConfidence),
    references,
    freeArea: ema(prev.freeArea, next.freeArea, alpha),
    horizonY: ema(prev.horizonY, next.horizonY, alpha),
    lighting: { ...next.lighting, brightness: ema(prev.lighting.brightness, next.lighting.brightness, alpha) },
    sceneHistory,
  };
}

import type { GateResult, PlacementRule, SceneAnalysis, Surface } from './types';

export const GATE_VERSION = 2;
const MIN_SURFACE_CONFIDENCE = 0.35;

/**
 * The scene gate. A product is placed only where it belongs: the scene type must not be a
 * rejected one, must be an allowed one when the rule restricts scenes, and one of the rule's
 * surfaces must be visible with enough confidence. Refusals carry the guidance chip text.
 * Every result also carries `kind` + `sceneConfidence` so the live-camera hysteresis can apply
 * its fast paths (instant allow on a confident scene, instant refusal on a reject-scene).
 */
export function gate(rule: PlacementRule, scene: SceneAnalysis): GateResult {
  const guidance = `Point at a ${rule.surfaceLabel} to place this`;
  const sceneConfidence = scene.sceneConfidence;
  if (rule.rejectScenes?.includes(scene.sceneType) && scene.sceneConfidence >= 0.5) {
    return {
      allowed: false,
      surface: null,
      reason: `A ${rule.category.replace(/-/g, ' ')} does not belong in a ${scene.sceneType.replace(/_/g, ' ')}`,
      guidance,
      confidence: scene.sceneConfidence,
      kind: 'reject_scene',
      sceneConfidence,
    };
  }
  if (rule.scenes !== 'any' && scene.sceneType !== 'unknown' && !rule.scenes.includes(scene.sceneType) && scene.sceneConfidence >= 0.5) {
    return {
      allowed: false,
      surface: null,
      reason: `This needs ${rule.scenes.map((s) => s.replace(/_/g, ' ')).join(' / ')} — the photo looks like a ${scene.sceneType.replace(/_/g, ' ')}`,
      guidance,
      confidence: scene.sceneConfidence,
      kind: 'wrong_scene',
      sceneConfidence,
    };
  }
  const visible = scene.surfaces.filter((s) => s.confidence >= MIN_SURFACE_CONFIDENCE);
  const pick = rule.surfaces
    .map((want) =>
      visible.find((s) => s.type === want || (want === 'ground' && s.type === 'floor' && (scene.sceneType === 'exterior' || scene.sceneType === 'site'))),
    )
    .find(Boolean);
  if (!pick) {
    return {
      allowed: false,
      surface: null,
      reason: visible.length ? `No ${rule.surfaceLabel} is visible — I can see ${visible.map((s) => s.type).join(', ')}` : 'No usable surface is visible',
      guidance,
      confidence: Math.max(...visible.map((s) => s.confidence), 0),
      kind: 'no_surface',
      sceneConfidence,
    };
  }
  // Amazon wall-fit guard: if wall/ceiling is needed but the detected wall sits at the bottom of the frame (camera tilted down), refuse with an actionable chip.
  if (pick.bbox) {
    const [, y, , h] = pick.bbox;
    const wallLow = pick.type === 'wall' && y + h > 0.78 && y > 0.32;
    const ceilingNeed = rule.surfaces.includes('ceiling') || rule.surfaces.includes('wall');
    if (wallLow && ceilingNeed && scene.horizonY > 0.52) {
      return {
        allowed: false,
        surface: pick.type as Surface,
        reason: 'Wall is near the bottom of the frame',
        guidance: 'Move camera up — point higher on the wall or tilt up to show the ceiling',
        confidence: pick.confidence,
        kind: 'no_surface',
        sceneConfidence,
      };
    }
  }
  if (scene.freeArea < 0.05)
    return {
      allowed: false,
      surface: pick.type,
      reason: 'Too little free space on that surface',
      guidance: 'Step back so more of the surface is visible',
      confidence: pick.confidence,
      kind: 'no_space',
      sceneConfidence,
    };
  return {
    allowed: true,
    surface: pick.type as Surface,
    reason: `Placing on the ${pick.type}`,
    guidance: '',
    confidence: pick.confidence,
    kind: 'allow',
    sceneConfidence,
  };
}

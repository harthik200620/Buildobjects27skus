import 'server-only';
import type { CompositeRequest, CompositeResult, SceneAnalysis, SceneType, Surface } from '@buildobjects/ar-engine';
import { geminiClient } from '@buildobjects/llm';

/**
 * AR photo-mode providers. Live = Gemini (scene understanding as strict JSON, generative
 * compositing with the geometry-locked overlay + mask + SKU reference). Without GEMINI_API_KEY
 * the client runs the deterministic luminance analyser and the composite step returns the
 * overlay itself, both clearly labelled `mock`. Set GEMINI_API_KEY to unlock live mode.
 */
export const geminiLive = () => !!process.env.GEMINI_API_KEY;
const VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';

const SCENES: SceneType[] = ['living_room', 'bedroom', 'kitchen', 'bathroom', 'office', 'corridor', 'exterior', 'site', 'roof', 'unknown'];
const SURFACES: Surface[] = ['floor', 'wall', 'ceiling', 'window', 'roof', 'ground', 'table'];
const REFS = ['door', 'switch_plate', 'tile_joint', 'a4_sheet', 'brick', 'person', 'ceiling_fan', 'window'] as const;
const REF_MM: Record<(typeof REFS)[number], number> = {
  door: 2030,
  switch_plate: 86,
  tile_joint: 600,
  a4_sheet: 297,
  brick: 190,
  person: 1700,
  ceiling_fan: 1200,
  window: 1200,
};

const analysisSchema = {
  type: 'object',
  properties: {
    scene_type: { type: 'string', enum: SCENES },
    scene_confidence: { type: 'number' },
    surfaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: SURFACES },
          confidence: { type: 'number' },
          bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        },
        required: ['type', 'confidence', 'bbox'],
      },
    },
    references: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...REFS] },
          extent: {
            type: 'number',
            description:
              'length of the reference along its real dimension as a fraction of the image HEIGHT (door height, person height) or WIDTH (switch plate width, tile joint spacing)',
          },
          axis: { type: 'string', enum: ['height', 'width'] },
          bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
          confidence: { type: 'number' },
        },
        required: ['kind', 'extent', 'axis', 'bbox', 'confidence'],
      },
    },
    free_area: { type: 'number' },
    horizon_y: { type: 'number' },
    lighting: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['left', 'right', 'top', 'front', 'unknown'] },
        warm: { type: 'boolean' },
        brightness: { type: 'number' },
      },
      required: ['direction', 'warm', 'brightness'],
    },
    notes: { type: 'string' },
  },
  required: ['scene_type', 'scene_confidence', 'surfaces', 'references', 'free_area', 'horizon_y', 'lighting', 'notes'],
};

export async function analyzeSceneLive(image: { mimeType: string; base64: string }, width: number, height: number, category: string): Promise<SceneAnalysis> {
  const ai = geminiClient();
  const res = await ai.models.generateContent({
    model: VISION_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: image.mimeType, data: image.base64 } },
          {
            text: `This photo was taken to place a ${category.replace(/-/g, ' ')} product into the room at true physical scale. Classify the scene and identify all visible planes: walls (vertical side/back wall planes), floor (carpet, tiles, hardwood), ceiling (overhead plane), and furniture/tables. Even if the camera is tilted or looking downward/upward at an angle, always detect all visible wall areas (type: "wall", confidence >= 0.8) and floor areas (type: "floor"). List each planar surface with its normalised bounding box [x, y, w, h] (0–1, origin top-left). List visible real-world references (doors, switch plates, books, frames, A4 sheets, tile joints, fans, people) with their fractional extent along height/width. Estimate the horizon line (horizon_y: 0–1) and lighting direction/temperature.`,
          },
        ],
      },
    ],
    config: { responseMimeType: 'application/json', responseJsonSchema: analysisSchema, temperature: 0.1 },
  });
  const raw = JSON.parse(res.text ?? '{}') as Record<string, unknown>;
  const clamp01 = (v: unknown, d = 0.5) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  const bbox = (b: unknown): [number, number, number, number] | undefined =>
    Array.isArray(b) && b.length === 4 ? [clamp01(b[0], 0), clamp01(b[1], 0), clamp01(b[2], 1), clamp01(b[3], 1)] : undefined;
  const surfaces = (Array.isArray(raw.surfaces) ? raw.surfaces : [])
    .filter((s) => SURFACES.includes((s as { type: Surface }).type))
    .map((s) => {
      const x = s as { type: Surface; confidence: number; bbox: unknown };
      return { type: x.type, confidence: clamp01(x.confidence, 0.5), bbox: bbox(x.bbox) };
    });
  const references = (Array.isArray(raw.references) ? raw.references : [])
    .filter((r) => (REFS as readonly string[]).includes((r as { kind: string }).kind))
    .map((r) => {
      const x = r as { kind: (typeof REFS)[number]; extent: number; axis: 'height' | 'width'; bbox: unknown; confidence: number };
      const px = clamp01(x.extent, 0) * (x.axis === 'width' ? width : height);
      return { kind: x.kind, realMm: REF_MM[x.kind], px, bbox: bbox(x.bbox), confidence: clamp01(x.confidence, 0.5) };
    });
  const lighting = (raw.lighting ?? {}) as { direction?: string; warm?: boolean; brightness?: number };
  return {
    sceneType: SCENES.includes(raw.scene_type as SceneType) ? (raw.scene_type as SceneType) : 'unknown',
    sceneConfidence: clamp01(raw.scene_confidence, 0.5),
    surfaces: surfaces.sort((a, b) => b.confidence - a.confidence),
    references,
    freeArea: clamp01(raw.free_area, 0.5),
    horizonY: clamp01(raw.horizon_y, 0.45),
    lighting: {
      direction: (['left', 'right', 'top', 'front', 'unknown'] as const).includes(lighting.direction as never) ? (lighting.direction as 'left') : 'unknown',
      warm: !!lighting.warm,
      brightness: clamp01(lighting.brightness, 0.5),
    },
    provider: 'gemini',
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

const INTEGRATION: Record<CompositeRequest['rule']['integration'], string> = {
  rests_on: 'resting on the surface with a soft contact shadow',
  mounted: 'mounted flush on the surface with its bracket, casting a soft shadow consistent with the room light',
  recessed: 'fitted INTO the surface (a recess / holder) so it reads as installed, glowing if it is a lamp',
  resurfaces: 'covering the marked region of the surface as the new surface finish, matching the perspective and grout lines',
  replaces_pane: 'replacing the glass pane in the marked opening, with the room reflections a real pane would show',
  stands_on: 'standing on the ground on its own support, at the marked size',
};

const SURFACE_NOUN: Record<string, string> = {
  wall: 'wall',
  window: 'window pane',
  ceiling: 'ceiling',
  floor: 'floor',
  ground: 'ground',
  roof: 'roof',
  table: 'table',
};

/** A surface-aware mounting phrase — a wall lamp protrudes out of a wall; the location must not move. */
function mountingPhrase(req: CompositeRequest): string {
  const s = req.placement.surface;
  const base = INTEGRATION[req.rule.integration];
  if (s === 'wall' || s === 'window') return `${base}, on the vertical ${s} surface — mounted flush against it and protruding OUTWARD into the room`;
  return base;
}

export async function compositeLive(req: CompositeRequest): Promise<CompositeResult> {
  const ai = geminiClient();
  const t0 = Date.now();
  const surface = SURFACE_NOUN[req.placement.surface] ?? req.placement.surface;
  const prompt = `Edit the FIRST image (the room photo). The SECOND image is the same photo with the product already placed at the correct size, position and perspective — keep that geometry EXACTLY and keep the product at that exact spot. The THIRD image is a mask: the white region marks precisely where the product sits. The product is MOUNTED ON THE ${surface.toUpperCase()} at the masked location — it must stay there, ON the ${surface}; do NOT move it to the floor, ceiling, a table or any other surface. The FOURTH image is the official reference of the product: ${req.product.brand} ${req.product.name} (${req.product.category.replace(/-/g, ' ')}, ${req.product.dims.w_mm}×${req.product.dims.h_mm}×${req.product.dims.d_mm} mm). Produce the photo with the product integrated photorealistically: ${mountingPhrase(req)}, matching the scene's light (${req.scene.lighting.direction} light, ${req.scene.lighting.warm ? 'warm' : 'neutral'}), shadows and occlusion. The product's shape, colour, finish and branding must match the reference — do not restyle it, do not add other objects, do not change the room. Output only the edited image at the same size as the input.`;
  const parts = [
    { inlineData: { mimeType: req.photo.mimeType, data: req.photo.base64 } },
    { inlineData: { mimeType: req.overlay.mimeType, data: req.overlay.base64 } },
    { inlineData: { mimeType: req.mask.mimeType, data: req.mask.base64 } },
    { inlineData: { mimeType: req.productReference.mimeType, data: req.productReference.base64 } },
    { text: prompt },
  ];
  const res = await ai.models.generateContent({ model: IMAGE_MODEL, contents: [{ role: 'user', parts }], config: { responseModalities: ['IMAGE'] } as never });
  const candidates = (res as unknown as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] }).candidates ?? [];
  const img = candidates.flatMap((c) => c.content?.parts ?? []).find((p) => p.inlineData?.data)?.inlineData;
  if (!img?.data) throw new Error('The image model returned no image');
  return {
    image: { mimeType: img.mimeType ?? 'image/png', base64: img.data },
    provider: 'gemini',
    fidelity: -1,
    attempts: 1,
    note: `Generated in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  };
}

/** The mock composite is the geometry-locked overlay itself — never a fake "AI" result. */
export function compositeMock(req: CompositeRequest): CompositeResult {
  return {
    image: req.overlay,
    provider: 'mock',
    fidelity: 1,
    attempts: 1,
    note: 'Overlay composite with a drawn contact shadow. Set GEMINI_API_KEY for generative light, shadow and occlusion.',
  };
}

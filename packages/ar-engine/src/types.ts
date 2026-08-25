export type Surface = 'floor' | 'wall' | 'ceiling' | 'window' | 'roof' | 'ground' | 'table';
export type SceneType = 'living_room' | 'bedroom' | 'kitchen' | 'bathroom' | 'office' | 'corridor' | 'exterior' | 'site' | 'roof' | 'unknown';
export type Orientation = 'upright' | 'flat' | 'hanging' | 'wall_flush' | 'ceiling_flush';
/** Coarse device class — drives the default lens FOV, camera height and whether orientation sensors are expected. */
export type DeviceClass = 'phone' | 'laptop' | 'unknown';

export interface ProductDims {
  w_mm: number;
  h_mm: number;
  d_mm: number;
}

/** Per-category placement rule — the gate and the placer both read it. */
export interface PlacementRule {
  category: string;
  /** Surfaces the product may be placed on, best first. */
  surfaces: Surface[];
  /** Scenes in which the product belongs; 'any' = no scene restriction. */
  scenes: SceneType[] | 'any';
  /** Scenes that are explicitly wrong (a bathtub in a living room). */
  rejectScenes?: SceneType[];
  orientation: Orientation;
  /** Which face of the bounding box touches the surface. */
  anchor: 'bottom' | 'top' | 'back' | 'center';
  /** Distance from the surface to the anchor face, e.g. a bracket stand-off. */
  mountOffsetMm: number;
  /** Typical mounting height band above the floor for wall items (min, max) — informs the default drop point. */
  heightBandMm?: [number, number];
  minClearanceMm: number;
  /** The guidance chip when the gate refuses: "Point at a {surfaceLabel} to place this". */
  surfaceLabel: string;
  /** How the composite should integrate the product into the surface. */
  integration: 'rests_on' | 'mounted' | 'recessed' | 'resurfaces' | 'replaces_pane' | 'stands_on';
}

export interface SurfaceDetection {
  type: Surface;
  confidence: number /** normalised [x, y, w, h] of the visible region */;
  bbox?: [number, number, number, number];
  /**
   * Horizontal distance to the surface in metres, when it could be measured rather than assumed.
   *
   * Only present for a wall whose base is visible — the floor line gives it exactly. Absent means
   * "not known", and callers must treat it that way: distance sets the projected size of the
   * product, so substituting a default here is what made a fire extinguisher render at twice life
   * size against a far wall.
   */
  distanceM?: number;
}
export interface ReferenceObject {
  kind: 'door' | 'switch_plate' | 'tile_joint' | 'a4_sheet' | 'brick' | 'person' | 'ceiling_fan' | 'window';
  realMm: number /** measured pixel extent along the real dimension */;
  px: number;
  bbox?: [number, number, number, number];
  confidence: number;
}

export interface SceneAnalysis {
  sceneType: SceneType;
  sceneConfidence: number;
  surfaces: SurfaceDetection[];
  references: ReferenceObject[];
  /** 0–1: how much free placement area is visible on the best surface. */
  freeArea: number;
  /** Normalised y of the horizon / eye-level line, for the depth model. */
  horizonY: number;
  lighting: { direction: 'left' | 'right' | 'top' | 'front' | 'unknown'; warm: boolean; brightness: number };
  /* 'device' = the on-device vision in src/vision (no API key, no round trip). */
  provider: 'gemini' | 'device' | 'mock';
  notes?: string;
  /** Live mode: round-trip latency of the analysis call that produced this frame, ms. */
  latencyMs?: number;
  /** Live mode: the model id that produced this analysis (e.g. gemini-2.5-flash). */
  model?: string;
}

/** Why the gate decided what it did — lets the live hysteresis apply its fast paths without parsing reason text. */
export type GateKind = 'allow' | 'reject_scene' | 'wrong_scene' | 'no_surface' | 'no_space';

export interface GateResult {
  allowed: boolean;
  surface: Surface | null;
  reason: string;
  guidance: string;
  confidence: number;
  kind?: GateKind;
  /** The scene-type confidence of the analysis the verdict was made on (the `confidence` field is the surface confidence for allows). */
  sceneConfidence?: number;
}

export interface ScaleEstimate {
  mmPerPx: number;
  confidence: number;
  source: 'reference' | 'manual' | 'default';
  referenceKind?: string;
  note: string;
}

export interface Placement {
  surface: Surface;
  /** Normalised position of the anchor point in the photo. */
  x: number;
  y: number;
  /** Rendered product size in normalised photo units at this depth. */
  w: number;
  h: number;
  rotationDeg: number;
  /** Depth multiplier relative to the reference plane (1 = at the reference's depth). */
  depth: number;
  mmPerPxHere: number;
}

export interface CompositeRequest {
  photo: { mimeType: string; base64: string };
  overlay: { mimeType: string; base64: string }; // the photo with the product already placed (geometry + perspective locked)
  mask: { mimeType: string; base64: string }; // white where the product sits
  productReference: { mimeType: string; base64: string }; // the SKU's hero render / photo
  product: { name: string; brand: string; category: string; dims: ProductDims };
  placement: Placement;
  rule: PlacementRule;
  scene: SceneAnalysis;
}
export interface CompositeResult {
  image: { mimeType: string; base64: string };
  /* 'device' = the on-device vision in src/vision (no API key, no round trip). */
  provider: 'gemini' | 'device' | 'mock';
  fidelity: number;
  attempts: number;
  note: string;
}

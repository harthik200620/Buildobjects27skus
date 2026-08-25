/** Shared AR vocabulary — the placement rules live in @buildobjects/ar-engine; these are the types everyone reads. */
export type Surface = 'floor' | 'wall' | 'ceiling' | 'window' | 'roof' | 'ground' | 'table';
export type SceneType = 'living_room' | 'bedroom' | 'kitchen' | 'bathroom' | 'office' | 'corridor' | 'exterior' | 'site' | 'roof' | 'unknown';

export interface ProductDims {
  w_mm: number;
  h_mm: number;
  d_mm: number;
  weight_kg?: number | null;
}

/**
 * How a SKU's 3D model was made, best first:
 *  - `photoreal`   — an image-to-3D model (Meshy / Tripo) or a supplied brand GLB at `assets/3d/{SKU}.glb`;
 *  - `textured`    — the parametric model at true dimensions, wearing the SKU's photo cut-outs;
 *  - `placeholder` — the flat-colour parametric model (honest stand-in).
 */
export type AssetQuality = 'photoreal' | 'textured' | 'placeholder';
export type AssetProvider = 'meshy' | 'tripo' | 'parametric' | 'supplied';

export interface AssetQualityReport {
  /** 0–1 from the vision judge (`judgeModelMatch`); null when no judge ran. */
  overall: number | null;
  defects: string[];
  judge: 'llm' | 'skipped';
  /** Best silhouette IoU of the model against the hero cut-out over the four yaws; null = no cut-out to compare. */
  silhouette_iou?: number | null;
  /** Worst per-axis mismatch between the provider model's proportions and the spec dims (fraction, 0.15 = 15 %). */
  aspect_mismatch?: number | null;
  warnings: string[];
  note?: string;
}

export interface AssetTextures {
  /** Distinct images embedded in the GLB. */
  count: number;
  max_px?: number;
  /** Media keys (or provider texture names) the images came from. */
  sources?: string[];
  /** sRGB 0–1 mean colour of the hero cut-out, when a builder used it (glass tint, cctv body). */
  mean_colour?: [number, number, number];
}

export interface AssetManifestEntry {
  file: string;
  category: string;
  placeholder: boolean;
  dims_mm: { w: number; h: number; d: number };
  bbox_m?: { x: number; y: number; z: number };
  triangles?: number;
  builder?: string;
  variant?: string;
  usdz?: string | null;
  // ── photoreal / textured pipeline (all optional; older manifests simply lack them) ──
  quality?: AssetQuality;
  provider?: AssetProvider;
  /** Media keys of the images the model was built from (cut-outs preferred). */
  source_images?: string[];
  /** Provider task id, for audit / resume. */
  job_id?: string | null;
  generated_at?: string;
  /** Axis permutation applied to the provider model, as target = f(source), e.g. "x,z,-y" for a Z-up source. */
  axis_map?: string;
  /** Yaw (degrees about +Y) applied so the photographed front faces +Z. */
  front_yaw_deg?: number;
  quality_report?: AssetQualityReport | null;
  textures?: AssetTextures | null;
  /** Human-readable caveat, e.g. "judge skipped — no vision key". */
  note?: string;
}
export interface AssetManifest {
  generated_at: string;
  assets: Record<string, AssetManifestEntry>;
}

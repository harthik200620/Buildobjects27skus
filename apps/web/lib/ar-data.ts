import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { type PlacementRule, type ProductDims, ruleFor } from '@buildobjects/ar-engine';
import type { AssetManifest, AssetManifestEntry, AssetQuality } from '@buildobjects/catalog';
import { loadSkuPage } from './catalog';
import { mediaUrl } from './media';
import { resolveStorageDir } from './storage-root';

const ASSETS = resolveStorageDir(process.env.ASSETS_3D_ROOT, './assets/3d');

export function loadManifest(): AssetManifest | null {
  try {
    return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(ASSETS, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}
function realGlb(code: string): boolean {
  return fs.existsSync(/* turbopackIgnore: true */ path.join(ASSETS, `${code}.glb`));
}
function hasGlb(code: string): boolean {
  return realGlb(code) || fs.existsSync(/* turbopackIgnore: true */ path.join(ASSETS, 'placeholders', `${code}.glb`));
}
/** A USDZ next to the GLB (manifest `usdz` or `{code}.usdz` by convention) — iOS Quick Look prefers it over a client-side export. */
function usdzFor(code: string, asset: AssetManifestEntry | null): string | null {
  const candidates = [asset?.usdz ?? null, `${code}.usdz`].filter((f): f is string => !!f && !f.includes('..'));
  for (const f of candidates) {
    if (fs.existsSync(/* turbopackIgnore: true */ path.join(ASSETS, f))) return `/3d/${f.replace(/\\/g, '/')}`;
  }
  return null;
}

/** The model's honesty label. Manifest fields from the photoreal pipeline (T7) are optional — older manifests simply lack them. */
function qualityFor(code: string, asset: AssetManifestEntry | null): AssetQuality {
  const q = asset?.quality;
  if (q === 'photoreal' || q === 'textured' || q === 'placeholder') return q;
  if (asset) return asset.placeholder ? 'placeholder' : 'photoreal';
  return realGlb(code) ? 'photoreal' : 'placeholder';
}

function modelNoteFor(quality: AssetQuality, asset: AssetManifestEntry | null, hasModel: boolean): string {
  if (!hasModel) return 'Photo cut-out (no 3D model yet)';
  if (asset?.note) return asset.note;
  const judge = asset?.quality_report?.overall;
  const judged = typeof judge === 'number' ? ` · match ${Math.round(judge * 100)} %` : '';
  switch (quality) {
    case 'photoreal':
      return `${asset?.provider && asset.provider !== 'supplied' && asset.provider !== 'parametric' ? `Photoreal model (${asset.provider})` : 'Brand 3D model'} at true dimensions${judged}`;
    case 'textured':
      return `Parametric model at true dimensions wearing the product photos${judged}`;
    default:
      return 'Parametric placeholder at true dimensions — a real GLB replaces it by filename';
  }
}

export interface ArProduct {
  code: string;
  name: string;
  brand: string;
  category: string;
  categoryName: string;
  dims: ProductDims;
  glbUrl: string | null;
  placeholder: boolean;
  asset: AssetManifestEntry | null;
  /** How the model was made — drives the "3D · photoreal / textured / placeholder" label. */
  quality: AssetQuality;
  /** Human-readable caveat shown under the stage. */
  modelNote: string;
  /** A ready USDZ for iOS Quick Look, else null (the client exports one from the GLB). */
  usdzUrl: string | null;
  /** The SKU's hero image (cut-out PNG when the pipeline made one, else the gallery rendition) — the reference the composite is locked to. */
  referenceImage: string | null;
  price: number | null;
  unit: string;
  rule: PlacementRule;
  demo: boolean;
  pdpHref: string | null;
}

const DEFAULT_DIMS: Record<string, ProductDims> = {
  bulbs: { w_mm: 60, h_mm: 110, d_mm: 60 },
  cctv: { w_mm: 110, h_mm: 85, d_mm: 110 },
  tiles: { w_mm: 600, h_mm: 1200, d_mm: 9 },
  glass: { w_mm: 1200, h_mm: 1800, d_mm: 6 },
  'solar-panels': { w_mm: 1134, h_mm: 2278, d_mm: 35 },
  'fire-extinguishers': { w_mm: 140, h_mm: 460, d_mm: 190 },
  cement: { w_mm: 520, h_mm: 760, d_mm: 120 },
  epoxy: { w_mm: 180, h_mm: 200, d_mm: 180 },
  'total-stations': { w_mm: 200, h_mm: 350, d_mm: 180 },
  bathtub: { w_mm: 1700, h_mm: 600, d_mm: 750 },
};

/** The spec's canonical gate-demo product: a bathtub, which must be refused in a living room. */
function demoProduct(): ArProduct {
  const code = 'DEMO-BATHTUB';
  const asset = loadManifest()?.assets[code] ?? null;
  const glb = hasGlb(code);
  const quality = qualityFor(code, asset);
  return {
    code,
    name: 'Demo bathtub (gate test)',
    brand: 'Build Objects',
    category: 'bathtub',
    categoryName: 'Bathtub',
    dims: DEFAULT_DIMS.bathtub,
    glbUrl: glb ? `/3d/${code}.glb` : null,
    placeholder: true,
    asset,
    quality,
    modelNote: modelNoteFor(quality, asset, glb),
    usdzUrl: usdzFor(code, asset),
    referenceImage: null,
    price: null,
    unit: 'piece',
    rule: ruleFor('bathtub'),
    demo: true,
    pdpHref: null,
  };
}

export async function loadArProduct(code: string, as?: string | null): Promise<ArProduct | null> {
  if (as === 'bathtub' || code.toUpperCase() === 'DEMO-BATHTUB') return demoProduct();
  const data = await loadSkuPage(code);
  if (!data) return null;
  const manifest = loadManifest();
  const asset = manifest?.assets[data.sku.code] ?? null;
  const dims: ProductDims = data.dims
    ? { w_mm: data.dims.w, h_mm: data.dims.h, d_mm: data.dims.d }
    : asset
      ? { w_mm: asset.dims_mm.w, h_mm: asset.dims_mm.h, d_mm: asset.dims_mm.d }
      : (DEFAULT_DIMS[data.category.slug] ?? DEFAULT_DIMS.epoxy);
  const hero = data.images.find((i) => i.role === 'hero') ?? data.images[0];
  // T4's image pipeline adds a `cutout` key (alpha PNG) to the image view; prefer it when present.
  const cutout = (hero as { cutout?: string | null } | undefined)?.cutout ?? null;
  const glb = hasGlb(data.sku.code);
  const quality = qualityFor(data.sku.code, asset);
  return {
    code: data.sku.code,
    name: data.product.name,
    brand: data.brand.name,
    category: data.category.slug,
    categoryName: data.category.name,
    dims,
    glbUrl: glb ? `/3d/${data.sku.code}.glb` : null,
    placeholder: asset?.placeholder ?? !realGlb(data.sku.code),
    asset,
    quality,
    modelNote: modelNoteFor(quality, asset, glb),
    usdzUrl: usdzFor(data.sku.code, asset),
    referenceImage: cutout ? mediaUrl(cutout) : hero ? mediaUrl(hero.gallery) : null,
    price: data.sku.price,
    unit: data.sku.unit,
    rule: ruleFor(data.category.slug),
    demo: false,
    pdpHref: `/p/${data.sku.code.toLowerCase()}`,
  };
}

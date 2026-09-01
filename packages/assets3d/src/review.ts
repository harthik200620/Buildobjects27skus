import fs from 'node:fs';
import path from 'node:path';

/**
 * The reviewed answer to two questions the data cannot answer for itself: is the generated model
 * of this SKU actually the product, and is its photograph.
 *
 * `assets/3d/review.json` holds both, with the reason beside each entry — see the `_why` block in
 * that file for how it came about. Absence means accepted, so the file only ever names failures
 * and stays short as the catalogue is fixed.
 */
export interface Review {
  /** SKU → why its generated GLB must not be used. */
  models: Record<string, string>;
  /** SKU → why its catalogue photos must not texture the parametric model. */
  photos: Record<string, string>;
  /** SKU → the image position that actually shows the product, where one does. */
  photoPositions: Record<string, number>;
}

const EMPTY: Review = { models: {}, photos: {}, photoPositions: {} };

/** Keys starting with `_` are prose for the reader, not SKUs. */
const skusOnly = (o: unknown): Record<string, string> =>
  o && typeof o === 'object'
    ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string') as [string, string][])
    : {};

const numbersOnly = (o: unknown): Record<string, number> =>
  o && typeof o === 'object'
    ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && typeof v === 'number') as [string, number][])
    : {};

export function loadReview(assetsDir: string): Review {
  const file = path.join(assetsDir, 'review.json');
  if (!fs.existsSync(file)) return EMPTY;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    return { models: skusOnly(raw.models), photos: skusOnly(raw.photos), photoPositions: numbersOnly(raw.photo_positions) };
  } catch (e) {
    /* A malformed review must not silently re-open the gate it exists to close. */
    throw new Error(`assets/3d/review.json is unreadable (${e instanceof Error ? e.message : String(e)}). Fix it rather than building without it.`);
  }
}

/** Why this SKU's generated model is refused, or null when it is accepted. */
export const modelRejected = (review: Review, sku: string): string | null => review.models[sku] ?? null;

/** Why this SKU's photos may not be used as texture, or null when they may. */
export const photosRejected = (review: Review, sku: string): string | null => review.photos[sku] ?? null;

/**
 * The image position that shows the product, or null when the review has not pinned one.
 *
 * Null means "fall back to whatever the database calls the hero", which is position 1 for every
 * SKU in this catalogue — right only by accident. A pinned position is a read of the picture.
 */
export const productPhotoPosition = (review: Review, sku: string): number | null => review.photoPositions[sku] ?? null;

'use client';

import type { CompositeResult } from '@buildobjects/ar-engine';
import { FIDELITY_MIN, fidelityScore } from '@buildobjects/ar-engine';
import { bestRegionScore, dataUrlToCanvas, download, type PixelRect, regionPixels } from './photo';

/**
 * The one road from a built composite to a result the UI can show, for both AR tiers.
 *
 * ArStage (photograph) and ArCamera (live camera) each had their own copy of this: build the body,
 * POST it, rescale the placement rectangle into the returned image's coordinates, score the
 * result, fall back to the WebGL overlay. Two copies of a network call are tolerable. Two copies
 * of a JUDGEMENT are not, and these two had already drifted — the photo tier scored the region,
 * searched neighbouring scales when the model re-framed, and REFUSED anything under FIDELITY_MIN;
 * the camera tier scored once and accepted whatever came back. So the live view was the one place
 * a composite that does not look like the product could reach a buyer.
 *
 * It is one function now, and the strict rule is the one that survived.
 */
export type Composite = CompositeResult & { dataUrl: string; fallback?: boolean };

export async function requestComposite(opts: {
  body: unknown;
  /** The product as the renderer drew it — what the returned image is scored against. */
  reference: Uint8ClampedArray;
  /** Where the product sits in the SOURCE photograph, and that photograph's size. */
  rect: PixelRect;
  photoW: number;
  photoH: number;
  /** The overlay to show when the model is unreachable, refused, or off the mark. */
  overlay: { mimeType: string; base64: string; dataUrl: string };
  fallbackNote: string;
}): Promise<Composite> {
  const { body, reference, rect, photoW, photoH, overlay, fallbackNote } = opts;

  try {
    const res = await fetch('/api/ar/composite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as CompositeResult & { error?: string };
    if (res.ok && j.image?.base64) {
      const dataUrl = `data:${j.image.mimeType};base64,${j.image.base64}`;
      const out = await dataUrlToCanvas(dataUrl);
      /* The rectangle is in the source photograph's pixels and the answer is its own size. */
      const rectOut: PixelRect = {
        ...rect,
        x: (rect.x / photoW) * out.width,
        y: (rect.y / photoH) * out.height,
        w: (rect.w / photoW) * out.width,
        h: (rect.h / photoH) * out.height,
      };
      let fidelity = j.provider === 'mock' ? 1 : fidelityScore(reference, regionPixels(out, rectOut));
      /* A generative model re-frames and light-shifts, so a miss at the expected rectangle is not
         yet a miss: look for where the product actually landed before discarding the whole image. */
      if (j.provider !== 'mock' && fidelity < FIDELITY_MIN) {
        const found = bestRegionScore(reference, out, rectOut, out.width, out.height);
        if (found.score > fidelity) fidelity = found.score;
      }
      if (fidelity >= FIDELITY_MIN || j.provider === 'mock') return { ...j, fidelity, attempts: 1, dataUrl };
    }
  } catch {
    /* unreachable model, or a body it would not read: the overlay below is a true 1:1 placement */
  }

  return {
    image: { mimeType: 'image/jpeg', base64: overlay.base64 },
    provider: 'mock',
    fidelity: 1,
    attempts: 1,
    dataUrl: overlay.dataUrl,
    fallback: true,
    note: fallbackNote,
  };
}

/** Hand the finished picture to the OS share sheet, or save it where there is no share sheet. */
export async function shareImage(dataUrl: string, filename: string, title: string): Promise<void> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
    else download(dataUrl, filename);
  } catch {
    /* the sheet was dismissed */
  }
}

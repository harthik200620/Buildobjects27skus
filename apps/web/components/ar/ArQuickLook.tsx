'use client';

import type { PlacementRule, ProductDims } from '@buildobjects/ar-engine';
import React from 'react';
import { IconRoom } from '@/components/icons';
import { normalizeModel } from './camera/orient';

/**
 * Tier Q — iOS. `<model-viewer>` with a USDZ handed to AR Quick Look via `ios-src`. True scale
 * comes from the GLB's metres and `ar-scale="fixed"`.
 *
 * THE EXPORT USED TO SHIP THE RAW GLB. It loaded the file, put `gltf.scene` straight into a
 * scene and exported that — so every correction the rest of the engine makes was absent on iOS.
 * `normalizeModel` is what squares a generated mesh up with its stated dimensions and rests it on
 * its anchor face; without it the CCTV camera reached Quick Look lying on its side, the fire
 * extinguisher with its width and depth swapped, and the epoxy tin four times too wide. The live
 * camera and the WebXR tiers both normalise; this one silently did not, which is the worst kind of
 * inconsistency because the iOS path is the one nobody on a laptop ever sees.
 *
 * PLACEMENT WAS HARDCODED TO THE FLOOR. Quick Look takes `ar-placement`, and a fire extinguisher,
 * a CCTV camera and a window pane are not floor products — offering to stand them on the carpet is
 * the same category error the live view's placement rules exist to prevent. It comes from the
 * rule now, like everywhere else.
 */

/**
 * Exported USDZ, per GLB, for the life of the page.
 *
 * The export walks a one-to-two-megabyte mesh and re-encodes every texture, on the main thread.
 * Doing that again each time the component mounts — which is every time somebody switches tiers and
 * comes back — is seconds of a locked-up phone for a file that cannot have changed.
 */
const cache = new Map<string, string>();

/** Quick Look places against a vertical surface or a horizontal one; the rule already knows which. */
function placementFor(rule: PlacementRule): 'floor' | 'wall' {
  const s = rule.surfaces[0];
  return s === 'wall' || s === 'window' ? 'wall' : 'floor';
}

export default function ArQuickLook({
  glbUrl,
  usdzUrl,
  name,
  rule,
  dims,
  onFallback,
}: {
  glbUrl: string;
  /** A USDZ built ahead of time, when one exists. Beats exporting the same file on every device. */
  usdzUrl?: string | null;
  name: string;
  rule: PlacementRule;
  dims: ProductDims;
  onFallback: () => void;
}) {
  const [usdz, setUsdz] = React.useState<string | null>(usdzUrl ?? cache.get(glbUrl) ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await import('@google/model-viewer');
        if (alive) setReady(true);
        if (usdzUrl) return;
        const hit = cache.get(glbUrl);
        if (hit) {
          if (alive) setUsdz(hit);
          return;
        }
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
        const gltf = await new GLTFLoader().loadAsync(glbUrl);
        const model = gltf.scene;
        /* The same normalisation the live camera and WebXR tiers apply — see the note above. */
        normalizeModel(THREE, model, rule, dims);
        const scene = new THREE.Scene();
        scene.add(model);
        const bytes = await new USDZExporter().parseAsync(scene);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/vnd.usdz+zip' }));
        cache.set(glbUrl, url);
        if (alive) setUsdz(url);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [glbUrl, usdzUrl, rule, dims]);

  return (
    <div className="ar-stage">
      {ready ? (
        React.createElement(
          'model-viewer',
          {
            src: glbUrl,
            'ios-src': usdz ?? undefined,
            ar: true,
            'ar-modes': 'quick-look webxr scene-viewer',
            'ar-scale': 'fixed',
            'ar-placement': placementFor(rule),
            'camera-controls': true,
            'touch-action': 'pan-y',
            'shadow-intensity': '1',
            exposure: '1',
            alt: name,
            style: { width: '100%', height: '100%', background: 'transparent' },
          },
          React.createElement(
            'button',
            {
              type: 'button',
              slot: 'ar-button',
              className: 'btn-primary',
              style: { position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', height: 44, padding: '0 18px' },
            },
            usdz ? 'View in your room' : 'Preparing…',
          ),
        )
      ) : (
        <div className="ar-empty">
          <span className="skel" style={{ width: 120, height: 12 }} /> Loading the viewer…
        </div>
      )}
      <div className="ar-hud">
        <span className="ar-chip">
          <IconRoom size={14} /> AR Quick Look · true scale · on the {placementFor(rule)}
          {usdz ? '' : ' · preparing…'}
        </span>
        <button type="button" className="ar-chip" onClick={onFallback}>
          Use a photo instead
        </button>
      </div>
      {error && (
        <div className="ar-hud" style={{ top: 'var(--s-3)', bottom: 'auto' }}>
          <span className="ar-chip ar-chip--warn">USDZ export failed: {error.slice(0, 80)} — the GLB still works in the viewer</span>
        </div>
      )}
    </div>
  );
}

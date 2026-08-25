'use client';

import React from 'react';
import { IconRoom } from '@/components/icons';

/**
 * Tier Q — iOS. <model-viewer> with a USDZ exported client-side from the GLB (three.js
 * USDZExporter), handed to AR Quick Look via ios-src. True scale comes from the GLB's metres.
 */
export default function ArQuickLook({ glbUrl, name, onFallback }: { glbUrl: string; name: string; onFallback: () => void }) {
  const [usdz, setUsdz] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await import('@google/model-viewer');
        if (alive) setReady(true);
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
        const gltf = await new GLTFLoader().loadAsync(glbUrl);
        const scene = new THREE.Scene();
        scene.add(gltf.scene);
        const bytes = await new USDZExporter().parseAsync(scene);
        const blob = new Blob([bytes as BlobPart], { type: 'model/vnd.usdz+zip' });
        if (alive) setUsdz(URL.createObjectURL(blob));
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [glbUrl]);

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
            'ar-placement': 'floor',
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
            usdz ? 'View in your room' : 'Preparing USDZ…',
          ),
        )
      ) : (
        <div className="ar-empty">
          <span className="skel" style={{ width: 120, height: 12 }} /> Loading the viewer…
        </div>
      )}
      <div className="ar-hud">
        <span className="ar-chip">
          <IconRoom size={14} /> AR Quick Look · true scale{usdz ? '' : ' · exporting USDZ…'}
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

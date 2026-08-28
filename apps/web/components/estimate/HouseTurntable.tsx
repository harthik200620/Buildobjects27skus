'use client';

import React from 'react';
import { addRoomEnvironment } from '@/components/ar/three-env';
import { IconClose, IconRefresh } from '@/components/icons';

/**
 * The estimator's house, in three dimensions, on demand.
 *
 * The still render is the right default: it is instant, it is the most beautiful frame of the
 * building we have, and it is what someone wants to look at while they move a slider. But one
 * camera angle is one camera angle, and the question a person asks about a house they are pricing
 * is "what does it look like from the other side" — so the same render is also a mesh (Meshy
 * image-to-3D, `packages/assets3d/tools/house-3d.mts`) and this turns it.
 *
 * Loaded ONLY when asked. The models are ~4 MB each after compression, which is fine for a
 * deliberate tap and absurd as part of a page load that most people will never rotate.
 *
 * If the model is missing — the matrix has not been built, or Meshy rejected that one — the
 * button never appears and the still render is simply what the page has. Nothing breaks and
 * nothing lies about being interactive.
 */

export interface HouseTurntableProps {
  /** `/3d/house/2-medium.glb` */
  src: string;
  label: string;
  onClose: () => void;
}

export default function HouseTurntable({ src, label, onClose }: HouseTurntableProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const resetRef = React.useRef<() => void>(() => {});
  const [spinning, setSpinning] = React.useState(true);
  const spinRef = React.useRef(true);
  spinRef.current = spinning;

  React.useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | null = null;
    /*
     * Held outside the async body on purpose.
     *
     * The effect is async, so React can run its cleanup before the body has finished — in dev
     * StrictMode it always does. The first version only knew how to tear down through `cleanup`,
     * which is assigned at the very end, so an effect cancelled midway left its canvas in the DOM
     * and its WebGL context alive: two canvases stacked, one of them dead at 300x150. Tracking
     * the renderer here means the teardown can always reach whatever was actually created.
     */
    let made: { dispose: () => void } | null = null;
    const teardown = () => {
      cleanup?.();
      cleanup = null;
      made?.dispose();
      made = null;
    };

    (async () => {
      const host = hostRef.current;
      if (!host) return;
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        if (!alive) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        made = {
          dispose: () => {
            renderer.domElement.remove();
            renderer.dispose();
          },
        };
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        host.appendChild(renderer.domElement);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.touchAction = 'none';
        renderer.domElement.style.cursor = 'grab';

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 500);

        await addRoomEnvironment(THREE, scene, renderer);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x2a4c55, 1.15));
        const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
        key.position.set(-3, 4, 3);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x9fe6ea, 0.8);
        rim.position.set(3, 2, -3);
        scene.add(rim);

        const gltf = await new GLTFLoader().loadAsync(src);
        if (!alive) return; // `teardown` already removed the canvas and disposed the context
        const model = gltf.scene;

        /* Frame it. The mesh arrives at whatever scale and offset Meshy produced, so it is
           centred on its own bounding box and the camera is pushed back far enough for the
           longest edge — the alternative is a house half out of frame at an arbitrary size. */
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        model.position.sub(centre);
        const pivot = new THREE.Group();
        pivot.add(model);
        scene.add(pivot);
        const radius = Math.max(size.x, size.y, size.z) * 0.5;
        const dist = radius / Math.tan((camera.fov * Math.PI) / 360) / 0.72;

        let yaw = -0.6;
        let pitch = 0.22;
        const apply = () => {
          camera.position.set(dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw));
          camera.lookAt(0, 0, 0);
        };
        apply();
        resetRef.current = () => {
          yaw = -0.6;
          pitch = 0.22;
          apply();
        };

        // drag to orbit; dragging stops the idle spin, because a spin fighting a drag is a bug
        let dragging = false;
        let lx = 0;
        let ly = 0;
        const el = renderer.domElement;
        const down = (e: PointerEvent) => {
          dragging = true;
          lx = e.clientX;
          ly = e.clientY;
          el.setPointerCapture(e.pointerId);
          el.style.cursor = 'grabbing';
          setSpinning(false);
        };
        const move = (e: PointerEvent) => {
          if (!dragging) return;
          yaw -= (e.clientX - lx) * 0.008;
          pitch = Math.max(-0.15, Math.min(0.9, pitch + (e.clientY - ly) * 0.005));
          lx = e.clientX;
          ly = e.clientY;
          apply();
        };
        const up = (e: PointerEvent) => {
          dragging = false;
          el.releasePointerCapture?.(e.pointerId);
          el.style.cursor = 'grab';
        };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);

        /*
         * Size the drawing buffer inside the loop rather than from a ResizeObserver.
         *
         * The observer version left the canvas at its default 300x150 buffer stretched across a
         * 689x431 box — a blurry render — because the first measurement happened while the panel
         * was still being mounted and no later resize ever occurred to correct it. Checking each
         * frame costs two property reads and cannot be raced.
         */
        const syncSize = () => {
          const w = host.clientWidth;
          const h = host.clientHeight;
          if (w < 2 || h < 2) return;
          const dpr = Math.min(2, window.devicePixelRatio);
          if (renderer.domElement.width !== Math.round(w * dpr) || renderer.domElement.height !== Math.round(h * dpr)) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
          }
        };
        syncSize();

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) setSpinning(false);
        let raf = 0;
        let last = performance.now();
        const loop = (t: number) => {
          const dt = Math.min(64, t - last);
          last = t;
          syncSize();
          if (spinRef.current && !dragging && !reduced) {
            yaw += dt * 0.00016;
            apply();
          }
          renderer.render(scene, camera);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        setStatus('ready');

        cleanup = () => {
          cancelAnimationFrame(raf);
          el.removeEventListener('pointerdown', down);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        if (!alive) teardown(); // cancelled while the model was loading
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      alive = false;
      teardown();
    };
  }, [src]);

  return (
    <div className="ht">
      <div ref={hostRef} className="ht-stage" role="img" aria-label={`${label}, 3D model — drag to turn`} />
      {status === 'loading' && (
        <div className="ht-veil">
          <div className="skel" style={{ width: 160, height: 6, borderRadius: 3 }} />
          <span>Loading the 3D model…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="ht-veil">
          <span>This house has no 3D model yet.</span>
          <button type="button" className="btn-secondary btn--sm" onClick={onClose}>
            Back to the picture
          </button>
          {error && <span className="caption">{error}</span>}
        </div>
      )}
      <div className="ht-hud">
        <span className="ar-hud-glass ar-hud-pill">Drag to turn</span>
        <button type="button" className="ar-hud-glass ar-hud-pill cursor-pointer" onClick={() => setSpinning((v) => !v)}>
          {spinning ? 'Pause' : 'Spin'}
        </button>
        <button type="button" className="ar-hud-glass ar-hud-pill cursor-pointer" onClick={() => resetRef.current()}>
          <IconRefresh size={13} /> Reset
        </button>
        <button type="button" className="ar-hud-glass ar-hud-pill cursor-pointer" onClick={onClose}>
          <IconClose size={13} /> Photo
        </button>
      </div>
    </div>
  );
}

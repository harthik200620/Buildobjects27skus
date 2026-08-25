'use client';

import type { PlacementRule, ProductDims } from '@buildobjects/ar-engine';
import React from 'react';
import type * as THREE from 'three';
import type { Matrix4, Vector3 } from 'three';
import { IconClose, IconRefresh } from '@/components/icons';
import { normalizeModel, orientForSurface } from './camera/orient';

/** WebXR light-estimation types are not in lib.dom yet; the probe is opaque to us. */
type XRLightProbeLike = object;

/**
 * Tier L — Live AR (WebXR immersive-ar with hit-test). Plane detection via hit-test on
 * horizontal and vertical surfaces, animated reticle, tap-to-place at true physical scale
 * (GLB metres = real millimetres), one-finger drag to reposition along the surface,
 * two-finger rotate, light estimation, soft contact shadow. Placement orientation follows the
 * category rule (a bulb hangs from a ceiling, a camera sits flush on a wall).
 */
export default function ArLive({
  glbUrl,
  rule,
  dims,
  name,
  onExit,
}: {
  glbUrl: string;
  rule: PlacementRule;
  dims: ProductDims;
  name: string;
  onExit: () => void;
}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<string>('Starting the camera…');
  const [placed, setPlaced] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const resetRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const xr = (navigator as Navigator & { xr?: { requestSession: (m: string, o: unknown) => Promise<XRSession> } }).xr;
        if (!xr) throw new Error('WebXR is not available in this browser');
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.style.position = 'fixed';
        renderer.domElement.style.inset = '0';
        renderer.domElement.style.zIndex = '99';
        document.body.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
        const hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.2);
        scene.add(hemi);
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(0.5, 2, 1);
        scene.add(sun);

        // reticle
        const reticle = new THREE.Mesh(
          new THREE.RingGeometry(0.06, 0.075, 48).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: 0.9 }),
        );
        reticle.matrixAutoUpdate = false;
        reticle.visible = false;
        scene.add(reticle);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5ce1e6 }));
        reticle.add(dot);

        // model at true scale (metres) + contact shadow
        const gltf = await new GLTFLoader().loadAsync(glbUrl);
        const model = gltf.scene;
        const norm = normalizeModel(THREE, model, rule, dims);
        const holder = new THREE.Group();
        holder.add(model);
        holder.visible = false;
        scene.add(holder);
        const size = new THREE.Vector3(norm.size.x, norm.size.y, norm.size.z);

        // Multi-tile tiling grid support when category is tiles
        const isTile = rule.category === 'tiles';
        const tileInstances: THREE.Group[] = [];
        if (isTile) {
          const tileW = (dims.w_mm || 600) / 1000;
          const tileL = (dims.h_mm || 1200) / 1000;
          const grout = 0.002; // 2mm grout joint
          const offsets = [
            [-tileW - grout, 0, 0],
            [tileW + grout, 0, 0],
            [0, 0, -tileL - grout],
            [0, 0, tileL + grout],
            [-tileW - grout, 0, -tileL - grout],
            [tileW + grout, 0, -tileL - grout],
            [-tileW - grout, 0, tileL + grout],
            [tileW + grout, 0, tileL + grout],
          ];
          for (const off of offsets) {
            const clone = model.clone();
            clone.position.add(new THREE.Vector3(...off));
            const tGroup = new THREE.Group();
            tGroup.add(clone);
            tGroup.visible = false;
            holder.add(tGroup);
            tileInstances.push(tGroup);
          }
        }

        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = shadowCanvas.height = 256;
        const sctx = shadowCanvas.getContext('2d')!;
        const g = sctx.createRadialGradient(128, 128, 10, 128, 128, 128);
        g.addColorStop(0, 'rgba(0,0,0,.45)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, 256, 256);
        const shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(Math.max(size.x, size.z) * 1.6, Math.max(size.x, size.z) * 1.6).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
        );
        shadow.position.y = 0.002;
        holder.add(shadow);

        const session = await xr.requestSession('immersive-ar', {
          requiredFeatures: ['hit-test'],
          optionalFeatures: ['dom-overlay', 'light-estimation'],
          domOverlay: overlayRef.current ? { root: overlayRef.current } : undefined,
        });
        if (cancelled) {
          session.end();
          return;
        }
        renderer.xr.setReferenceSpaceType('local');
        await renderer.xr.setSession(session as never);
        const viewerSpace = await session.requestReferenceSpace('viewer');
        const hitSource = await (
          session as XRSession & { requestHitTestSource?: (o: { space: XRReferenceSpace }) => Promise<XRHitTestSource> }
        ).requestHitTestSource?.({ space: viewerSpace });
        let lightProbe: XRLightProbeLike | null = null;
        try {
          lightProbe = (await (session as XRSession & { requestLightProbe?: () => Promise<XRLightProbeLike> }).requestLightProbe?.()) ?? null;
        } catch {
          lightProbe = null;
        }
        setStatus('Move the phone slowly to find a surface, then tap to place');

        let lastHit: { matrix: Matrix4; normal: Vector3 } | null = null;
        const up = new THREE.Vector3(0, 1, 0);
        const orient = (normal: Vector3) => {
          const vertical = Math.abs(normal.y) < 0.5;
          const s = vertical ? 'wall' : normal.y < -0.5 ? 'ceiling' : 'floor';
          return orientForSurface(THREE, s, normal, rule);
        };
        const place = () => {
          if (!lastHit) return;
          holder.position.setFromMatrixPosition(lastHit.matrix);
          holder.quaternion.copy(orient(lastHit.normal));
          if (rule.mountOffsetMm) holder.position.addScaledVector(lastHit.normal, rule.mountOffsetMm / 1000);
          holder.visible = true;
          reticle.visible = false;
          setPlaced(true);
          setStatus('Drag to move · two fingers to rotate');
        };
        session.addEventListener('select', () => {
          if (!holder.visible) place();
        });

        // touch: one finger drags along the last surface plane, two fingers rotate
        let lastAngle = 0;
        const ray = new THREE.Raycaster();
        const plane = new THREE.Plane();
        const overlay = overlayRef.current ?? document.body;
        const onStart = (e: TouchEvent) => {
          if (e.touches.length === 2) lastAngle = Math.atan2(e.touches[1].clientY - e.touches[0].clientY, e.touches[1].clientX - e.touches[0].clientX);
        };
        const onMove = (e: TouchEvent) => {
          if (!holder.visible) return;
          if (e.touches.length === 2) {
            const a = Math.atan2(e.touches[1].clientY - e.touches[0].clientY, e.touches[1].clientX - e.touches[0].clientX);
            holder.rotateOnWorldAxis(lastHit?.normal ?? up, -(a - lastAngle));
            lastAngle = a;
          } else if (e.touches.length === 1 && lastHit) {
            const t = e.touches[0];
            const ndc = new THREE.Vector2((t.clientX / window.innerWidth) * 2 - 1, -(t.clientY / window.innerHeight) * 2 + 1);
            const xrCam = renderer.xr.getCamera();
            ray.setFromCamera(ndc, xrCam);
            plane.setFromNormalAndCoplanarPoint(lastHit.normal, holder.position);
            const hit = new THREE.Vector3();
            if (ray.ray.intersectPlane(plane, hit)) holder.position.copy(hit).addScaledVector(lastHit.normal, rule.mountOffsetMm / 1000);
          }
          e.preventDefault();
        };
        overlay.addEventListener('touchstart', onStart, { passive: true });
        overlay.addEventListener('touchmove', onMove, { passive: false });
        resetRef.current = () => {
          holder.visible = false;
          setPlaced(false);
          setStatus('Tap to place again');
        };

        renderer.setAnimationLoop((_t, frame?: XRFrame) => {
          if (frame && hitSource) {
            const refSpace = renderer.xr.getReferenceSpace();
            const hits = frame.getHitTestResults(hitSource);
            if (hits.length && refSpace) {
              const pose = hits[0].getPose(refSpace);
              if (pose) {
                const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
                const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m)).normalize();
                lastHit = { matrix: m, normal };
                if (!holder.visible) {
                  reticle.visible = true;
                  reticle.matrix.copy(m);
                  reticle.scale.setScalar(1 + 0.08 * Math.sin(_t / 180));
                  reticle.updateMatrixWorld(true);
                }
              }
            } else if (!holder.visible) reticle.visible = false;
            if (lightProbe) {
              const est = (
                frame as XRFrame & {
                  getLightEstimate?: (
                    p: XRLightProbeLike,
                  ) => { primaryLightIntensity?: { x: number; y: number; z: number }; primaryLightDirection?: { x: number; y: number; z: number } } | null;
                }
              ).getLightEstimate?.(lightProbe);
              if (est?.primaryLightIntensity) {
                const i = est.primaryLightIntensity;
                sun.intensity = Math.min(3, Math.max(0.3, (i.x + i.y + i.z) / 3));
                hemi.intensity = Math.min(2, 0.6 + sun.intensity * 0.4);
              }
              if (est?.primaryLightDirection) {
                const d = est.primaryLightDirection;
                sun.position.set(d.x, d.y, d.z).multiplyScalar(3);
              }
            }
          }
          renderer.render(scene, camera);
        });
        session.addEventListener('end', () => {
          cleanup?.();
          onExit();
        });
        cleanup = () => {
          renderer.setAnimationLoop(null);
          overlay.removeEventListener('touchstart', onStart);
          overlay.removeEventListener('touchmove', onMove);
          renderer.domElement.remove();
          renderer.dispose();
          cleanup = null;
        };
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [glbUrl, rule, dims, onExit]);

  return (
    <div ref={overlayRef} style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }}>
      <div className="ar-hud" style={{ pointerEvents: 'auto' }}>
        <span className="ar-chip">{error ? `Live AR unavailable: ${error}` : status}</span>
        {placed && (
          <button type="button" className="ar-chip" onClick={() => resetRef.current()}>
            <IconRefresh size={14} /> Re-place
          </button>
        )}
        <button type="button" className="ar-chip" onClick={onExit}>
          <IconClose size={14} /> Exit
        </button>
      </div>
      <div className="ar-hud" style={{ top: 'calc(var(--s-3) + env(safe-area-inset-top))', bottom: 'auto', pointerEvents: 'none' }}>
        <span className="ar-chip">
          {name} · {dims.w_mm}×{dims.h_mm}×{dims.d_mm} mm · true 1:1 scale
        </span>
      </div>
    </div>
  );
}

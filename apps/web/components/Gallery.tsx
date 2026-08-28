'use client';

import Link from 'next/link';
import React from 'react';
import type * as THREE from 'three';
import type { SkuImageView } from '@/lib/catalog';
import { mediaUrl } from '@/lib/media';
import { groundFor, plateFor } from '@/lib/plate';
import { IconBack, IconCamera, IconChevron, IconClose, IconRefresh, IconRoom, IconZoom } from './icons';
import { useScrollLock } from './useDismiss';

/**
 * The PDP gallery. Main image (1:1, contain, `gallery` rendition) with swipe / arrow scroll
 * through the five roles, dot indicators, a thumbnail rail; desktop hover-lens zoom and
 * click-to-lightbox on the `zoom` (2048) asset, pinch-zoom in the lightbox on touch.
 * Also includes interactive 3D Orbit Viewer mode at 1:1 real-world scale.
 */
const ROLE_LABEL: Record<string, string> = {
  hero: 'Product',
  angle: 'Second angle',
  in_context: 'In use',
  detail: 'Detail',
  pack_or_dimensions: 'Pack & dimensions',
};

export interface GalleryProps {
  images: SkuImageView[];
  name: string;
  skuCode?: string;
  dims?: { w: number; h: number; d: number } | null;
}

export default function Gallery({ images, name, skuCode, dims }: GalleryProps) {
  const [viewMode, setViewMode] = React.useState<'photos' | '3d'>('photos');
  const [i, setI] = React.useState(0);
  const [lens, setLens] = React.useState<{ x: number; y: number } | null>(null);
  const [lightbox, setLightbox] = React.useState(false);
  /* Covers the viewport, so the page behind it must not scroll — see useScrollLock. */
  useScrollLock(lightbox);

  const [autoRotate, setAutoRotate] = React.useState(true);
  const [is3dLoading, setIs3dLoading] = React.useState(true);
  const [threeError, setThreeError] = React.useState<string | null>(null);

  const mainRef = React.useRef<HTMLDivElement | null>(null);
  const canvas3dRef = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ x: number; t: number } | null>(null);

  const n = images.length;
  const cur = images[i] ?? images[0];

  /*
   * THE MOUNT FOLLOWS THE PHOTOGRAPH.
   *
   * `--plate-stage` was pinned to the silver sweep for every frame of every product, and most of
   * this catalogue is not shot on a sweep: three of the twenty-eight galleries are consistently
   * light, nine are entirely dark, and sixteen carry both. So the product page put a dark studio
   * render inside a white rectangle inside a dark page — and paging through a mixed gallery left
   * the mount sitting still while the ground behind the object changed underneath it.
   *
   * Frame one takes the generated table, which is sampled from that image's real border pixels
   * and is the same value the product card paints — so arriving here from a card is seamless.
   * Every other frame comes from its own blurhash, which is the only per-frame signal that exists
   * without regenerating the media. See lib/plate.ts.
   */
  const stage = (i === 0 && skuCode ? plateFor(skuCode) : null) ?? groundFor(cur?.blurhash)?.plate ?? null;
  const go = React.useCallback((d: number) => setI((x) => (x + d + n) % n), [n]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lightbox && e.key === 'Escape') setLightbox(false);
      if (viewMode === 'photos') {
        if (e.key === 'ArrowRight') go(1);
        else if (e.key === 'ArrowLeft') go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, lightbox, viewMode]);

  // 3D Canvas initialization when switching to 3D mode
  React.useEffect(() => {
    if (viewMode !== '3d' || !skuCode) return;
    let disposed = false;
    let animId: number;
    const container = canvas3dRef.current;
    if (!container) return;

    setIs3dLoading(true);
    setThreeError(null);

    Promise.all([import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/controls/OrbitControls.js')])
      .then(([THREE, { GLTFLoader }, { OrbitControls }]) => {
        if (disposed || !container) return;

        const w = container.clientWidth || 500;
        const h = container.clientHeight || 500;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, w / h, 0.01, 50);
        camera.position.set(0.16, 0.14, 0.32);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.minDistance = 0.05;
        controls.maxDistance = 2.0;
        controls.autoRotate = autoRotate;
        controls.autoRotateSpeed = 2.2;
        controls.enablePan = false;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
        scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
        keyLight.position.set(2, 3.5, 2.5);
        keyLight.castShadow = true;
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xb4d8ff, 1.1);
        fillLight.position.set(-2, 1.5, -2);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffeedd, 0.85);
        rimLight.position.set(0, -2, 2);
        scene.add(rimLight);

        const shadowPlaneGeo = new THREE.PlaneGeometry(1.2, 1.2);
        const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.16 });
        const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
        shadowPlane.rotation.x = -Math.PI / 2;
        shadowPlane.position.y = 0;
        shadowPlane.receiveShadow = true;
        scene.add(shadowPlane);

        const loader = new GLTFLoader();
        const modelUrl = `/3d/${skuCode}.glb`;

        loader.load(
          modelUrl,
          (gltf) => {
            if (disposed) return;
            const model = gltf.scene;

            const bbox = new THREE.Box3().setFromObject(model);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            const size = new THREE.Vector3();
            bbox.getSize(size);

            model.position.x = -center.x;
            model.position.y = -bbox.min.y;
            model.position.z = -center.z;

            model.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });

            scene.add(model);

            const maxDim = Math.max(size.x, size.y, size.z, 0.05);
            const fitDist = (maxDim / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.45;
            camera.position.set(fitDist * 0.7, size.y * 0.5 + fitDist * 0.4, fitDist * 0.9);
            controls.target.set(0, size.y * 0.5, 0);
            controls.update();

            setIs3dLoading(false);
          },
          undefined,
          (err) => {
            if (disposed) return;
            console.error('Failed to load 3D GLB:', err);
            setThreeError('Could not load 3D model');
            setIs3dLoading(false);
          },
        );

        const animate = () => {
          if (disposed) return;
          animId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        const handleResize = () => {
          if (!container) return;
          const rw = container.clientWidth || 500;
          const rh = container.clientHeight || 500;
          camera.aspect = rw / rh;
          camera.updateProjectionMatrix();
          renderer.setSize(rw, rh);
        };
        window.addEventListener('resize', handleResize);

        const onDown = () => {
          controls.autoRotate = false;
        };
        const onUp = () => {
          if (autoRotate) controls.autoRotate = true;
        };
        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointerup', onUp);

        return () => {
          disposed = true;
          cancelAnimationFrame(animId);
          window.removeEventListener('resize', handleResize);
          container.removeEventListener('pointerdown', onDown);
          container.removeEventListener('pointerup', onUp);
          renderer.dispose();
          renderer.forceContextLoss();
        };
      })
      .catch(() => {
        if (!disposed) {
          setThreeError('WebGL 3D engine failed to initialize');
          setIs3dLoading(false);
        }
      });

    return () => {
      disposed = true;
      if (animId) cancelAnimationFrame(animId);
    };
  }, [viewMode, skuCode, autoRotate]);

  if (!n) return <div className="gallery-main skel" role="status" aria-label="No images yet" />;

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, t: Date.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 40 && Date.now() - d.t < 600) go(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 6) setLightbox(true);
  };
  const onMove = (e: React.MouseEvent) => {
    const r = mainRef.current?.getBoundingClientRect();
    if (!r) return;
    setLens({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  return (
    <div className="gallery">
      {/* ── Mode Switcher Tab Bar ────────────────────────────────────────── */}
      {/* Photos or the model. A two-way switch is a tab list, so it is built as one — which is
          also what gives it arrow-key navigation for free in every screen reader. */}
      {skuCode && (
        <div className="gal-modes" role="tablist" aria-label="How to view this product">
          <button type="button" role="tab" aria-selected={viewMode === 'photos'} className="gal-mode" onClick={() => setViewMode('photos')}>
            <IconCamera size={14} />
            <span>Photos</span>
            <span className="gal-mode-count fig">{n}</span>
          </button>
          <button type="button" role="tab" aria-selected={viewMode === '3d'} className="gal-mode" onClick={() => setViewMode('3d')}>
            <IconRoom size={14} />
            <span>3D model</span>
            <span className="gal-mode-tag">1:1</span>
          </button>
        </div>
      )}

      {/* ── 3D View Mode ─────────────────────────────────────────────────── */}
      {viewMode === '3d' && skuCode ? (
        <div className="gal-3d">
          <div ref={canvas3dRef} className="gal-3d-canvas" />

          {is3dLoading && (
            <div className="gal-3d-veil">
              <span className="gal-spinner" aria-hidden />
              <p>Loading the model…</p>
            </div>
          )}

          {threeError && (
            <div className="gal-3d-veil gal-3d-veil--error">
              <p className="gal-3d-error">{threeError}</p>
              <Link href={`/ar/${skuCode.toLowerCase()}`} className="btn btn-secondary btn--sm">
                Open the room view instead
              </Link>
            </div>
          )}

          {!is3dLoading && !threeError && (
            <div className="gal-3d-badges">
              <span className="gal-badge gal-badge--scale">Real size</span>
              {dims && (
                <span className="gal-badge fig">
                  {dims.w} × {dims.h} × {dims.d} mm
                </span>
              )}
            </div>
          )}

          {!is3dLoading && !threeError && (
            <div className="gal-3d-bar">
              <button type="button" onClick={() => setAutoRotate(!autoRotate)} aria-pressed={autoRotate} className="gal-orbit">
                <IconRefresh size={14} className={autoRotate ? 'is-spinning' : undefined} />
                <span>Turntable</span>
              </button>
              <Link href={`/ar/${skuCode.toLowerCase()}`} className="btn btn-primary btn--sm gal-to-ar">
                <IconRoom size={15} />
                <span>See it in your room</span>
              </Link>
            </div>
          )}
        </div>
      ) : (
        /* ── 5-Photo Carousel Gallery Mode ───────────────────────────────── */
        <>
          <div
            ref={mainRef}
            className="gallery-main"
            style={stage ? ({ '--plate-stage': stage } as React.CSSProperties) : undefined}
            role="group"
            aria-roledescription="carousel"
            aria-label={`${name} images`}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onMouseMove={onMove}
            onMouseLeave={() => setLens(null)}
          >
            <div className="gallery-track" style={{ transform: `translateX(-${i * 100}%)` }}>
              {images.map((im, idx) => (
                <div key={im.position} className="gallery-slide" aria-hidden={idx !== i}>
                  <img
                    src={mediaUrl(im.gallery)!}
                    alt={im.alt || `${name} — ${ROLE_LABEL[im.role] ?? im.role}`}
                    draggable={false}
                    loading={idx === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                    fetchPriority={idx === 0 ? 'high' : 'auto'}
                  />
                  {im.placeholder && (
                    <span className="est-badge" style={{ top: 10, left: 10 }}>
                      Official image pending
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* hover lens: the 2048 asset, positioned so the pointer is the centre of a 2.4× window */}
            <div
              className="gallery-lens hidden lg:block"
              data-on={lens && !cur?.placeholder ? 'true' : 'false'}
              style={
                lens && cur
                  ? {
                      backgroundImage: `url(${mediaUrl(cur.zoom)})`,
                      backgroundSize: '240%',
                      backgroundPosition: `${lens.x}% ${lens.y}%`,
                      backgroundColor: 'var(--surf-2)',
                    }
                  : undefined
              }
              aria-hidden
            />

            {n > 1 && (
              <>
                <button
                  type="button"
                  className="icon-btn glass gallery-arrow gallery-arrow--l"
                  aria-label="Previous image"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(-1);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  <IconBack size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn glass gallery-arrow gallery-arrow--r"
                  aria-label="Next image"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(1);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  <IconChevron size={18} />
                </button>
              </>
            )}

            <button
              type="button"
              className="icon-btn glass absolute right-3 bottom-3 z-[2]"
              aria-label="Open zoom"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <IconZoom size={18} />
            </button>

            <div className="pdp-dots absolute left-0 right-0 bottom-3 flex justify-center gap-1.5 z-[2]" aria-hidden>
              {images.map((im, idx) => (
                <span key={im.position} className="pdp-dot" aria-current={idx === i ? 'true' : undefined} />
              ))}
            </div>
          </div>

          <div className="thumbs no-scrollbar" role="tablist" aria-label="Choose image">
            {images.map((im, idx) => (
              <button
                key={im.position}
                type="button"
                role="tab"
                aria-selected={idx === i}
                aria-current={idx === i ? 'true' : undefined}
                className="thumb"
                onClick={() => setI(idx)}
                title={ROLE_LABEL[im.role] ?? im.role}
              >
                <img src={mediaUrl(im.thumb)!} alt="" loading="lazy" />
              </button>
            ))}
          </div>

          <p className="caption gal-note">
            {ROLE_LABEL[cur?.role] ?? cur?.role} · {i + 1} of {n}
            {cur?.width && cur.width < 1200 && !cur.placeholder ? ' · source below 1200 px, zoom may be soft' : ''}
          </p>
        </>
      )}

      {lightbox && cur && (
        <Lightbox src={mediaUrl(cur.zoom)!} alt={cur.alt || name} onClose={() => setLightbox(false)} onPrev={() => go(-1)} onNext={() => go(1)} />
      )}
    </div>
  );
}

/** Full-screen zoom with wheel zoom, drag to pan, pinch on touch. */
function Lightbox({ src, alt, onClose, onPrev, onNext }: { src: string; alt: string; onClose: () => void; onPrev: () => void; onNext: () => void }) {
  const [t, setT] = React.useState({ s: 1, x: 0, y: 0 });
  const pts = React.useRef(new Map<number, { x: number; y: number }>());
  const last = React.useRef<{ d: number; s: number; x: number; y: number; cx: number; cy: number } | null>(null);
  /* The scroll lock lives in one place — `useScrollLock(lightbox)` on the gallery above. A
     second copy here is how two locks end up fighting over the same offset. */
  const clamp = (s: number) => Math.min(6, Math.max(1, s));
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setT((p) => ({ ...p, s: clamp(p.s * (e.deltaY < 0 ? 1.15 : 0.87)) }));
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = [...pts.current.values()];
    last.current = { d: a.length === 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0, s: t.s, x: t.x, y: t.y, cx: e.clientX, cy: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !last.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = [...pts.current.values()];
    if (a.length === 2 && last.current.d) {
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      setT((p) => ({ ...p, s: clamp(last.current!.s * (d / last.current!.d)) }));
    } else if (a.length === 1)
      setT((p) => ({ ...p, x: last.current!.x + (e.clientX - last.current!.cx), y: last.current!.y + (e.clientY - last.current!.cy) }));
  };
  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size === 0) last.current = null;
  };
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Zoomed image"
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => setT((p) => ({ s: p.s > 1 ? 1 : 2.5, x: 0, y: 0 }))}
    >
      <button type="button" className="icon-btn glass lightbox-close" aria-label="Close" onClick={onClose}>
        <IconClose size={20} />
      </button>
      <button
        type="button"
        className="icon-btn glass gallery-arrow gallery-arrow--l"
        aria-label="Previous"
        onClick={(e) => {
          e.stopPropagation();
          setT({ s: 1, x: 0, y: 0 });
          onPrev();
        }}
      >
        <IconBack size={18} />
      </button>
      <button
        type="button"
        className="icon-btn glass gallery-arrow gallery-arrow--r"
        aria-label="Next"
        onClick={(e) => {
          e.stopPropagation();
          setT({ s: 1, x: 0, y: 0 });
          onNext();
        }}
      >
        <IconChevron size={18} />
      </button>
      <img
        src={src}
        alt={alt}
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
          transition: pts.current.size ? 'none' : 'transform 120ms',
          cursor: t.s > 1 ? 'grab' : 'zoom-in',
        }}
        draggable={false}
      />
      <p className="gal-lightbox-note">Scroll or pinch to zoom · drag to pan · double-tap to reset · Esc to close</p>
    </div>
  );
}

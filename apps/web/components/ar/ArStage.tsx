'use client';

import {
  analyzeFromGrid,
  type CompositeResult,
  defaultAnchor,
  detectTier,
  estimateScale,
  FIDELITY_MIN,
  fidelityScore,
  gate,
  type Placement,
  placementFor,
  REFERENCE_MM,
  SCENE_LABEL,
  type ScaleEstimate,
  type SceneAnalysis,
  type SceneType,
  SURFACE_LABEL,
  type TierDetection,
} from '@buildobjects/ar-engine';
import Link from 'next/link';
import React from 'react';
import {
  IconArrow,
  IconCamera,
  IconDownload,
  IconInfo,
  IconRefresh,
  IconRotateLeft,
  IconRotateRight,
  IconRuler,
  IconShare,
  IconSpark,
  IconTarget,
  IconUpload,
} from '@/components/icons';
import type { ArProduct } from '@/lib/ar-data';
import { inr } from '@/lib/media';
import {
  bestRegionScore,
  canvasToB64,
  composeScene,
  dataUrlToCanvas,
  download,
  fileToImage,
  lumaGridOf,
  type PixelRect,
  productCutout,
  productPixels,
  regionPixels,
  toCanvas,
} from './photo';
import { initialSession, photoSessionReducer } from './photoSession';
import { renderGlb } from './render3d';

type Mode = 'menu' | 'live' | 'quicklook' | 'livecamera' | 'photo';
const ROOMS: SceneType[] = ['living_room', 'bedroom', 'kitchen', 'bathroom', 'office', 'corridor', 'exterior', 'site', 'roof'];
const CALIB: { kind: keyof typeof REFERENCE_MM; label: string; hint: string }[] = [
  { kind: 'door', label: 'Door · 2030 mm', hint: 'Tap the top, then the bottom of a door' },
  { kind: 'switch_plate', label: 'Switch plate · 86 mm', hint: 'Tap the left, then the right edge of a switch plate' },
  { kind: 'a4_sheet', label: 'A4 sheet · 297 mm', hint: 'Tap both ends of an A4 sheet’s long side' },
];
const ArLive = React.lazy(() => import('./ArLive'));
const ArQuickLook = React.lazy(() => import('./ArQuickLook'));
const ArCamera = React.lazy(() => import('./camera/ArCamera'));

export default function ArStage({ product }: { product: ArProduct }) {
  const { rule, dims } = product;
  const [tier, setTier] = React.useState<TierDetection | null>(null);
  const [mode, setMode] = React.useState<Mode>('menu');
  /*
   * The photo workflow is one state machine, so it is one reducer (see photoSession.ts) rather
   * than fifteen useState calls whose updates had to be written out together at every call site.
   * Everything below it is genuinely independent state.
   */
  const [session, dispatch] = React.useReducer(photoSessionReducer, rule, initialSession);
  const { step, photo, scene, userScene, gate: gateResult, surface, pos, yaw, scaleMult, manual, calibPts, result, busy, error } = session;

  const [visionLive, setVisionLive] = React.useState<boolean | null>(null);
  const [calibRef, setCalibRef] = React.useState(CALIB[0]);
  const [productCanvas, setProductCanvas] = React.useState<HTMLCanvasElement | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const dragRef = React.useRef<boolean>(false);
  const lastRectRef = React.useRef<PixelRect | null>(null);

  /* ── tier detection + provider check ─────────────────────────────────── */
  React.useEffect(() => {
    detectTier().then((t) => {
      setTier(t);
      if (t.camera || t.tier === 'C' || t.tier === 'L') {
        setMode('livecamera');
      } else if (t.tier === 'Q') {
        setMode('menu');
      } else {
        setMode('photo');
      }
    });
    fetch('/api/ar/analyze')
      .then((r) => r.json())
      .then((j) => setVisionLive(!!j.live))
      .catch(() => setVisionLive(false));
  }, []);

  /* ── camera ───────────────────────────────────────────────────────────── */
  const stopCamera = React.useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setStreaming(false);
  }, []);
  const startCamera = React.useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setStreaming(true);
      dispatch({ type: 'errorDismissed' });
    } catch (e) {
      setStreaming(false);
      dispatch({ type: 'failed', error: `Camera unavailable (${(e as Error).message}) — upload a room photo instead` });
    }
  }, []);
  /*
   * Start the camera on entering photo capture, stop it on leaving. Deliberately keyed on
   * mode and step alone: `streaming` and `photo` are guards read when the effect fires, and
   * re-running on their changes would tear the stream down in the middle of a capture.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (mode === 'photo' && step === 'capture' && !streaming && !photo) startCamera();
    return () => {
      if (step !== 'capture') stopCamera();
    };
  }, [mode, step, streaming, stopCamera, startCamera, photo]);
  React.useEffect(() => () => stopCamera(), [stopCamera]);

  /* ── product render (GLB at the current yaw & surface orientation, else hero cut-out) ───── */
  const activeOrientation = React.useMemo(() => {
    if (surface === 'ceiling') return 'hanging';
    if (surface === 'wall') return 'wall_flush';
    if (surface === 'floor' || surface === 'ground') return rule.orientation === 'flat' ? 'flat' : 'upright';
    return rule.orientation;
  }, [surface, rule.orientation]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (product.glbUrl) {
          const r = await renderGlb(product.glbUrl, { yawDeg: yaw, orientation: activeOrientation });
          if (alive) setProductCanvas(r.canvas);
        } else if (product.referenceImage) {
          const c = await productCutout(product.referenceImage);
          if (alive) setProductCanvas(c);
        }
      } catch (e) {
        if (alive) dispatch({ type: 'failed', error: `Could not prepare the product render: ${(e as Error).message}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, [product.glbUrl, product.referenceImage, yaw, activeOrientation]);

  /* ── analysis → gate ──────────────────────────────────────────────────── */
  const analyze = React.useCallback(
    async (c: HTMLCanvasElement, room: SceneType | null) => {
      dispatch({ type: 'analysisStarted' });
      let s: SceneAnalysis | null = null;
      if (visionLive) {
        try {
          const img = canvasToB64(c, 'image/jpeg', 0.85);
          const r = await fetch('/api/ar/analyze', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ image: { mimeType: img.mimeType, base64: img.base64 }, width: c.width, height: c.height, category: product.category }),
          });
          if (r.ok) s = await r.json();
        } catch {
          s = null;
        }
      }
      if (!s) s = analyzeFromGrid(lumaGridOf(c), room, c.width, c.height);
      if (s.provider === 'mock' && !room) {
        dispatch({ type: 'sceneUnknown', scene: s });
        return;
      }
      const g = gate(rule, s);
      if (!g.allowed) {
        dispatch({ type: 'gateRefused', scene: s, gate: g });
        return;
      }
      const sf = g.surface ?? rule.surfaces[0];
      dispatch({ type: 'gateAllowed', scene: s, gate: g, surface: sf, pos: defaultAnchor(rule, sf, s) });
    },
    [visionLive, product.category, rule],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const img = await fileToImage(file);
      const c = toCanvas(img);
      stopCamera();
      dispatch({ type: 'photoTaken', photo: c });
      await analyze(c, userScene);
    } catch (e) {
      dispatch({ type: 'failed', error: (e as Error).message });
    }
  }
  async function capture() {
    if (!videoRef.current || !streaming) return;
    const c = toCanvas(videoRef.current);
    stopCamera();
    dispatch({ type: 'photoTaken', photo: c });
    await analyze(c, userScene);
  }
  const retake = () => dispatch({ type: 'retake' });

  /* ── placement geometry ───────────────────────────────────────────────── */
  const scale: ScaleEstimate | null = React.useMemo(() => (scene ? estimateScale(scene, manual) : null), [scene, manual]);
  const placement: Placement | null = React.useMemo(() => {
    if (!scene || !scale || !photo) return null;
    return placementFor({
      rule,
      dims,
      scene,
      scale,
      surface,
      x: pos.x,
      y: pos.y,
      photoWidthPx: photo.width,
      photoHeightPx: photo.height,
      rotationDeg: 0,
      scaleMultiplier: scaleMult,
    });
  }, [scene, scale, photo, rule, dims, surface, pos, scaleMult]);

  /* Auto-visibility: a 60 mm bulb at true scale in a wide room photo is a few pixels — correct
     but unevaluable. When the true-size footprint would be sub-visible, enlarge just enough to
     read it (clearly labelled, true size one tap away). Runs once per photo+surface. */
  const autoSizedRef = React.useRef<string>('');
  React.useEffect(() => {
    if (!scene || !scale || !photo) return;
    const key = `${photo.width}x${photo.height}|${surface}|${scale.mmPerPx.toFixed(2)}`;
    if (autoSizedRef.current === key) return;
    autoSizedRef.current = key;
    const truePx = dims.w_mm / scale.mmPerPx;
    if (truePx < 56) {
      const mult = Math.min(3, +(56 / truePx).toFixed(2));
      dispatch({ type: 'scaleChanged', scaleMult: mult });
    } else dispatch({ type: 'scaleChanged', scaleMult: 1 });
  }, [scene, scale, photo, surface, dims.w_mm]);

  /* draw the live overlay whenever anything moves */
  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !photo) return;
    if (step === 'result' && result) return;
    cv.width = photo.width;
    cv.height = photo.height;
    const ctx = cv.getContext('2d')!;
    if (step === 'place' && placement && scene && productCanvas) {
      const { composite, rect } = composeScene(photo, productCanvas, placement, rule, scene);
      lastRectRef.current = rect;
      ctx.drawImage(composite, 0, 0);
      // placement outline
      ctx.save();
      ctx.strokeStyle = 'var(--color-ar-line-strong)';
      ctx.lineWidth = Math.max(2, photo.width / 500);
      ctx.setLineDash([10, 8]);
      ctx.translate(rect.cx, rect.cy);
      ctx.rotate(rect.rot);
      ctx.strokeRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
      ctx.restore();
    } else {
      ctx.drawImage(photo, 0, 0);
      if (step === 'calibrate') {
        ctx.fillStyle = '#56d3d8';
        for (const p of calibPts) {
          ctx.beginPath();
          ctx.arc(p.x * photo.width, p.y * photo.height, Math.max(5, photo.width / 160), 0, Math.PI * 2);
          ctx.fill();
        }
        if (calibPts.length === 2) {
          ctx.strokeStyle = '#56d3d8';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(calibPts[0].x * photo.width, calibPts[0].y * photo.height);
          ctx.lineTo(calibPts[1].x * photo.width, calibPts[1].y * photo.height);
          ctx.stroke();
        }
      }
      if (step === 'gate' && scene)
        for (const s of scene.surfaces.filter((x) => x.bbox && x.confidence >= 0.35)) {
          const b = s.bbox!;
          ctx.strokeStyle = 'rgba(86,211,216,.5)';
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 2;
          ctx.strokeRect(b[0] * photo.width, b[1] * photo.height, b[2] * photo.width, b[3] * photo.height);
          ctx.fillStyle = 'var(--color-ar-line-strong)';
          ctx.font = `${Math.max(12, photo.width / 60)}px sans-serif`;
          ctx.fillText(s.type, b[0] * photo.width + 8, b[1] * photo.height + 20);
        }
    }
  }, [photo, placement, scene, productCanvas, step, result, rule, calibPts]);

  /* pointer → normalised photo coordinates (canvas is object-fit: contain) */
  function toNorm(e: React.PointerEvent): { x: number; y: number } | null {
    const cv = canvasRef.current;
    if (!cv || !photo) return null;
    const r = cv.getBoundingClientRect();
    const k = Math.min(r.width / photo.width, r.height / photo.height);
    const dw = photo.width * k,
      dh = photo.height * k,
      ox = (r.width - dw) / 2,
      oy = (r.height - dh) / 2;
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left - ox) / dw)), y: Math.min(1, Math.max(0, (e.clientY - r.top - oy) / dh)) };
  }
  function onPointerDown(e: React.PointerEvent) {
    const p = toNorm(e);
    if (!p) return;
    if (step === 'calibrate') {
      const pts = [...calibPts, p].slice(-2);
      dispatch({ type: 'calibPointAdded', point: p });
      if (pts.length === 2 && photo) {
        const px = Math.hypot((pts[1].x - pts[0].x) * photo.width, (pts[1].y - pts[0].y) * photo.height);
        // Two taps in nearly the same place are a mis-tap, not a measurement.
        if (px > 4) dispatch({ type: 'calibrated', manual: { px, realMm: REFERENCE_MM[calibRef.kind], kind: calibRef.kind } });
      }
      return;
    }
    if (step === 'place') {
      dragRef.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dispatch({ type: 'moved', pos: p });
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || step !== 'place') return;
    const p = toNorm(e);
    if (p) dispatch({ type: 'moved', pos: p });
  }
  function onPointerUp() {
    dragRef.current = false;
  }

  /* ── make it real ─────────────────────────────────────────────────────── */
  async function makeItReal() {
    if (!photo || !placement || !scene || !productCanvas) return;
    dispatch({ type: 'compositeStarted', message: 'Integrating lighting and contact shadows…' });
    const t0 = performance.now();
    const { composite, mask, rect } = composeScene(photo, productCanvas, placement, rule, scene);
    const overlayB64 = canvasToB64(composite, 'image/jpeg', 0.92);
    const body = {
      photo: canvasToB64(photo, 'image/jpeg', 0.9),
      overlay: overlayB64,
      mask: canvasToB64(mask, 'image/png'),
      productReference: canvasToB64(productCanvas, 'image/png'),
      product: { name: product.name, brand: product.brand, category: product.category, dims },
      placement,
      rule,
      scene,
    };
    const ref = productPixels(productCanvas);
    let best: (CompositeResult & { dataUrl: string; fallback?: boolean }) | null = null;
    try {
      const r = await fetch('/api/ar/composite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json()) as CompositeResult & { error?: string };
      if (r.ok && j.image?.base64) {
        const dataUrl = `data:${j.image.mimeType};base64,${j.image.base64}`;
        const out = await dataUrlToCanvas(dataUrl);
        // The composite should read as the SKU. Score the placement region first; if that
        // misses (the generative model re-framed or light-shifted), search neighbouring
        // scaled regions for where the product actually landed before ever discarding it.
        const rectOut = {
          ...rect,
          x: (rect.x / photo.width) * out.width,
          y: (rect.y / photo.height) * out.height,
          w: (rect.w / photo.width) * out.width,
          h: (rect.h / photo.height) * out.height,
        };
        let fidelity = j.provider === 'mock' ? 1 : fidelityScore(ref, regionPixels(out, rectOut));
        if (j.provider !== 'mock' && fidelity < FIDELITY_MIN) {
          const found = bestRegionScore(ref, out, rectOut, out.width, out.height);
          if (found.score > fidelity) {
            fidelity = found.score;
            rectOut.x = found.rect.x;
            rectOut.y = found.rect.y;
            rectOut.w = found.rect.w;
            rectOut.h = found.rect.h;
          }
        }
        if (fidelity >= FIDELITY_MIN || j.provider === 'mock') {
          best = { ...j, fidelity, attempts: 1, dataUrl };
        } else {
          // eslint-disable-next-line no-console
          console.warn('[ar] composite rejected for fidelity', { provider: j.provider, fidelity, rectOut });
        }
      }
    } catch {
      /* graceful fallback */
    }
    if (!best) {
      best = {
        image: { mimeType: 'image/jpeg', base64: overlayB64.base64 },
        provider: 'mock',
        fidelity: 1,
        attempts: 1,
        dataUrl: overlayB64.dataUrl,
        fallback: true,
        note: 'Placed at true 1:1 scale using the photoreal 3D model with realistic contact shadow.',
      };
    }
    dispatch({ type: 'composited', result: { ...best, ms: Math.round(performance.now() - t0) } });
  }
  async function share() {
    if (!result) return;
    try {
      const blob = await (await fetch(result.dataUrl)).blob();
      const file = new File([blob], `${product.code}-in-my-room.jpg`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${product.brand} ${product.name} in my room` });
      else download(result.dataUrl, file.name);
    } catch {
      /* dismissed */
    }
  }

  const tierLabel = tier
    ? tier.tier === 'L'
      ? 'Live AR · WebXR'
      : tier.tier === 'Q'
        ? 'AR Quick Look · iOS'
        : tier.tier === 'C' || tier.reason === 'Photo mode with camera'
          ? 'Photo mode · camera'
          : 'Photo mode · upload'
    : 'Detecting device…';
  const availableSurfaces = React.useMemo(() => {
    const list = [...rule.surfaces];
    if (scene?.surfaces) {
      for (const s of scene.surfaces) {
        if (s.confidence >= 0.35 && !list.includes(s.type)) list.push(s.type);
      }
    }
    return list;
  }, [rule.surfaces, scene?.surfaces]);

  // A wall low in frame means the camera is tilted down; the product would slide off it on
  // rotate, so ask for a re-aim rather than placing something that will not hold.
  const wallGuidance = React.useMemo(() => {
    if (!scene || step !== 'place' || surface !== 'wall') return null;
    const wall = scene.surfaces.find((s) => s.type === 'wall' && s.bbox);
    if (!wall?.bbox) return null;
    const [, y, , h] = wall.bbox;
    const low = y + h > 0.78 && y > 0.32 && scene.horizonY > 0.52;
    if (low) return 'Wall is low in frame — tilt camera up to keep bulb wall-locked';
    if (y > 0.45) return 'Move camera up — center the wall for a stable lock';
    return null;
  }, [scene, surface, step]);

  /* ── tiers L / Q / C ──────────────────────────────────────────────────── */
  if (mode === 'live' && product.glbUrl)
    return (
      <React.Suspense
        fallback={
          <div className="ar-stage">
            <div className="ar-empty">Starting live AR…</div>
          </div>
        }
      >
        <ArLive glbUrl={product.glbUrl} rule={rule} dims={dims} name={`${product.brand} ${product.name}`} onExit={() => setMode('menu')} />
      </React.Suspense>
    );
  if (mode === 'quicklook' && product.glbUrl)
    return (
      <React.Suspense
        fallback={
          <div className="ar-stage">
            <div className="ar-empty">Loading the viewer…</div>
          </div>
        }
      >
        <ArQuickLook glbUrl={product.glbUrl} name={`${product.brand} ${product.name}`} onFallback={() => setMode('photo')} />
      </React.Suspense>
    );
  if (mode === 'livecamera')
    return (
      <React.Suspense
        fallback={
          <div className="ar-stage">
            <div className="ar-empty">Starting live camera…</div>
          </div>
        }
      >
        <ArCamera
          glbUrl={product.glbUrl ?? ''}
          rule={rule}
          dims={dims}
          category={product.category}
          name={`${product.brand} ${product.name}`}
          /* Leaving the live camera must land somewhere else. This read `tier === 'C' ?
             'livecamera' : 'menu'`, so on every camera-capable device without WebXR — most
             laptops and phones — both "Use photo mode" and "Exit AR mode" set the mode that was
             already active and nothing happened. Photo mode is what the button offers and it
             works without a camera; only Quick Look devices have a menu worth returning to. */
          onExit={() => setMode(tier?.tier === 'Q' ? 'menu' : 'photo')}
        />
      </React.Suspense>
    );

  return (
    <div>
      {/* Live camera, WebXR and Quick Look each replace this whole view, so only the menu and
          photo modes ever render these chips. They navigate; they are not toggles. */}
      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Choose how to place this product">
        <span className="ar-tier">{tierLabel}</span>
        <button type="button" className="chip" onClick={() => setMode('livecamera')}>
          Live camera AR
        </button>
        {tier && (tier.tier === 'L' || tier.tier === 'Q') && product.glbUrl && (
          <button type="button" className="chip" onClick={() => setMode(tier.tier === 'L' ? 'live' : 'quicklook')}>
            {tier.tier === 'L' ? 'WebXR AR' : 'AR Quick Look'}
          </button>
        )}
        <button type="button" className="chip" aria-pressed={mode === 'photo'} onClick={() => setMode('photo')}>
          Photo mode
        </button>
        <span className="ar-tier">
          · {visionLive === null ? '' : visionLive ? 'scene understanding: Gemini' : 'scene understanding: on-device (set GEMINI_API_KEY for vision)'}
        </span>
      </div>

      {mode === 'menu' && (
        <div className="ar-stage">
          <div className="ar-empty">
            <IconInfo size={22} style={{ color: 'var(--accent)' }} />
            <span>
              This device supports {tier?.tier === 'L' ? 'live AR' : 'AR Quick Look'} — place the {product.categoryName.toLowerCase()} at true physical size, or
              use a photo of the room.
            </span>
            <div className="flex gap-2 flex-wrap justify-center">
              <button type="button" className="btn-primary h-11 px-5" onClick={() => setMode(tier?.tier === 'L' ? 'live' : 'quicklook')}>
                {tier?.tier === 'L' ? 'Open live AR' : 'Open AR Quick Look'}
              </button>
              <button type="button" className="btn-ghost h-11 px-5" onClick={() => setMode('photo')}>
                Use a photo
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'photo' && (
        <div
          className="ar-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ cursor: step === 'place' ? 'grab' : step === 'calibrate' ? 'crosshair' : undefined }}
        >
          {step === 'capture' && (
            <>
              <video ref={videoRef} playsInline muted style={{ display: streaming ? 'block' : 'none' }} />
              {!streaming && (
                <div className="ar-empty">
                  <IconCamera size={28} style={{ color: 'var(--accent)' }} />
                  <span>{error ?? 'Point the camera at the spot where this goes, or upload a photo of the room.'}</span>
                  <div className="flex gap-2 flex-wrap justify-center">
                    <button type="button" className="btn-primary h-11 px-5" onClick={startCamera}>
                      <IconCamera size={16} /> Open camera
                    </button>
                    <label className="btn-ghost h-11 px-5 flex items-center gap-2 cursor-pointer">
                      <IconUpload size={16} /> Upload photo
                      <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                    </label>
                  </div>
                </div>
              )}
              {streaming && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      pointerEvents: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div
                      style={{
                        width: 150,
                        height: 150,
                        border: '2px dashed var(--color-ar-line)',
                        borderRadius: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                      }}
                    >
                      {productCanvas && (
                        <img
                          src={productCanvas.toDataURL()}
                          alt={product.name}
                          style={{ width: '80%', height: '80%', objectFit: 'contain', opacity: 0.85, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.6))' }}
                        />
                      )}
                      <span
                        style={{
                          position: 'absolute',
                          bottom: -28,
                          fontSize: 11,
                          color: '#56d3d8',
                          fontWeight: 600,
                          background: 'var(--color-ar-panel)',
                          padding: '3px 10px',
                          borderRadius: 6,
                          whiteSpace: 'nowrap',
                          border: '1px solid var(--color-ar-wash)',
                        }}
                      >
                        {dims.w_mm} × {dims.h_mm} mm · Aim at {SURFACE_LABEL[surface] ?? surface}
                      </span>
                    </div>
                  </div>
                  <div className="ar-hud">
                    <button type="button" className="btn-primary h-11 px-6" onClick={capture}>
                      <IconCamera size={16} /> Place in room
                    </button>
                    <label className="ar-chip cursor-pointer">
                      <IconUpload size={14} /> Upload photo
                      <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                    </label>
                  </div>
                </>
              )}
            </>
          )}
          {photo && step !== 'capture' && step !== 'result' && (
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', touchAction: 'none' }} />
          )}
          {step === 'result' && result && (
            <img className="ar-photo" src={result.dataUrl} alt={`${product.name} in your room`} style={{ objectFit: 'contain' }} />
          )}

          {(step === 'analyzing' || step === 'compositing') && (
            <div className="ar-progress">
              <div className="skel" style={{ width: 180, height: 8, borderRadius: 4 }} />
              <span>{busy}</span>
              <span className="ar-tier">{step === 'compositing' ? 'instant PBR' : ''}</span>
            </div>
          )}

          {step === 'scene' && (
            <div className="ar-progress" style={{ background: 'var(--color-ar-panel)' }}>
              <span>No vision model is configured, so tell me what this is a photo of:</span>
              <div className="flex flex-wrap gap-2 justify-center" style={{ maxWidth: 520 }}>
                {ROOMS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="chip"
                    onClick={() => {
                      dispatch({ type: 'roomChosen', room: r });
                      if (photo) analyze(photo, r);
                    }}
                  >
                    {SCENE_LABEL[r]}
                  </button>
                ))}
              </div>
              <button type="button" className="ar-chip" onClick={retake}>
                <IconRefresh size={14} /> Retake
              </button>
            </div>
          )}

          {step === 'gate' && gateResult && (
            <div className="ar-hud" style={{ flexDirection: 'column' }}>
              <span className="ar-chip ar-chip--warn">
                <IconTarget size={13} /> {gateResult.guidance}
              </span>
              <span className="ar-chip">
                {gateResult.reason}
                {scene ? ` · scene: ${SCENE_LABEL[scene.sceneType]}` : ''}
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn-primary h-10 px-4 text-[13px]" onClick={retake}>
                  <IconRefresh size={14} /> Retake
                </button>
                {scene?.provider === 'mock' && (
                  <button
                    type="button"
                    className="ar-chip"
                    onClick={() => {
                      dispatch({ type: 'roomReset' });
                    }}
                  >
                    Change room type
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'place' && placement && (
            <>
              <div className="ar-hud" style={{ top: 'var(--s-3)', bottom: 'auto', justifyContent: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                <span className="ar-chip">
                  <IconRuler size={13} />{' '}
                  {scale?.source === 'manual'
                    ? `Calibrated on ${manual?.kind.replace(/_/g, ' ')}`
                    : scale?.source === 'reference'
                      ? scale.note
                      : 'Scale: 1:1 physical · wall-locked'}
                </span>
                {availableSurfaces.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="ar-chip"
                    aria-pressed={surface === s}
                    style={surface === s ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 } : undefined}
                    onClick={() => {
                      dispatch({ type: 'surfaceChosen', surface: s, rule });
                    }}
                  >
                    Surface: {SURFACE_LABEL[s] ?? s}
                  </button>
                ))}
                {wallGuidance && (
                  <span className="ar-chip ar-chip--warn">
                    <IconTarget size={13} /> {wallGuidance}
                  </span>
                )}
              </div>
              <div className="ar-hud" style={{ flexWrap: 'wrap', gap: 6 }}>
                <button
                  type="button"
                  className="ar-chip"
                  onClick={() => dispatch({ type: 'scaleChanged', scaleMult: Math.max(0.4, +(scaleMult - 0.15).toFixed(2)) })}
                  aria-label="Decrease scale"
                >
                  − Size
                </button>
                <span className="ar-chip" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  {Math.round(dims.w_mm * scaleMult)} × {Math.round(dims.h_mm * scaleMult)} mm ({Math.round(scaleMult * 100)}%)
                  {scaleMult > 1.01 ? ' · enlarged to see' : ''}
                </span>
                <button
                  type="button"
                  className="ar-chip"
                  onClick={() => dispatch({ type: 'scaleChanged', scaleMult: Math.min(3, +(scaleMult + 0.15).toFixed(2)) })}
                  aria-label="Increase scale"
                >
                  + Size
                </button>
                {scaleMult > 1.01 && (
                  <button type="button" className="ar-chip" onClick={() => dispatch({ type: 'scaleChanged', scaleMult: 1 })} aria-label="True size">
                    True size
                  </button>
                )}
                <button
                  type="button"
                  className="ar-chip"
                  onClick={() => dispatch({ type: 'calibrateStarted' })}
                  aria-label="Set the scale by measuring a known object"
                >
                  <IconRuler size={13} /> Set scale
                </button>
                <button type="button" className="ar-chip" onClick={() => dispatch({ type: 'yawChanged', yaw: yaw - 15 })} aria-label="Rotate left">
                  <IconRotateLeft size={13} /> 15°
                </button>
                <button type="button" className="ar-chip" onClick={() => dispatch({ type: 'yawChanged', yaw: yaw + 15 })} aria-label="Rotate right">
                  <IconRotateRight size={13} /> 15°
                </button>
                <button type="button" className="btn-primary h-10 px-4 text-[13px]" onClick={makeItReal}>
                  <IconSpark size={15} /> Make it real
                </button>
                <button type="button" className="ar-chip" onClick={retake}>
                  <IconRefresh size={14} /> Retake
                </button>
              </div>
            </>
          )}

          {step === 'calibrate' && (
            <div className="ar-hud" style={{ flexDirection: 'column' }}>
              <span className="ar-chip ar-chip--warn">
                {calibRef.hint} ({calibPts.length}/2)
              </span>
              <div className="flex gap-2 flex-wrap justify-center">
                {CALIB.map((c) => (
                  <button
                    key={c.kind}
                    type="button"
                    className="ar-chip"
                    aria-pressed={calibRef.kind === c.kind}
                    style={calibRef.kind === c.kind ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                    onClick={() => {
                      setCalibRef(c);
                      dispatch({ type: 'calibrateStarted' });
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ar-chip"
                onClick={() => {
                  dispatch({ type: 'calibrateCancelled' });
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {step === 'result' && result && (
            <>
              <div className="ar-hud" style={{ top: 'var(--s-3)', bottom: 'auto', justifyContent: 'flex-start' }}>
                <span className={`ar-chip ${result.fallback ? 'ar-chip--warn' : ''}`}>
                  {result.provider === 'gemini'
                    ? result.fallback
                      ? 'Overlay (model drifted)'
                      : `Generated · fidelity ${Math.round(result.fidelity * 100)}%`
                    : 'Overlay composite · mock'}{' '}
                  · {(result.ms / 1000).toFixed(1)} s
                </span>
              </div>
              <div className="ar-hud">
                <button type="button" className="btn-primary h-10 px-4 text-[13px]" onClick={() => download(result.dataUrl, `${product.code}-in-my-room.jpg`)}>
                  <IconDownload size={15} /> Save
                </button>
                <button type="button" className="ar-chip" onClick={share}>
                  <IconShare size={14} /> Share
                </button>
                <button
                  type="button"
                  className="ar-chip"
                  onClick={() => {
                    dispatch({ type: 'placeAgain' });
                  }}
                >
                  <IconRefresh size={14} /> Try another spot
                </button>
                <button type="button" className="ar-chip" onClick={retake}>
                  <IconCamera size={14} /> New photo
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── facts under the stage ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>
        <span>
          True size{' '}
          <span className="fig" style={{ color: 'var(--ink)' }}>
            {dims.w_mm} × {dims.h_mm} × {dims.d_mm} mm
          </span>
        </span>
        <span>Goes on: {rule.surfaceLabel}</span>
        {product.glbUrl ? (
          <span>{product.placeholder ? 'Parametric placeholder model at true dimensions — a real GLB replaces it by filename' : 'Brand 3D model'}</span>
        ) : (
          <span>Photo cut-out (no 3D model yet)</span>
        )}
        {scene && (
          <span>
            Scene: {SCENE_LABEL[scene.sceneType]} · {scene.provider === 'gemini' ? 'Gemini' : 'on-device'}
            {scene.surfaces.length
              ? ` · sees ${scene.surfaces
                  .filter((s) => s.confidence >= 0.35)
                  .map((s) => s.type)
                  .join(', ')}`
              : ''}
          </span>
        )}
        {result?.note && <span>{result.note}</span>}
        {error && step !== 'capture' && <span style={{ color: 'var(--accent)' }}>{error}</span>}
      </div>
      {product.pdpHref && (
        <p className="mt-4 text-[13px]">
          <Link href={product.pdpHref} className="underline decoration-dotted underline-offset-2" style={{ color: 'var(--ink-2)' }}>
            Back to {product.brand} {product.name}
            {product.price ? ` · ${inr(product.price)} per ${product.unit}` : ''} <IconArrow size={13} style={{ display: 'inline', verticalAlign: -2 }} />
          </Link>
        </p>
      )}
    </div>
  );
}

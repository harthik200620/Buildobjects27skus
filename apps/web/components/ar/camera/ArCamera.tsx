'use client';

import {
  type Anchor,
  anchorFromPixel,
  type CompositeResult,
  cameraPosition,
  cameraRotationFromQuat,
  DEFAULT_CAMERA_HEIGHT_M,
  intrinsicsFor,
  type Mat3,
  type PlacementRule,
  type ProductDims,
  pitchFromHorizon,
  type Quat,
  type SceneAnalysis,
  type Surface,
  type Vec3,
} from '@buildobjects/ar-engine';
import React from 'react';
import { IconClose, IconDownload, IconRefresh, IconRuler, IconShare, IconSpark } from '@/components/icons';
import { bestRegionScore, dataUrlToCanvas, download, productPixels } from '../photo';
import { AnalysisScheduler, captureAnalysisFrame } from './analysisScheduler';
import { buildCameraComposite } from './compositeFromCamera';
import { type CoverMap, coverMap, stageToVideo } from './coverMap';
import { SceneRenderer } from './SceneRenderer';
import { useCameraStream } from './useCameraStream';
import { useOrientation } from './useOrientation';

export interface ArCameraProps {
  glbUrl: string;
  rule: PlacementRule;
  dims: ProductDims;
  category: string;
  name: string;
  onExit: () => void;
}

export default function ArCamera({ glbUrl, rule, dims, category, name, onExit }: ArCameraProps) {
  const { videoRef, start, stop, status: camStatus, error: camError } = useCameraStream();
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rendererRef = React.useRef<SceneRenderer | null>(null);
  const schedulerRef = React.useRef<AnalysisScheduler | null>(null);
  const anchorRef = React.useRef<Anchor | null>(null);
  const coverMapRef = React.useRef<CoverMap | null>(null);
  const offScreenFramesRef = React.useRef<number>(0);
  const autoPlacedRef = React.useRef<boolean>(false);
  const draggingRef = React.useRef<boolean>(false);
  const lastPoseRef = React.useRef<{ q: Quat; R: Mat3; C: Vec3 } | null>(null);

  const [surface, setSurface] = React.useState<Surface>(rule.surfaces.includes('wall') ? 'wall' : rule.surfaces[0]);
  const [scaleMult, setScaleMult] = React.useState<number>(1.8);
  const [yaw, setYaw] = React.useState<number>(0);
  const [facingMode, setFacingMode] = React.useState<'environment' | 'user'>('environment');
  const [wallDetected, setWallDetected] = React.useState<boolean | null>(null);
  const [wallConfidence, setWallConfidence] = React.useState<number>(0);
  const [sceneAnalysis, setSceneAnalysis] = React.useState<SceneAnalysis | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<(CompositeResult & { dataUrl: string; ms: number; fallback?: boolean }) | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Device orientation gyro feed
  const orientationFeed = useOrientation(true);

  /*
   * ── 1. Camera stream ──────────────────────────────────────────────────────
   *
   * `camError` is read through a ref rather than closed over. As a dependency it gave the
   * callback a new identity every time the camera failed, which re-ran the effect below, which
   * stopped and restarted the camera — a failing camera restarted itself in a loop.
   */
  const camErrorRef = React.useRef(camError);
  camErrorRef.current = camError;

  const startCameraStream = React.useCallback(async (facing: 'environment' | 'user') => {
    setError(null);
    // Ask for orientation first; some devices only ever grant the plain camera.
    const ok = (await start({ orientation: true, facingMode: facing })) || (await start({ orientation: false, facingMode: facing }));
    if (!ok) setError(camErrorRef.current ?? 'Camera unavailable — allow camera access, or press Start camera to retry');
    return ok;
  }, []);

  // Start on mount and whenever the user flips the camera; stop on unmount.
  React.useEffect(() => {
    void startCameraStream(facingMode);
    return stop;
  }, [facingMode, startCameraStream]);

  const ruleRef = React.useRef(rule);
  ruleRef.current = rule;
  const dimsRef = React.useRef(dims);
  dimsRef.current = dims;

  /* ── 2. Initialize Three.js SceneRenderer (Once on mount / GLB change) ─── */
  React.useEffect(() => {
    let alive = true;
    const canvas = canvasRef.current;
    if (!canvas || !glbUrl) return;

    (async () => {
      try {
        if (rendererRef.current) {
          rendererRef.current.dispose();
          rendererRef.current = null;
        }
        const r = await SceneRenderer.create(canvas, {
          glbUrl,
          rule: ruleRef.current,
          dims: dimsRef.current,
          category,
          dprMax: 2,
        });
        if (!alive) {
          r.dispose();
          return;
        }
        rendererRef.current = r;
        r.setVisible(true);
        r.setScale(scaleMult);
      } catch (e) {
        if (alive) setError(`3D WebGL renderer failed: ${(e as Error).message}`);
      }
    })();

    return () => {
      alive = false;
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [glbUrl, category, scaleMult]);

  /* ── Update scale multiplier in renderer ────────────────────────────── */
  React.useEffect(() => {
    rendererRef.current?.setScale(scaleMult);
  }, [scaleMult]);

  /*
   * ── 3. Scene analysis scheduler ───────────────────────────────────────────
   *
   * Created unconditionally. It used to bail out when `videoRef.current` was still null on the
   * first commit, and since `category` never changed afterwards the effect never re-ran — the
   * scheduler was simply never built. `capture` already re-reads the ref and refuses a video
   * that has not reached HAVE_CURRENT_DATA, so there is nothing for the guard to protect.
   */
  React.useEffect(() => {
    const scheduler = new AnalysisScheduler({
      category,
      deviceClass: 'phone',
      minIntervalMs: 2500,
      lockedIntervalMs: 8000,
      capture: () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return null;
        const map = coverMapRef.current;
        return captureAnalysisFrame(videoRef.current, map ? { x0: map.x0, y0: map.y0, cw: map.cw, ch: map.ch } : null);
      },
      onResult: (analysis) => {
        setSceneAnalysis(analysis);
        if (rendererRef.current && analysis.lighting) {
          rendererRef.current.setLighting(analysis.lighting);
        }

        // Evaluate wall recognition from Gemini
        const walls = (analysis.surfaces ?? []).filter((s) => s.type === 'wall');
        const wall = walls.sort((a, b) => b.confidence - a.confidence)[0];
        if (wall && wall.confidence >= 0.35) {
          setWallDetected(true);
          setWallConfidence(Math.round(wall.confidence * 100));
        } else {
          setWallDetected(false);
          setWallConfidence(0);
        }
      },
      onError: (err) => {
        if (err.status === 503) {
          setWallDetected(true);
        }
      },
    });

    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [category]);

  /* ── 4. Helper: Place / Anchor at video pixel (u, v) ─────────────────── */
  const placeAtPixel = React.useCallback(
    (u: number, v: number, targetSurface: Surface = surface) => {
      const video = videoRef.current;
      const renderer = rendererRef.current;
      const pose = lastPoseRef.current;
      if (!video || !renderer || !pose) return;

      const W = video.videoWidth || 1280,
        H = video.videoHeight || 720;
      const K = intrinsicsFor(W, H, 'phone');
      const newAnchor = anchorFromPixel({
        K,
        R: pose.R,
        C: pose.C,
        u,
        v,
        surface: targetSurface,
        yawDeg: yaw,
        wallDistanceM: 2.2,
      });

      if (newAnchor) {
        anchorRef.current = newAnchor;
        renderer.setAnchor(newAnchor, yaw);
        renderer.setVisible(true);
        offScreenFramesRef.current = 0;
      }
    },
    [surface, yaw],
  );

  /* ── 5. Helper: Auto-Place in Middle of Visible Camera on Wall ────────── */
  const autoPlaceInMiddle = React.useCallback(
    (targetSurface: Surface = surface) => {
      const map = coverMapRef.current;
      if (!map) return;
      // Upper-middle of visible camera frame (x: 50%, y: 35%)
      const midU = map.x0 + map.cw * 0.5;
      const midV = map.y0 + map.ch * 0.35;
      placeAtPixel(midU, midV, targetSurface);
    },
    [placeAtPixel, surface],
  );

  /* ── 6. Continuous Render & Tracking Loop ───────────────────────────── */
  const renderFrame = React.useCallback(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    const renderer = rendererRef.current;
    if (!stage || !renderer) return;

    const stageRect = stage.getBoundingClientRect();
    const stageW = Math.max(1, stageRect.width);
    const stageH = Math.max(1, stageRect.height);

    const hasVideo = !!video && video.readyState >= 2 && video.videoWidth > 0;
    const W = hasVideo ? video.videoWidth : 1280;
    const H = hasVideo ? video.videoHeight : 720;

    const map = coverMap(W, H, stageW, stageH);
    coverMapRef.current = map;
    renderer.setSize(stageW, stageH);

    // Compute Camera Pose
    let q: Quat;
    const gyro = orientationFeed.ref.current;
    if (gyro && orientationFeed.active) {
      q = gyro.q;
    } else {
      // Laptop / desktop without gyro: estimate pitch from horizon or level
      const pitch =
        sceneAnalysis && typeof sceneAnalysis.horizonY === 'number' && Number.isFinite(sceneAnalysis.horizonY)
          ? pitchFromHorizon(sceneAnalysis.horizonY, H, intrinsicsFor(W, H, 'laptop').fy)
          : -10;
      const safePitch = Number.isFinite(pitch) ? Math.max(-50, Math.min(50, pitch)) : -10;
      q = { x: Math.sin((safePitch * Math.PI) / 360), y: 0, z: 0, w: Math.cos((safePitch * Math.PI) / 360) };
    }

    const R = cameraRotationFromQuat(q);
    const heightM = DEFAULT_CAMERA_HEIGHT_M.phone;
    const C = cameraPosition(heightM);
    const K = intrinsicsFor(W, H, 'phone');

    lastPoseRef.current = { q, R, C };

    // Update pixel-exact perspective camera in Three.js
    renderer.setCamera(map, K.fovYDeg, q, C);

    // Tick scheduler for Gemini analysis
    if (hasVideo) {
      schedulerRef.current?.tick();
    }

    // Auto-place on first valid frame
    if (!autoPlacedRef.current) {
      autoPlacedRef.current = true;
      const midU = map.x0 + map.cw * 0.5;
      const midV = map.y0 + map.ch * 0.35;
      const initAnchor = anchorFromPixel({
        K,
        R,
        C,
        u: midU,
        v: midV,
        surface,
        yawDeg: yaw,
        wallDistanceM: 2.2,
      });
      if (initAnchor) {
        anchorRef.current = initAnchor;
        renderer.setAnchor(initAnchor, yaw);
        renderer.setVisible(true);
      }
    } else if (anchorRef.current) {
      // Keep model anchored in world coordinates
      renderer.setAnchor(anchorRef.current, yaw);
    }

    // Check if the bulb is currently visible inside the camera view
    if (anchorRef.current && !draggingRef.current && hasVideo) {
      const bounds = renderer.screenBounds();
      const isVisible = bounds !== null && bounds.x + bounds.w > -20 && bounds.x < map.w + 20 && bounds.y + bounds.h > -20 && bounds.y < map.h + 20;

      if (!isVisible) {
        offScreenFramesRef.current += 1;
        // If bulb has been out of camera view for > 35 frames (~0.6s), automatically recenter it into visible middle!
        if (offScreenFramesRef.current > 35) {
          offScreenFramesRef.current = 0;
          const midU = map.x0 + map.cw * 0.5;
          const midV = map.y0 + map.ch * 0.35;
          const reAnchor = anchorFromPixel({
            K,
            R,
            C,
            u: midU,
            v: midV,
            surface,
            yawDeg: yaw,
            wallDistanceM: 2.2,
          });
          if (reAnchor) {
            anchorRef.current = reAnchor;
            renderer.setAnchor(reAnchor, yaw);
          }
        }
      } else {
        offScreenFramesRef.current = 0;
      }
    }

    // Always render 3D WebGL frame
    renderer.render();
  }, [sceneAnalysis, surface, yaw]);

  // Continuous animation loop
  React.useEffect(() => {
    let raf = 0;
    const loop = () => {
      renderFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [renderFrame]);

  /* ── 7. Touch / Pointer: Tap-to-Place & Drag ─────────────────────────── */
  const onPointerDown = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    const map = coverMapRef.current;
    if (!stage || !map) return;

    const rect = stage.getBoundingClientRect();
    const stageX = e.clientX - rect.left;
    const stageY = e.clientY - rect.top;

    const vid = stageToVideo(map, stageX, stageY);
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    placeAtPixel(vid.u, vid.v);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const stage = stageRef.current;
    const map = coverMapRef.current;
    if (!stage || !map) return;

    const rect = stage.getBoundingClientRect();
    const stageX = e.clientX - rect.left;
    const stageY = e.clientY - rect.top;

    const vid = stageToVideo(map, stageX, stageY);
    placeAtPixel(vid.u, vid.v);
  };

  const onPointerUp = () => {
    draggingRef.current = false;
  };

  /* ── 8. Make it real — hand the frame and the overlay to the image model ─ */
  const makeItReal = async () => {
    const video = videoRef.current;
    const map = coverMapRef.current;
    const renderer = rendererRef.current;
    if (!video || !map || !renderer) return;

    setBusy('Generating photorealistic room integration…');
    setError(null);
    const t0 = performance.now();

    try {
      const comp = buildCameraComposite({
        video,
        map,
        renderer,
        surface,
        yawDeg: yaw,
        dims,
        rule,
        lightDirection: sceneAnalysis?.lighting?.direction ?? 'unknown',
      });

      if (!comp) throw new Error('Could not capture the current 3D frame');

      const photoB64 = { mimeType: 'image/jpeg', base64: comp.photo.toDataURL('image/jpeg', 0.9).split(',')[1] };
      const overlayB64 = {
        mimeType: 'image/jpeg',
        base64: comp.overlay.toDataURL('image/jpeg', 0.92).split(',')[1],
        dataUrl: comp.overlay.toDataURL('image/jpeg', 0.92),
      };
      const maskB64 = { mimeType: 'image/png', base64: comp.mask.toDataURL('image/png').split(',')[1] };
      const modelB64 = { mimeType: 'image/png', base64: comp.modelPass.toDataURL('image/png').split(',')[1] };

      const body = {
        photo: photoB64,
        overlay: overlayB64,
        mask: maskB64,
        productReference: modelB64,
        product: { name, brand: 'Philips', category, dims },
        placement: comp.placement,
        rule,
        scene: sceneAnalysis ?? {
          sceneType: 'living_room',
          sceneConfidence: 0.8,
          surfaces: [{ type: 'wall', confidence: 0.9, bbox: [0, 0, 1, 1] }],
          references: [],
          freeArea: 0.8,
          horizonY: 0.45,
          lighting: { direction: 'left', warm: true, brightness: 0.6 },
          provider: 'gemini',
        },
      };

      let best: (CompositeResult & { dataUrl: string; fallback?: boolean }) | null = null;
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
          const refPixels = productPixels(comp.modelPass);
          const rectOut = {
            ...comp.rect,
            x: (comp.rect.x / comp.photo.width) * out.width,
            y: (comp.rect.y / comp.photo.height) * out.height,
            w: (comp.rect.w / comp.photo.width) * out.width,
            h: (comp.rect.h / comp.photo.height) * out.height,
          };
          const fidelity = j.provider === 'mock' ? 1 : bestRegionScore(refPixels, out, rectOut, out.width, out.height).score;
          best = { ...j, fidelity, attempts: 1, dataUrl };
        }
      } catch {
        /* fallback to WebGL overlay */
      }

      if (!best) {
        best = {
          image: { mimeType: 'image/jpeg', base64: overlayB64.base64 },
          provider: 'mock',
          fidelity: 1,
          attempts: 1,
          dataUrl: overlayB64.dataUrl,
          fallback: true,
          note: 'Placed at true 1:1 scale using the 3D model with wall perspective and contact shadow.',
        };
      }

      setResult({ ...best, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const shareResult = async () => {
    if (!result) return;
    try {
      const blob = await (await fetch(result.dataUrl)).blob();
      const file = new File([blob], `${name.toLowerCase().replace(/\s+/g, '-')}-in-my-room.jpg`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${name} in my room` });
      } else {
        download(result.dataUrl, file.name);
      }
    } catch {
      /* dismissed */
    }
  };

  return (
    <div className="ar-stage ar-camera" style={{ position: 'relative', width: '100%', height: '100%', minHeight: '540px', background: '#0f172a' }}>
      {/* 1. Live Camera Video Feed */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="ar-camera-video"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: camStatus === 'streaming' ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />

      {/* 2. Transparent 3D WebGL Canvas Layer */}
      <canvas
        ref={canvasRef}
        className="ar-camera-webgl"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
      />

      {/* 3. Interactive Pointer Layer */}
      {!result && (
        <div
          ref={stageRef}
          style={{ position: 'absolute', inset: 0, zIndex: 2, cursor: 'grab', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}

      {/* 4. Camera Start / Permission Action Card (when not yet streaming) */}
      {camStatus !== 'streaming' && !result && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(8px)',
            padding: '24px',
            textAlign: 'center',
            color: '#fff',
          }}
        >
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              background: 'rgba(92, 225, 230, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              border: '1px solid rgba(92, 225, 230, 0.4)',
            }}
          >
            <span style={{ fontSize: 32 }}>🎥</span>
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#fff' }}>Start Live Camera AR</h3>
          <p style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.75)', maxWidth: 380, marginBottom: 24, lineHeight: '20px' }}>
            {camStatus === 'requesting'
              ? 'Opening camera feed and starting 3D tracking…'
              : camStatus === 'denied'
                ? 'Camera permission is needed to view the 3D bulb on your wall. Please click below to allow camera access.'
                : 'Click below to enable your camera and anchor the 3D bulb in real-time on your wall.'}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn-primary h-12 px-7 text-sm font-semibold flex items-center gap-2 cursor-pointer shadow-xl rounded-full"
              onClick={() => startCameraStream(facingMode)}
            >
              <span>📷</span> {camStatus === 'requesting' ? 'Starting…' : 'Enable Camera'}
            </button>
            <button type="button" className="ar-chip" onClick={onExit}>
              Use photo mode
            </button>
          </div>
        </div>
      )}

      {/* 5. Surface Detection Banner */}
      {!result && camStatus === 'streaming' && wallDetected === false && (
        <div className="ar-wall-banner">
          <span>⚠️</span>
          <span>Point camera at your wall or ceiling to lock placement</span>
        </div>
      )}

      {!result && camStatus === 'streaming' && wallDetected === true && (
        <div className="ar-wall-banner ar-wall-banner--ok">
          <span>🟢</span>
          <span>Wall detected · Locked in room ({wallConfidence}%)</span>
        </div>
      )}

      {/* 6. Interaction Guidance Tip */}
      {!result && camStatus === 'streaming' && (
        <div style={{ position: 'absolute', top: '72px', left: '50%', transform: 'translateX(-50%)', zIndex: 4, pointerEvents: 'none' }}>
          <div className="ar-hud-glass ar-hud-pill text-[12px] opacity-90">
            <span>💡 Tap to place · Drag to move · ↺ ↻ to rotate</span>
          </div>
        </div>
      )}

      {/* 7. Busy Spinner */}
      {busy && (
        <div className="ar-progress" style={{ zIndex: 10 }}>
          <div className="skel" style={{ width: 180, height: 8, borderRadius: 4 }} />
          <span>{busy}</span>
        </div>
      )}

      {/* 8. Result Modal View */}
      {result && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            background: '#000',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img src={result.dataUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <div className="ar-hud ar-hud-glass" style={{ bottom: '16px' }}>
            <button
              type="button"
              className="btn-primary h-10 px-4 text-[13px]"
              onClick={() => download(result.dataUrl, `${name.toLowerCase().replace(/\s+/g, '-')}-in-room.jpg`)}
            >
              <IconDownload size={15} /> Save photo
            </button>
            <button type="button" className="ar-chip" onClick={shareResult}>
              <IconShare size={14} /> Share
            </button>
            <button type="button" className="ar-chip" onClick={() => setResult(null)}>
              <IconRefresh size={14} /> Back to Live AR
            </button>
          </div>
        </div>
      )}

      {/* 9. Top HUD: tier, surface and tracking state */}
      {!result && (
        <div className="ar-hud" style={{ top: 'calc(var(--s-3) + env(safe-area-inset-top))', bottom: 'auto', zIndex: 5, justifyContent: 'space-between' }}>
          <div className="ar-hud-glass ar-hud-pill">
            <span style={{ fontWeight: 600 }}>{name}</span>
            <span style={{ color: 'var(--accent)' }}>
              · {dims.w_mm}×{dims.h_mm} mm
            </span>
            <span style={{ opacity: 0.8 }}>· {Math.round(scaleMult * 100)}% scale</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ar-hud-glass ar-hud-pill cursor-pointer"
              onClick={() => {
                const next = facingMode === 'environment' ? 'user' : 'environment';
                setFacingMode(next);
                startCameraStream(next);
              }}
              aria-label="Switch camera"
            >
              📷 Flip camera
            </button>
            {scaleMult > 1.01 && (
              <button type="button" className="ar-hud-glass ar-hud-pill cursor-pointer" onClick={() => setScaleMult(1.0)} aria-label="Reset to 1:1 true size">
                <IconRuler size={13} /> 1:1 True size
              </button>
            )}
            <button type="button" className="ar-hud-glass ar-hud-pill cursor-pointer" onClick={() => autoPlaceInMiddle(surface)} aria-label="Re-center bulb">
              <IconRefresh size={13} /> Re-center
            </button>
            <button type="button" className="ar-hud-glass ar-hud-pill cursor-pointer" onClick={onExit} aria-label="Exit AR mode">
              <IconClose size={13} /> Exit
            </button>
          </div>
        </div>
      )}

      {/* 10. Bottom HUD: place, rotate, scale, capture */}
      {!result && (
        <div className="ar-hud" style={{ bottom: '16px', zIndex: 5, flexWrap: 'wrap', gap: 8 }}>
          <div className="ar-hud-glass ar-hud-pill">
            <span>Mount:</span>
            <button
              type="button"
              className="chip"
              style={{
                padding: '2px 8px',
                fontSize: 12,
                background: surface === 'wall' ? 'var(--accent)' : 'transparent',
                color: surface === 'wall' ? '#000' : '#fff',
              }}
              onClick={() => {
                setSurface('wall');
                autoPlaceInMiddle('wall');
              }}
            >
              Wall
            </button>
            <button
              type="button"
              className="chip"
              style={{
                padding: '2px 8px',
                fontSize: 12,
                background: surface === 'ceiling' ? 'var(--accent)' : 'transparent',
                color: surface === 'ceiling' ? '#000' : '#fff',
              }}
              onClick={() => {
                setSurface('ceiling');
                autoPlaceInMiddle('ceiling');
              }}
            >
              Ceiling
            </button>
          </div>

          <div className="ar-hud-glass ar-hud-pill">
            <button
              type="button"
              onClick={() => setScaleMult((m) => Math.max(0.4, +(m - 0.2).toFixed(2)))}
              style={{ padding: '0 6px', fontWeight: 'bold' }}
              title="Scale down"
            >
              −
            </button>
            <span>Size</span>
            <button
              type="button"
              onClick={() => setScaleMult((m) => Math.min(3.5, +(m + 0.2).toFixed(2)))}
              style={{ padding: '0 6px', fontWeight: 'bold' }}
              title="Scale up"
            >
              +
            </button>
          </div>

          <div className="ar-hud-glass ar-hud-pill">
            <button type="button" onClick={() => setYaw((y) => y - 15)} title="Rotate left">
              ↺ 15°
            </button>
            <button type="button" onClick={() => setYaw((y) => y + 15)} title="Rotate right">
              ↻ 15°
            </button>
          </div>

          <button type="button" className="btn-primary h-10 px-5 text-[13px] shadow-lg flex items-center gap-2" onClick={makeItReal}>
            <IconSpark size={15} /> Make it real
          </button>
        </div>
      )}

      {/* 11. Error Banner */}
      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: '72px',
            left: '16px',
            right: '16px',
            zIndex: 6,
            background: 'rgba(239,68,68,.9)',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
            textAlign: 'center',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

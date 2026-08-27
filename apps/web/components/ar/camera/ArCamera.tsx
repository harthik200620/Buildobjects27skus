'use client';

import {
  type Anchor,
  anchorFromPixel,
  areaPrompt,
  autoFitScale,
  type CompositeResult,
  cameraPosition,
  cameraRotationFromQuat,
  DEFAULT_CAMERA_HEIGHT_M,
  defaultDropPoint,
  dropPointFor,
  hasOpenArea,
  intrinsicsFor,
  type Mat3,
  matchSurface,
  type PlacementRule,
  type ProductDims,
  pitchFromQuat,
  productNoun,
  type Quat,
  type SceneAnalysis,
  SURFACE_LABEL,
  SURFACE_SWITCH_CONFIDENCE,
  type Surface,
  type SurfaceMatch,
  surfaceDistanceM,
  surfacePrompt,
  type Vec3,
} from '@buildobjects/ar-engine';
import React from 'react';
import {
  IconCamera,
  IconClose,
  IconDownload,
  IconFlipCamera,
  IconMove,
  IconRefresh,
  IconReticle,
  IconRotateLeft,
  IconRotateRight,
  IconRuler,
  IconSeeking,
  IconShare,
  IconSpark,
  IconTarget,
  IconVideo,
} from '@/components/icons';
import { bestRegionScore, dataUrlToCanvas, download, productPixels } from '../photo';
import { AnalysisScheduler, captureAnalysisFrame } from './analysisScheduler';
import { buildCameraComposite } from './compositeFromCamera';
import { type CoverMap, coverMap, stageToVideo } from './coverMap';
import { createLocalVision } from './localVision';
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

/**
 * Whether two analyses describe the same thing, for the purpose of re-rendering.
 *
 * The on-device analyser returns a fresh object ~8 times a second. Setting state on every one of
 * them would re-render the whole HUD eight times a second for a room that has not changed, so the
 * surfaces are compared by what the UI actually shows: which surfaces, and to one decimal of
 * confidence.
 */
function sameSurfaces(a: SceneAnalysis | null, b: SceneAnalysis): boolean {
  if (!a || a.surfaces.length !== b.surfaces.length) return false;
  if (a.sceneType !== b.sceneType) return false;
  for (let i = 0; i < a.surfaces.length; i++) {
    if (a.surfaces[i].type !== b.surfaces[i].type) return false;
    if (Math.abs(a.surfaces[i].confidence - b.surfaces[i].confidence) > 0.05) return false;
  }
  return true;
}

/** Assumed camera pitch when the device reports no orientation. See the pose block for why. */
const NO_SENSOR_PITCH_DEG = -10;

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
  /*
   * On-device scene understanding, running in the render loop.
   *
   * This is the primary source of surfaces now, not a fallback. It needs no API key, no network
   * and no budget, and it answers on the next frame instead of several seconds later — which is
   * what makes the product follow the phone rather than lag behind it. Gemini, when a key is
   * present, still runs on its own schedule and refines the answer; when there is no key the
   * feature is unchanged rather than absent.
   */
  const visionRef = React.useRef(createLocalVision());

  /* The mount starts at the rule's own first choice, not at 'wall'. PLACEMENT_RULES lists a
     category's surfaces in preference order — cement is ['floor','ground'], CCTV is
     ['wall','ceiling'] — so this is the only line needed to make every category start right. */
  const [surface, setSurface] = React.useState<Surface>(rule.surfaces[0]);
  /*
   * 1.0 — true size.
   *
   * This was 1.8, so every product in the live view rendered eighty per cent larger than life.
   * The whole claim of the feature is that what you see is the real thing at the real size, and a
   * multiplier applied silently to every SKU broke it for all of them. The +/- control still lets
   * someone enlarge a small item deliberately, and says so when they have.
   */
  const [scaleMult, setScaleMult] = React.useState<number>(1);
  /* True when the current scale is an auto-enlargement rather than the user's choice, so the HUD
     can say so and offer true size back. */
  const [enlarged, setEnlarged] = React.useState(false);
  const [yaw, setYaw] = React.useState<number>(0);
  const [facingMode, setFacingMode] = React.useState<'environment' | 'user'>('environment');
  const [match, setMatch] = React.useState<SurfaceMatch>({ surface: null, detection: null, confidence: 0 });
  /* False until the analysis has answered once. Telling someone their wall is missing before
     anything has looked for it is how a working feature gets reported as broken. */
  const [analysed, setAnalysed] = React.useState(false);
  const [sceneAnalysis, setSceneAnalysis] = React.useState<SceneAnalysis | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  /*
   * WHETHER THERE IS A MODEL TO SHOW YET.
   *
   * The meshes on this catalogue run six to eleven megabytes. On a phone on mobile data that is
   * ten seconds or more of `GLTFLoader.loadAsync` — ten seconds in which the camera was open, the
   * feed was live, and there was no product and nothing at all saying why. Indistinguishable, from
   * the outside, from the feature being broken.
   *
   * A failed load was worse: silent forever, with the same empty feed.
   */
  const [modelState, setModelState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [result, setResult] = React.useState<(CompositeResult & { dataUrl: string; ms: number; fallback?: boolean }) | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Device orientation gyro feed
  const orientationFeed = useOrientation(true);

  /*
   * The sentence over the feed. Everything it says comes from the placement rule, so it is
   * right for all twenty-seven SKUs without a per-category branch: "Point your camera at a wall
   * to place this fire extinguisher", "…at a floor to place this cement bag".
   */
  const noun = React.useMemo(() => productNoun(category), [category]);

  /*
   * Auto-fit, once per configuration.
   *
   * A 60 mm bulb on a wall 2.2 m away projects to about 25 px at true size — honest and
   * impossible to judge. The old answer was a blanket 1.8x on every product, which made a 1.8 m
   * solar module 80 % too big to solve a problem only small items have. This enlarges only what
   * is illegible, only as far as legibility needs, and records that it did so.
   */
  const fitKeyRef = React.useRef('');
  const applyAutoFit = React.useCallback((targetSurface: Surface) => {
    const video = videoRef.current;
    if (!video?.videoHeight) return;
    const K = intrinsicsFor(video.videoWidth, video.videoHeight, 'phone');
    const d = surfaceDistanceM(targetSurface, matchRef.current);
    const key = `${targetSurface}|${d.toFixed(1)}|${dimsRef.current.w_mm}`;
    if (fitKeyRef.current === key) return;
    fitKeyRef.current = key;
    const fit = autoFitScale(dimsRef.current, d, K.fy);
    setScaleMult(fit.scale);
    setEnlarged(fit.enlarged);
  }, []);
  const prompt = React.useMemo(() => surfacePrompt(rule, match, analysed, noun), [rule, match, analysed, noun]);
  const areaOk = React.useMemo(() => hasOpenArea(rule, sceneAnalysis), [rule, sceneAnalysis]);

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

  const vision = visionRef.current;
  React.useEffect(() => () => vision.dispose(), [vision]);

  /* The camera owns the screen while it is open — see .chat-fab in account.css. Cleared on
     unmount so the assistant comes back the moment this view goes away, including on a crash. */
  React.useEffect(() => {
    document.body.dataset.arActive = '1';
    return () => {
      delete document.body.dataset.arActive;
    };
  }, []);

  /* The last on-device answer, for the loop to compare against without re-rendering. */
  const localSceneRef = React.useRef<SceneAnalysis | null>(null);
  const ruleRef = React.useRef(rule);
  ruleRef.current = rule;
  /* Read through a ref inside the render loop and the placement callbacks: the match changes
     every few seconds as the analysis returns, and closing over it would re-create the loop. */
  const matchRef = React.useRef(match);
  matchRef.current = match;

  /*
   * Where the product belongs in the frame, solved from the geometry when it is available.
   *
   * `defaultDropPoint` is a fixed fraction per mount type. That reads correctly at the downward
   * tilt people use for a floor and visibly wrong with the phone held level at a wall, which is
   * exactly how someone points it at a fire extinguisher or a CCTV camera. With the pitch, the
   * camera height and the distance all known, the row a real mounting height projects to is
   * arithmetic — so it is computed, and the fraction is only the fallback.
   */
  const dropPoint = React.useCallback((targetSurface: Surface) => {
    const video = videoRef.current;
    const pose = lastPoseRef.current;
    if (!video?.videoHeight || !pose) return defaultDropPoint(ruleRef.current, targetSurface);
    const K = intrinsicsFor(video.videoWidth, video.videoHeight, 'phone');
    return dropPointFor(ruleRef.current, targetSurface, {
      pitchDeg: pitchFromQuat(pose.q),
      fy: K.fy,
      height: video.videoHeight,
      cameraHeightM: DEFAULT_CAMERA_HEIGHT_M.phone,
      distanceM: surfaceDistanceM(targetSurface, matchRef.current),
    });
  }, []);
  const dimsRef = React.useRef(dims);
  dimsRef.current = dims;
  /* Read by the renderer's creation effect. As a DEPENDENCY it rebuilt the whole scene every time
     the scale changed — see the effect below. */
  const scaleMultRef = React.useRef(scaleMult);
  scaleMultRef.current = scaleMult;

  /* ── 2. Initialize Three.js SceneRenderer (Once on mount / GLB change) ─── */
  React.useEffect(() => {
    let alive = true;
    const canvas = canvasRef.current;
    if (!canvas || !glbUrl) return;

    setModelState('loading');
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
        r.setScale(scaleMultRef.current);
        /* A rebuilt renderer has no anchor. Let the loop place it again rather than leaving an
           empty scene that only a tap can recover. */
        autoPlacedRef.current = false;
        setModelState('ready');
      } catch (e) {
        if (alive) {
          setModelState('failed');
          setError(`3D WebGL renderer failed: ${(e as Error).message}`);
        }
      }
    })();

    return () => {
      alive = false;
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
    /*
     * `scaleMult` IS DELIBERATELY NOT A DEPENDENCY, and this was the bug behind "I open the
     * camera and there is no product".
     *
     * It used to be listed. Auto-fit enlarges a small product to a legible size the moment a
     * surface is found, which calls setScaleMult — which re-ran THIS effect, which disposed the
     * SceneRenderer, reloaded the GLB from the network and built a fresh scene with no anchor in
     * it. Meanwhile `autoPlacedRef` had already been set by the frame that placed the product, so
     * nothing ever placed it again. The result was an empty camera feed that came back to life
     * only if the user happened to tap, because tapping is the one path that re-anchors.
     *
     * A rebuild belongs to the MODEL, not to how big it is drawn: only `glbUrl` and `category`
     * change what is in the scene. Scale is applied by the small effect below, on the renderer
     * that already exists, and the initial value is read through a ref so it cannot creep back
     * into this list.
     */
  }, [glbUrl, category]);

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

        /* Which of THIS product's surfaces is in view. `matchSurface` walks the rule's own
           preference order and treats floor/ground as interchangeable, so a cement bag anchors
           to the ground outdoors and the floor indoors without a second code path. */
        const m = matchSurface(ruleRef.current, analysis);
        setMatch(m);
        setAnalysed(true);
        /*
         * Follow the room, but only on solid evidence.
         *
         * This used to switch on any detection above the reporting threshold, which is how a
         * bulb — whose rule is ceiling or wall — ended up lying flat on a carpet: one marginal
         * frame was enough to move it. A mount change needs a confident reading; below that the
         * rule's own first choice stands.
         */
        if (m.surface && m.confidence >= SURFACE_SWITCH_CONFIDENCE * 100) {
          setSurface((cur) => (cur === m.surface ? cur : (m.surface as Surface)));
        }
      },
      onError: (err) => {
        /* 503 = the vision model is unavailable, not "there is no surface". Refusing to place
           anything because the analyser is down would make the whole view useless offline, so
           the geometry takes over and the prompt stops claiming to know. */
        if (err.status === 503) setAnalysed(true);
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
        wallDistanceM: surfaceDistanceM(targetSurface, matchRef.current),
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
      /* Where the product belongs in frame depends on what it stands on. A fixed y = 0.35 put
         wall items right and dropped every cement bag, tile and total station into mid-air. */
      applyAutoFit(targetSurface);
      const drop = dropPoint(targetSurface);
      placeAtPixel(map.x0 + map.cw * drop.u, map.y0 + map.ch * drop.v, targetSurface);
    },
    [placeAtPixel, surface, dropPoint, applyAutoFit],
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
      /*
       * No orientation sensor — a laptop, or a phone that refused the permission.
       *
       * This used to derive the pitch from `sceneAnalysis.horizonY`, which the on-device analyser
       * derives from the pitch it was given: a loop with no ground truth in it, drifting on its
       * own output. A fixed, stated assumption is worse in principle and far better in practice,
       * because it is at least stable — the product stops sliding around between frames.
       *
       * -10° is a webcam on a laptop lid, tilted slightly down at the person in front of it.
       */
      const safePitch = NO_SENSOR_PITCH_DEG;
      q = { x: Math.sin((safePitch * Math.PI) / 360), y: 0, z: 0, w: Math.cos((safePitch * Math.PI) / 360) };
    }

    const R = cameraRotationFromQuat(q);
    const heightM = DEFAULT_CAMERA_HEIGHT_M.phone;
    const C = cameraPosition(heightM);
    const K = intrinsicsFor(W, H, 'phone');

    lastPoseRef.current = { q, R, C };

    // Update pixel-exact perspective camera in Three.js
    renderer.setCamera(map, K.fovYDeg, q, C);

    // On-device analysis first: it is free, it is instant, and it is what the placement reads.
    if (hasVideo && video) {
      const local = visionRef.current.step(video, q, performance.now());
      if (local) {
        localSceneRef.current = local;
        setSceneAnalysis((prev) => (sameSurfaces(prev, local) ? prev : local));
        const m = matchSurface(ruleRef.current, local);
        setMatch((prev) => (prev.surface === m.surface && prev.confidence === m.confidence ? prev : m));
        setAnalysed(true);
        if (m.surface && m.confidence >= SURFACE_SWITCH_CONFIDENCE * 100) {
          setSurface((cur) => (cur === m.surface ? cur : (m.surface as Surface)));
        }
        if (renderer && local.lighting) renderer.setLighting(local.lighting);
      }
    }

    // Then the model, on its own schedule, where a key exists.
    if (hasVideo) {
      schedulerRef.current?.tick();
    }

    /*
     * AUTO-PLACE ON THE FIRST FRAME THAT CAN ACTUALLY CARRY A PLACEMENT.
     *
     * This is the "I opened the camera and there is no product" bug, and it was one line: the
     * guard was set BEFORE the placement was attempted.
     *
     *     autoPlacedRef.current = true;        // burned here
     *     const initAnchor = anchorFromPixel(…);
     *     if (initAnchor) { … }                // …but this may be null
     *
     * `anchorFromPixel` returns null whenever the ray through the drop point misses the surface
     * plane, and on the very first frame it usually does: the pose has not been established yet,
     * so R is still settling and the plane it derives is not the wall in front of the camera.
     * One null, and the flag was spent for the lifetime of the session. Nothing was ever placed,
     * the product only appeared if the user happened to tap, and the camera looked broken.
     *
     * The guard now records that a placement SUCCEEDED, so the attempt simply repeats on the next
     * frame until the geometry can carry it — which is a few frames, not a few seconds. autoFit
     * moved inside the success branch too: it sets React state, and running it once per frame
     * while waiting would re-render the whole view for as long as the pose took to settle.
     */
    if (!autoPlacedRef.current) {
      const drop = dropPoint(surface);
      const initAnchor = anchorFromPixel({
        K,
        R,
        C,
        u: map.x0 + map.cw * drop.u,
        v: map.y0 + map.ch * drop.v,
        surface,
        yawDeg: yaw,
        wallDistanceM: surfaceDistanceM(surface, matchRef.current),
      });
      if (initAnchor) {
        autoPlacedRef.current = true;
        applyAutoFit(surface);
        anchorRef.current = initAnchor;
        renderer.setAnchor(initAnchor, yaw);
        renderer.setVisible(true);
      }
    } else if (anchorRef.current) {
      // Keep model anchored in world coordinates
      renderer.setAnchor(anchorRef.current, yaw);
    }

    // Check whether the product is currently visible inside the camera view
    if (anchorRef.current && !draggingRef.current && hasVideo) {
      const bounds = renderer.screenBounds();
      const isVisible = bounds !== null && bounds.x + bounds.w > -20 && bounds.x < map.w + 20 && bounds.y + bounds.h > -20 && bounds.y < map.h + 20;

      if (!isVisible) {
        offScreenFramesRef.current += 1;
        // Out of view for > 35 frames (~0.6 s): bring it back to this category's drop point.
        if (offScreenFramesRef.current > 35) {
          offScreenFramesRef.current = 0;
          const drop = dropPoint(surface);
          const reAnchor = anchorFromPixel({
            K,
            R,
            C,
            u: map.x0 + map.cw * drop.u,
            v: map.y0 + map.ch * drop.v,
            surface,
            yawDeg: yaw,
            wallDistanceM: surfaceDistanceM(surface, matchRef.current),
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
    // `dropPoint` is stable (its own deps are all refs), so listing it costs nothing and
    // keeps the loop honest about what it calls.
    /* `sceneAnalysis` is gone from this list: the loop no longer reads it. It used to derive the
       camera pitch from the analysis's horizon — the feedback loop described in the pose block —
       and keeping it as a dependency re-created the whole render callback every time a frame was
       analysed, roughly eight times a second. */
  }, [surface, yaw, dropPoint, applyAutoFit]);

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
    <div className="ar-stage ar-camera" style={{ position: 'relative', width: '100%', height: '100%', minHeight: '540px', background: 'var(--color-canvas)' }}>
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
            background: 'var(--color-ar-panel)',
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
              background: 'var(--color-ar-wash)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              border: '1px solid var(--color-ar-line)',
            }}
          >
            <IconVideo size={30} style={{ color: 'var(--color-brand)' }} />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#fff' }}>Start Live Camera AR</h3>
          <p style={{ fontSize: 14, color: 'var(--color-ink-2)', maxWidth: 380, marginBottom: 24, lineHeight: '20px' }}>
            {camStatus === 'requesting'
              ? 'Opening camera feed and starting 3D tracking…'
              : camStatus === 'denied'
                ? `Camera access is needed to place ${noun} on your ${rule.surfaceLabel} at its real size. Allow it below.`
                : `Turn on your camera and see ${noun} on your ${rule.surfaceLabel}, at its true size, right where it will go.`}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn-primary h-12 px-7 text-sm font-semibold flex items-center gap-2 cursor-pointer shadow-xl rounded-full"
              onClick={() => startCameraStream(facingMode)}
            >
              <IconCamera size={17} /> {camStatus === 'requesting' ? 'Starting…' : 'Turn the camera on'}
            </button>
            <button type="button" className="ar-chip" onClick={onExit}>
              Use photo mode
            </button>
          </div>
        </div>
      )}

      {/*
       * 5 + 6. THE GUIDANCE STACK — one column, not three things pinned near the top.
       *
       * The surface prompt sat at `top: 68px` and the interaction tip at `top: 72px`, four pixels
       * apart, both of them under a title bar whose height depends on how far the product name
       * wraps. On a 430px phone with a name like "Philips Ace Saver 9 W B22 Cool Day Light LED
       * Bulb" all three landed on top of each other, and the sentence telling somebody what to do
       * was the one underneath. Flow beats offsets: a column cannot overlap itself whatever the
       * title does.
       */}
      {!result && (
        <div className="ar-top">
          <div className="ar-topbar">
            <div className="ar-hud-glass ar-hud-pill ar-hud-id">
              {/* Truncated, not wrapped: this pill is positioned, so every extra line it takes
                  pushes into whatever is below it. */}
              <span className="ar-hud-name">{name}</span>
              <span style={{ color: 'var(--color-brand)', flex: 'none' }}>
                · {dims.w_mm}×{dims.h_mm} mm
              </span>
              {/* "auto" is the honest word: at 100 % this is the real thing at its real size, and at
                anything else the reader deserves to know whether they asked for that or the engine
                enlarged a small product to make it legible. */}
              <span style={{ opacity: 0.8, flex: 'none' }}>
                · {Math.round(scaleMult * 100)}%{enlarged ? ' auto' : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
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
                <IconFlipCamera size={13} /> Flip camera
              </button>
              {scaleMult > 1.01 && (
                <button
                  type="button"
                  className="ar-hud-glass ar-hud-pill cursor-pointer"
                  onClick={() => {
                    setEnlarged(false);
                    setScaleMult(1);
                  }}
                  aria-label="Show at true 1:1 size"
                >
                  {/* The long form ("Enlarged 253% — show true size") is four words too many for a
                      pill on a 390px phone; the percentage is already in the identity row above. */}
                  <IconRuler size={13} /> True size
                </button>
              )}
              <button
                type="button"
                className="ar-hud-glass ar-hud-pill cursor-pointer"
                onClick={() => autoPlaceInMiddle(surface)}
                aria-label="Re-centre the product in view"
              >
                <IconRefresh size={13} /> Re-center
              </button>
              <button type="button" className="ar-hud-glass ar-hud-pill cursor-pointer" onClick={onExit} aria-label="Exit AR mode">
                <IconClose size={13} /> Exit
              </button>
            </div>
          </div>
          {/*
           * The model's own state, above the surface prompt, because "we are still fetching the
           * thing you came to look at" outranks "point at a wall" — and because an empty camera
           * with no message is the failure this whole view is judged on.
           */}
          {modelState !== 'ready' && (
            <div className={`ar-surface-prompt${modelState === 'loading' ? ' ar-surface-prompt--seeking' : ''}`}>
              {modelState === 'loading' ? <IconSeeking size={14} /> : <IconTarget size={14} />}
              <span>
                {modelState === 'loading'
                  ? `Loading ${noun} in 3D — this one is a large model.`
                  : `That 3D model could not be loaded — reopen this view to try again, or use photo mode.`}
              </span>
            </div>
          )}
          {camStatus === 'streaming' && modelState === 'ready' && (
            <>
              <div
                className={`ar-surface-prompt${prompt.tone === 'ok' ? ' ar-surface-prompt--ok' : prompt.tone === 'seeking' ? ' ar-surface-prompt--seeking' : ''}`}
              >
                {prompt.tone === 'ok' ? <IconReticle size={14} /> : prompt.tone === 'seeking' ? <IconSeeking size={14} /> : <IconTarget size={14} />}
                <span>{!areaOk && prompt.tone === 'ok' ? areaPrompt(rule) : prompt.text}</span>
                {prompt.tone === 'ok' && match.confidence > 0 && <span style={{ opacity: 0.75 }}>{match.confidence}%</span>}
              </div>
              <div className="ar-hud-glass ar-hud-pill text-[12px] opacity-90">
                <IconMove size={13} />
                <span>Drag to move · rotate below</span>
              </div>
            </>
          )}
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

      {/* 10. Bottom HUD: place, rotate, scale, capture */}
      {!result && (
        <div className="ar-hud" style={{ bottom: '16px', zIndex: 5, flexWrap: 'wrap', gap: 8 }}>
          <div className="ar-hud-glass ar-hud-pill">
            <span>Mount:</span>
            {/* One button per surface this category may sit on, from PLACEMENT_RULES. It was a
                fixed Wall / Ceiling pair, which meant twenty-four of the twenty-seven SKUs could
                only be mounted somewhere they do not belong. */}
            {rule.surfaces.map((sf) => (
              <button
                key={sf}
                type="button"
                className="chip"
                aria-pressed={surface === sf}
                style={{
                  padding: '2px 8px',
                  fontSize: 12,
                  textTransform: 'capitalize',
                  background: surface === sf ? 'var(--color-brand)' : 'transparent',
                  color: surface === sf ? 'var(--color-on-brand)' : 'var(--color-header-ink)',
                }}
                onClick={() => {
                  setSurface(sf);
                  autoPlaceInMiddle(sf);
                }}
              >
                {SURFACE_LABEL[sf] ?? sf}
              </button>
            ))}
          </div>

          <div className="ar-hud-glass ar-hud-pill">
            <button
              type="button"
              onClick={() => {
                setEnlarged(false);
                setScaleMult((m) => Math.max(0.4, +(m - 0.2).toFixed(2)));
              }}
              style={{ padding: '0 6px', fontWeight: 'bold' }}
              title="Scale down"
            >
              −
            </button>
            <span>Size</span>
            <button
              type="button"
              onClick={() => {
                setEnlarged(false);
                setScaleMult((m) => Math.min(6, +(m + 0.2).toFixed(2)));
              }}
              style={{ padding: '0 6px', fontWeight: 'bold' }}
              title="Scale up"
            >
              +
            </button>
          </div>

          <div className="ar-hud-glass ar-hud-pill">
            <button type="button" onClick={() => setYaw((y) => y - 15)} title="Rotate left">
              <IconRotateLeft size={13} /> 15°
            </button>
            <button type="button" onClick={() => setYaw((y) => y + 15)} title="Rotate right">
              <IconRotateRight size={13} /> 15°
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
            background: 'var(--color-ar-danger)',
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

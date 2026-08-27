'use client';

import {
  type Anchor,
  anchorScreenPoint,
  areaPrompt,
  autoFitScale,
  type CompositeResult,
  cameraPosition,
  cameraRotationFromQuat,
  DEFAULT_CAMERA_HEIGHT_M,
  eulerFromCameraRotation,
  framePlacement,
  hasOpenArea,
  intrinsicsFor,
  type Mat3,
  matchSurface,
  type Nudge,
  type PlacementRule,
  type ProductDims,
  placementFromPixel,
  productNoun,
  type Quat,
  type SceneAnalysis,
  SURFACE_LABEL,
  SURFACE_SWITCH_CONFIDENCE,
  type Surface,
  type SurfaceMatch,
  surfaceDistanceM,
  surfacePlane,
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
import { isArDebug, publishDebug } from './debug';
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

/**
 * Which way to point the "it is over here" arrow when a hand-placed product has left the frame.
 *
 * Only used for products the USER placed. Anything the view framed itself is simply re-framed, but
 * a product somebody dragged to a particular spot is not ours to move, so the honest response to
 * losing sight of it is to say where it went.
 */
function nudgeToward(bounds: { x: number; y: number; w: number; h: number } | null, map: { w: number; h: number }): Nudge {
  if (!bounds) return 'up';
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const du = cx < 0 ? -cx : cx > map.w ? cx - map.w : 0;
  const dv = cy < 0 ? -cy : cy > map.h ? cy - map.h : 0;
  if (du > dv && du > 0) return cx < 0 ? 'left' : 'right';
  if (dv > 0) return cy < 0 ? 'up' : 'down';
  return null;
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

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
   * HOW MANY FRAMES THE POSE HAS BEEN WORTH TRUSTING.
   *
   * The framing solver always returns an anchor, so unlike the old code it will happily place on
   * frame one — including the frame before the gyro has reported anything, when R is still the
   * no-sensor fallback. Placing there and then leaving it puts the product wherever the phone was
   * assumed to be pointing rather than where it is. A handful of frames is a few tens of
   * milliseconds and is invisible; being wrong is not.
   */
  const poseFramesRef = React.useRef<number>(0);
  /* Frame counter for the on-screen check, which runs at ~6 Hz rather than 60. */
  /* Timestamp of the last on-screen check; see the render loop. */
  const visCheckRef = React.useRef<number>(0);
  /* What the renderer's holder transform was last set from, so the loop can skip re-setting it. */
  const appliedRef = React.useRef<{ anchor: Anchor | null; yaw: number }>({ anchor: null, yaw: 0 });
  /* Read once: the debug panel is opt-in and its cost per frame should be one boolean. */
  const debugRef = React.useRef(false);
  /* Kept current by the ResizeObserver below; read by the render loop instead of measuring. */
  const stageSizeRef = React.useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  /* Set once the user has tapped or dragged. After that the placement is theirs and nothing
     re-frames it out from under them. */
  const userPlacedRef = React.useRef<boolean>(false);
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
  /*
   * Where the product is, when it is not where you are looking.
   *
   * The old view had no answer for this at all: a product outside the frame was simply absent, and
   * absent is indistinguishable from broken. `framePlacement` reports which way it went, and an
   * arrow beats an empty feed — most of all for the wall and ceiling items, whose mounting height
   * is not ours to move just because the phone happens to be pointed at the floor.
   */
  const [nudge, setNudge] = React.useState<Nudge>(null);
  /* True when the product is bigger than the frame at the only distance its surface allows — a
     1.2 m tile on a floor 1.4 m below a phone pointed straight down. Real, and worth saying. */
  const [oversized, setOversized] = React.useState(false);
  const [result, setResult] = React.useState<(CompositeResult & { dataUrl: string; ms: number; fallback?: boolean }) | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Device orientation gyro feed
  const orientationFeed = useOrientation(true);
  /* Read through a ref inside the render loop. As a dependency it re-created the loop the instant
     the sensor came alive, which cancels and restarts the rAF chain at the worst possible moment. */
  const gyroActiveRef = React.useRef(orientationFeed.active);
  gyroActiveRef.current = orientationFeed.active;

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
  /*
   * Auto-fit, from the distance the product WAS ACTUALLY PLACED AT.
   *
   * It used to be computed from `surfaceDistanceM`, which returns a flat 2.2 m for every
   * horizontal surface no matter where the thing ended up. So a cement bag placed six metres down
   * the floor was judged for legibility as though it were at 2.2 m — 21 px on screen, reported as
   * needing no help at all. The framing solver knows the real distance because it chose it, so
   * that is the number that comes in here.
   */
  const applyAutoFit = React.useCallback((targetSurface: Surface, distanceM: number) => {
    const video = videoRef.current;
    if (!video?.videoHeight) return;
    const K = intrinsicsFor(video.videoWidth, video.videoHeight, 'phone');
    const key = `${targetSurface}|${distanceM.toFixed(1)}|${dimsRef.current.w_mm}`;
    if (fitKeyRef.current === key) return;
    fitKeyRef.current = key;
    const fit = autoFitScale(dimsRef.current, distanceM, K.fy);
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
    debugRef.current = isArDebug();
  }, []);

  React.useEffect(() => {
    document.body.dataset.arActive = '1';
    return () => {
      delete document.body.dataset.arActive;
    };
  }, []);

  /* The stage's size, measured when it changes rather than sixty times a second. See renderFrame. */
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => {
      stageSizeRef.current = { w: el.clientWidth, h: el.clientHeight };
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* The last on-device answer, for the loop to compare against without re-rendering. */
  const localSceneRef = React.useRef<SceneAnalysis | null>(null);
  const ruleRef = React.useRef(rule);
  ruleRef.current = rule;
  /* Read through a ref inside the render loop and the placement callbacks: the match changes
     every few seconds as the analysis returns, and closing over it would re-create the loop. */
  const matchRef = React.useRef(match);
  matchRef.current = match;

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
           empty scene that only a tap can recover — and forget what the OLD renderer had applied,
           so the skip-if-unchanged check below cannot skip the first placement on the new one. */
        autoPlacedRef.current = false;
        appliedRef.current = { anchor: null, yaw: 0 };
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
      /*
       * THE ANALYSER IS GONE. STOP CALLING IT.
       *
       * The scheduler has always raised this and nothing has ever listened, which on a deployment
       * with no vision key — this one — meant it kept firing every 2.5 s until its budget of forty
       * calls ran out. Each of those captures a 768 px frame and JPEG-encodes it ON THE MAIN
       * THREAD, so the first hundred seconds of every AR session carried a periodic hitch straight
       * through the render loop, for forty round trips that could only ever return 503.
       *
       * Nothing is lost by stopping. The on-device analyser in the render loop is the primary
       * source of surfaces and needs no key, no network and no budget; the remote model only ever
       * refined what it had already found.
       */
      onLiveLost: () => {
        schedulerRef.current?.setPaused(true);
        setAnalysed(true);
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
      /*
       * `placementFromPixel`, not `anchorFromPixel`: the ray is the user's, but how far along it
       * the product may sit is bounded. Near the horizon a single pixel of drag is metres of
       * floor, so an unbounded cast threw the product to the far end of the room the moment a
       * drag crossed the horizon line — and then it was gone, because nothing brings back
       * something 25 m away.
       */
      const newAnchor = placementFromPixel({
        K,
        R: pose.R,
        C: pose.C,
        u,
        v,
        surface: targetSurface,
        yawDeg: yaw,
        plane: surfacePlane(targetSurface, pose.R, { wallDistanceM: surfaceDistanceM(targetSurface, matchRef.current) }),
      });

      anchorRef.current = newAnchor;
      renderer.setAnchor(newAnchor, yaw);
      renderer.setVisible(true);
      offScreenFramesRef.current = 0;
      setNudge(null);
    },
    [surface, yaw],
  );

  /* ── 5. Helper: frame the product for the camera as it is pointed right now ── */
  const frameNow = React.useCallback(
    (targetSurface: Surface = surface) => {
      const video = videoRef.current;
      const renderer = rendererRef.current;
      const pose = lastPoseRef.current;
      const map = coverMapRef.current;
      if (!video?.videoHeight || !renderer || !pose || !map) return false;
      const K = intrinsicsFor(video.videoWidth, video.videoHeight, 'phone');
      const measured = matchRef.current.detection?.distanceM;
      const args = {
        K,
        R: pose.R,
        C: pose.C,
        rule: ruleRef.current,
        dims: dimsRef.current,
        surface: targetSurface,
        view: { x0: map.x0, y0: map.y0, cw: map.cw, ch: map.ch },
        measuredDistanceM: typeof measured === 'number' ? measured : null,
        yawDeg: yaw,
      };
      /*
       * TWICE, BECAUSE THE TWO DECISIONS DEPEND ON EACH OTHER.
       *
       * Framing needs to know how big the product will be drawn; auto-fit needs to know how far
       * away it ended up. Running them in one direction only meant the framing judged an 85 mm
       * CCTV camera at true size and the renderer then drew it at 536 %, so a placement measured
       * as comfortably framed rendered off the top of the screen.
       *
       * The second pass is another forty-eight box projections — tens of microseconds, once per
       * placement — and it converges immediately because the scale it feeds back is derived from a
       * distance that barely moves.
       */
      const first = framePlacement({ ...args, scaleMult: scaleMultRef.current });
      const fit = autoFitScale(dimsRef.current, first.distanceM, K.fy);
      const f = framePlacement({ ...args, scaleMult: fit.scale });
      anchorRef.current = f.anchor;
      renderer.setAnchor(f.anchor, yaw);
      renderer.setVisible(true);
      offScreenFramesRef.current = 0;
      applyAutoFit(targetSurface, f.distanceM);
      setNudge((cur) => (cur === f.nudge ? cur : f.nudge));
      setOversized((cur) => (cur === f.oversized ? cur : f.oversized));
      if (debugRef.current) {
        publishDebug({
          fit: {
            ok: f.coverage >= 0.72,
            reason: `${targetSurface} · ${f.method} · ${f.distanceM.toFixed(2)} m · ${(f.coverage * 100).toFixed(0)} % on screen · x${fit.scale}${f.nudge ? ` · nudge ${f.nudge}` : ''}${f.oversized ? ' · oversized' : ''}`,
          },
        });
      }
      return true;
    },
    [surface, yaw, applyAutoFit],
  );

  /* ── 6. Continuous Render & Tracking Loop ───────────────────────────── */
  const renderFrame = React.useCallback(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    const renderer = rendererRef.current;
    if (!stage || !renderer) return;

    /*
     * The stage's size, from a ResizeObserver rather than from a measurement.
     *
     * `getBoundingClientRect` is a forced synchronous layout. Calling it inside requestAnimationFrame
     * makes the browser flush layout on every single frame, for a number that changes when the
     * device is rotated and at no other time. A ResizeObserver reports the same number when it
     * genuinely changes and costs nothing in between.
     */
    const stageW = Math.max(1, stageSizeRef.current.w || stage.clientWidth);
    const stageH = Math.max(1, stageSizeRef.current.h || stage.clientHeight);

    const hasVideo = !!video && video.readyState >= 2 && video.videoWidth > 0;
    const W = hasVideo ? video.videoWidth : 1280;
    const H = hasVideo ? video.videoHeight : 720;

    const map = coverMap(W, H, stageW, stageH);
    coverMapRef.current = map;
    renderer.setSize(stageW, stageH);

    // Compute Camera Pose
    let q: Quat;
    const gyro = orientationFeed.ref.current;
    /*
     * `gyroActiveRef`, NOT `orientationFeed.active` — AND THIS WAS THE BIGGEST BUG IN THE VIEW.
     *
     * `useOrientation` returns a fresh object every render, and this callback is a useCallback that
     * does not depend on it. So the boolean captured here was whatever `active` was on the very
     * first render — false, because no sample had arrived yet — and it stayed false for the life of
     * the session. `ref` is a useRef and therefore stable, so `gyro` filled with real samples the
     * whole time; the condition simply threw them away.
     *
     * The live camera has been running on a CONSTANT ASSUMED PITCH OF -10 DEGREES on every device,
     * with a working gyro sitting right there. Nothing responded to how the phone was held: not the
     * placement, not the horizon, not the surface classification — which reads the pitch to decide
     * what is floor and what is ceiling. "It is not detecting the placement" and "camera angle from
     * the top is not showing properly" are both this.
     *
     * Found by wiring `window.__arDebug`, which reported pitch -10 at every one of five angles the
     * audit harness tilted the phone to.
     */
    if (gyro && gyroActiveRef.current) {
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
     * AUTO-PLACE ONCE THE POSE IS WORTH TRUSTING.
     *
     * Two bugs lived here. The first was that the guard was set BEFORE the placement was attempted,
     * so a single null anchor on the first frame — which is the normal case, while the pose is
     * still settling — spent it for the whole session and nothing was ever placed. The second was
     * the placement itself: a ray through a fixed fraction of the frame, unbounded, which missed
     * the floor plane entirely whenever the phone was level or tilted up.
     *
     * `framePlacement` cannot fail, so the guard is now about the POSE rather than about the
     * geometry: wait a few frames for the orientation feed to report, then frame once. Without a
     * sensor the fallback pitch is constant and there is nothing to wait for.
     */
    if (!autoPlacedRef.current) {
      poseFramesRef.current += 1;
      const settled = gyroActiveRef.current ? poseFramesRef.current >= 4 : poseFramesRef.current >= 2;
      if (settled && frameNow(surface)) autoPlacedRef.current = true;
    } else if (anchorRef.current && (appliedRef.current.anchor !== anchorRef.current || appliedRef.current.yaw !== yaw)) {
      /*
       * The anchor is a WORLD position, so it does not change when the camera moves — only when
       * something moves the product. This used to run every frame regardless: `setAnchor` allocates
       * a Quaternion and a Vector3 in `orientForSurface`, then forces `updateMatrixWorld` down the
       * whole holder. Sixty times a second, to set a transform to the value it already had.
       */
      appliedRef.current = { anchor: anchorRef.current, yaw };
      renderer.setAnchor(anchorRef.current, yaw);
    }

    /*
     * IS IT STILL ON SCREEN?
     *
     * Checked at ~6 Hz rather than every frame. `screenBounds` builds a Box3 over the model and
     * projects eight corners, and doing that sixty times a second on a mid-range phone is real
     * work for a question whose answer cannot change meaningfully between frames.
     *
     * Timed rather than counted, and the difference matters on exactly the devices this is for. A
     * one-in-ten-FRAMES check is 6 Hz at sixty frames a second and 0.7 Hz at seven — so on the slow
     * phone where a product is most likely to be lost, recovering it took the best part of five
     * seconds. On a clock it is half a second everywhere.
     */
    const nowMs = performance.now();
    if (anchorRef.current && !draggingRef.current && hasVideo && nowMs - visCheckRef.current > 160) {
      visCheckRef.current = nowMs;
      const bounds = renderer.screenBounds();
      /*
       * ENOUGH OF IT TO SEE, not merely a pixel of overlap.
       *
       * The old test was "does the bounding box touch the viewport, with 20 px of slack", which is
       * true of a product hanging off the top edge by all but its last few pixels. That leaves a
       * band of camera angles — around 40 degrees down, for anything on a wall — where the product
       * is technically on screen, effectively invisible, and gets no arrow because the view thinks
       * you can see it. Both of the audit's last two failures were in exactly that band.
       */
      const inside = bounds
        ? (Math.max(0, Math.min(bounds.x + bounds.w, map.w) - Math.max(bounds.x, 0)) *
            Math.max(0, Math.min(bounds.y + bounds.h, map.h) - Math.max(bounds.y, 0))) /
          Math.max(1, bounds.w * bounds.h)
        : 0;
      const isVisible = bounds !== null && inside >= 0.15;

      if (!isVisible) {
        offScreenFramesRef.current += 1;
        /*
         * Gone for about half a second. POINT AT IT; DO NOT FETCH IT.
         *
         * Re-framing here was the first attempt and it is wrong, which the audit harness showed
         * plainly: an extinguisher measured at five camera pitches came back pixel-identical at
         * every one of them, because half a second after each tilt the view quietly moved it back
         * to the middle of the screen. A product that follows the camera is not in the room — it is
         * a sticker on the lens, and it undoes the one thing this view is for.
         *
         * So the anchor stays where it is and the nudge says which way it went, with a button to
         * bring it back for anyone who would rather not go looking. Explicit beats magic, and the
         * arrow is a better answer to "where did it go" than teleportation is.
         */
        if (offScreenFramesRef.current > 3) {
          offScreenFramesRef.current = 3;
          setNudge(nudgeToward(renderer.screenBounds(), map));
        }
      } else {
        offScreenFramesRef.current = 0;
        setNudge((cur) => (cur === null ? cur : null));
      }
    }

    /*
     * THE INSTRUMENT PANEL.
     *
     * `debug.ts` describes itself as "the live-camera tier's instrument panel for device testing
     * and the e2e suite" and nothing has ever written to it, so the panel has always been empty and
     * every question about what the view was actually doing had to be answered by squinting at a
     * screenshot. Three SKUs were invisible at every camera angle in the audit and there was no way
     * to ask why.
     *
     * Off unless asked for — `?debug=1`, `localStorage['ar.debug']`, or the build flag — so it
     * costs a single boolean check per frame in normal use.
     */
    if (debugRef.current) {
      const e = eulerFromCameraRotation(R);
      const a = anchorRef.current;
      const px = a ? anchorScreenPoint(a, K, R, C) : null;
      publishDebug({
        modelVisible: !!a && renderer.screenBounds() !== null,
        pose: { yawDeg: e.yawDeg, pitchDeg: e.pitchDeg, rollDeg: e.rollDeg, heightM, source: gyroActiveRef.current ? 'sensors' : 'static' },
        video: { W, H },
        anchor: a ? { kind: a.kind, surface: a.surface, u: px?.u ?? Number.NaN, v: px?.v ?? Number.NaN } : null,
        scale: `${Math.round(scaleMultRef.current * 100)}%`,
        webgl: true,
        scene: localSceneRef.current
          ? {
              type: localSceneRef.current.sceneType,
              confidence: localSceneRef.current.sceneConfidence,
              provider: localSceneRef.current.provider,
              surfaces: localSceneRef.current.surfaces.map((x) => `${x.type}:${Math.round(x.confidence * 100)}`),
            }
          : null,
      });
    }

    // Always render 3D WebGL frame
    renderer.render();
    /* `sceneAnalysis` is deliberately absent: the loop no longer reads it. It used to derive the
       camera pitch from the analysis's horizon — the feedback loop described in the pose block —
       and keeping it as a dependency re-created the whole render callback every time a frame was
       analysed, roughly eight times a second. */
  }, [surface, yaw, frameNow]);

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
    /* From here the placement belongs to the user; nothing re-frames it out from under them. */
    userPlacedRef.current = true;
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
                onClick={() => frameNow(surface)}
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
              {/*
               * WHERE IT IS, WHEN IT IS NOT HERE.
               *
               * A wall product has a mounting height and a ceiling product has a ceiling; neither
               * is ours to move because the phone happens to be pointed at the floor. Before this
               * the view rendered nothing and said nothing in that case, which is exactly what
               * "I cannot see the product" looks like from the outside. Now it points.
               *
               * `oversized` is the other half: at true scale a 1.2 m tile on the floor 1.4 m below
               * a phone held straight down is larger than the frame, and no placement fixes that.
               * Tilting up is the honest instruction, so that is what it says.
               */}
              {nudge && (
                <button type="button" className="ar-nudge" onClick={() => frameNow(surface)}>
                  <span className={`ar-nudge-arrow ar-nudge-arrow--${nudge}`} aria-hidden="true" />
                  <span>
                    {oversized
                      ? `Too close to fit — tilt ${nudge} for the whole ${noun.replace('this ', '')}`
                      : `${cap(noun.replace('this ', ''))} is ${nudge === 'up' ? 'above' : nudge === 'down' ? 'below' : `to the ${nudge}`} — tilt to see it`}
                  </span>
                  <span className="ar-nudge-cta">Bring it here</span>
                </button>
              )}
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
                  frameNow(sf);
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

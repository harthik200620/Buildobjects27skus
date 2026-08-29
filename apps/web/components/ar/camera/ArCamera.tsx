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
  nudgeFromBounds,
  type PlacementRule,
  type ProductDims,
  placementFromPixel,
  productNoun,
  type Quat,
  type SceneAnalysis,
  SURFACE_SWITCH_CONFIDENCE,
  type Surface,
  type SurfaceMatch,
  surfaceDistanceM,
  surfacePlane,
  surfacePrompt,
  type Vec3,
} from '@buildobjects/ar-engine';
import React from 'react';
import { IconCamera, IconDownload, IconRefresh, IconShare, IconVideo } from '@/components/icons';
import { requestComposite, shareImage } from '../composite';
import { canvasToB64, download, productPixels } from '../photo';
import ArHud from './ArHud';
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
  /** "UltraTech Cement UltraTech Portland Pozzolana Cement (PPC)" — brand and name together. */
  name: string;
  brand: string;
  /** What it costs, so the sheet can say so. A room view of a product that never mentions its
      price is a demo, not a storefront. */
  price: number | null;
  unit: string;
  thumbnail: string | null;
  pdpHref: string | null;
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
/** Distance and angle between two active pointers — the span a pinch and a twist are measured from. */
function spanOf(pts: { x: number; y: number }[]): { dist: number; angle: number } {
  const [p0, p1] = pts;
  return { dist: Math.hypot(p1.x - p0.x, p1.y - p0.y), angle: (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI };
}

/**
 * How much of the stage the chrome covers, in CSS pixels.
 *
 * The sheet and the top bar are not empty space: a product framed into the full stage lands under
 * them. These are the heights those bands actually occupy at their most compact, measured rather
 * than guessed, and they are what the framing solver is given instead of the whole frame.
 */
const CHROME_BOTTOM_PX = 210;
const CHROME_TOP_PX = 60;

/**
 * The part of the picture a person can actually see, in both units at once — read by the framing
 * solver in video pixels and by the render loop's on-screen check in stage pixels, because the two
 * must agree about what "visible" means.
 *
 * Chrome heights are MEASURED; the constants are only the fallback for the frames before the
 * observer reports. Inset the TOP as well as the height: shrinking the height alone leaves the
 * rect pinned to the top of the frame, which is above the horizon for anything on a floor.
 */
function visibleBand(
  map: CoverMap,
  chrome: { top: number; bottom: number },
): { view: { x0: number; y0: number; cw: number; ch: number }; stageTop: number; stageBottom: number } {
  const k = Math.max(0.01, map.k);
  const top = Math.min(chrome.top / k, map.ch * 0.25);
  const bottom = Math.min(chrome.bottom / k, map.ch * 0.45);
  return {
    view: { x0: map.x0, y0: map.y0 + top, cw: map.cw, ch: Math.max(map.ch * 0.3, map.ch - top - bottom) },
    stageTop: top * k,
    stageBottom: map.h - bottom * k,
  };
}

/** Assumed camera pitch when the device reports no orientation. See the pose block for why. */
const NO_SENSOR_PITCH_DEG = -10;

export default function ArCamera({ glbUrl, rule, dims, category, name, brand, price, unit, thumbnail, pdpHref, onExit }: ArCameraProps) {
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
  /* How much of the stage the top bar and the sheet actually cover, measured — see `visibleBand`. */
  const chromeRef = React.useRef<{ top: number; bottom: number }>({ top: CHROME_TOP_PX, bottom: CHROME_BOTTOM_PX });
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
   * WHETHER THERE IS A MODEL TO SHOW YET. The meshes run six to eleven megabytes, which on mobile
   * data is ten seconds or more of `GLTFLoader.loadAsync` — ten seconds of live camera feed with
   * no product and nothing saying why, which from the outside is the feature being broken. A
   * failed load was worse: silent forever, with the same empty feed.
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
  /* True once a placement has landed. The coaching layer stands down at that point: an
     instruction that stays on screen after it has been followed is just something to read past. */
  const [placed, setPlaced] = React.useState(false);
  /*
   * The live readout while two fingers are on the glass.
   *
   * Sizing used to be a pair of +/- buttons stepping 0.2 and turning was two buttons stepping 15
   * degrees, which is a spreadsheet, not a camera. Pinching and twisting is what hands do here —
   * and a gesture with no number attached is a guess, so the number appears under the fingers and
   * leaves with them.
   */
  const [gesture, setGesture] = React.useState<{ kind: 'scale' | 'rotate'; value: string } | null>(null);
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
      /* The chrome, from the chrome. A sheet that is collapsed, or taller because a product name
         wrapped, changes where the product can be seen — so the number comes from the element. */
      const stage = el.parentElement;
      const sheet = stage?.querySelector('.arv-sheet') as HTMLElement | null;
      const bar = stage?.querySelector('.arv-top') as HTMLElement | null;
      const h = el.clientHeight || 1;
      chromeRef.current = {
        top: bar ? Math.min(bar.offsetHeight, h * 0.3) : CHROME_TOP_PX,
        /* `getBoundingClientRect` rather than offsetHeight: the sheet is translated when collapsed,
           and its visible height is what matters, not how tall it would be if it were open. */
        bottom: sheet ? Math.min(Math.max(0, h - (sheet.getBoundingClientRect().top - el.getBoundingClientRect().top)), h * 0.55) : CHROME_BOTTOM_PX,
      };
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const stage = el.parentElement;
    const sheet = stage?.querySelector('.arv-sheet');
    if (sheet) ro.observe(sheet);
    /* The sheet slides rather than resizes when it is collapsed, so its transition is the signal. */
    const onEnd = () => read();
    sheet?.addEventListener('transitionend', onEnd);
    return () => {
      ro.disconnect();
      sheet?.removeEventListener('transitionend', onEnd);
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

  const dimsRef = React.useRef(dims);
  dimsRef.current = dims;
  /* Read by the renderer's creation effect. As a DEPENDENCY it rebuilt the whole scene every time
     the scale changed — see the effect below. */
  const scaleMultRef = React.useRef(scaleMult);
  scaleMultRef.current = scaleMult;
  /* Read when a pinch begins, so a two-finger twist is relative to where the product already was. */
  const yawRef = React.useRef(yaw);
  yawRef.current = yaw;

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
        setPlaced(false);
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
     * `scaleMult` is deliberately NOT a dependency. Listing it was the bug behind "I open the
     * camera and there is no product": auto-fit calls setScaleMult the moment a surface is found,
     * which re-ran this effect, disposed the renderer and rebuilt an empty scene — while
     * `autoPlacedRef` was already set, so nothing placed the product again.
     *
     * A rebuild belongs to the MODEL, not to how big it is drawn. Scale is applied by the small
     * effect below, and the initial value is read through a ref so it cannot creep back in here.
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
        if (rendererRef.current && analysis.lighting) rendererRef.current.setLighting(analysis.lighting);

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
        if (m.surface && m.confidence >= SURFACE_SWITCH_CONFIDENCE * 100) setSurface((cur) => (cur === m.surface ? cur : (m.surface as Surface)));
      },
      onError: (err) => {
        /* 503 = the vision model is unavailable, not "there is no surface". Refusing to place
           anything because the analyser is down would make the whole view useless offline, so
           the geometry takes over and the prompt stops claiming to know. */
        if (err.status === 503) setAnalysed(true);
      },
      /*
       * THE ANALYSER IS GONE. STOP CALLING IT. The scheduler has always raised this and nothing
       * listened, so on a deployment with no vision key — this one — it fired every 2.5 s until
       * its budget of forty ran out. Each of those JPEG-encodes a 768 px frame ON THE MAIN THREAD,
       * putting a periodic hitch through the render loop for forty round trips that could only
       * return 503. Nothing is lost by stopping: the on-device analyser in the render loop is the
       * primary source of surfaces and the remote model only ever refined what it had found.
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
      const band = visibleBand(map, chromeRef.current);
      const args = {
        K,
        R: pose.R,
        C: pose.C,
        rule: ruleRef.current,
        dims: dimsRef.current,
        surface: targetSurface,
        /* The band between the chrome — see `visibleBand`. */
        view: band.view,
        measuredDistanceM: typeof measured === 'number' ? measured : null,
        yawDeg: yaw,
      };
      /*
       * TWICE, BECAUSE THE TWO DECISIONS DEPEND ON EACH OTHER. Framing needs to know how big the
       * product will be drawn; auto-fit needs to know how far away it ended up. One direction only
       * meant the framing judged an 85 mm CCTV camera at true size and the renderer then drew it
       * at 536 %, so a placement measured as comfortably framed rendered off the top of the
       * screen. The second pass is forty-eight box projections once per placement, and it
       * converges immediately because the scale it feeds back comes from a distance that barely
       * moves.
       */
      const first = framePlacement({ ...args, scaleMult: scaleMultRef.current });
      const fit = autoFitScale(dimsRef.current, first.distanceM, K.fy);
      const f = framePlacement({ ...args, scaleMult: fit.scale });
      anchorRef.current = f.anchor;
      renderer.setAnchor(f.anchor, yaw);
      renderer.setVisible(true);
      offScreenFramesRef.current = 0;
      applyAutoFit(targetSurface, f.distanceM);
      setPlaced(true);
      setNudge((cur) => (cur === f.nudge ? cur : f.nudge));
      setOversized((cur) => (cur === f.oversized ? cur : f.oversized));
      if (debugRef.current) {
        publishDebug({
          fit: {
            ok: f.coverage >= 0.72,
            reason: `${targetSurface} · ${f.method} · ${f.distanceM.toFixed(2)} m · ${(f.coverage * 100).toFixed(0)} % on screen · x${fit.scale}${f.nudge ? ` · nudge ${f.nudge}` : ''}${f.oversized ? ' · oversized' : ''}`,
          },
          /* What the solver was composing into, so a disagreement between "on screen" and what is
             actually visible can be attributed rather than guessed at. */
          band: {
            y0: Math.round(band.view.y0),
            y1: Math.round(band.view.y0 + band.view.ch),
            top: Math.round(chromeRef.current.top),
            bottom: Math.round(chromeRef.current.bottom),
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
     * `gyroActiveRef`, NOT `orientationFeed.active`.
     *
     * `useOrientation` returns a fresh object every render and this useCallback does not depend on
     * it, so the boolean captured here froze at its first-render value — false, before any sample
     * had arrived — for the life of the session. The ref is stable and filled with real samples the
     * whole time; the condition threw them away, and the view ran on a constant assumed pitch of
     * -10 degrees on every device with a working gyro sitting right there.
     */
    if (gyro && gyroActiveRef.current) {
      q = gyro.q;
    } else {
      /*
       * No orientation sensor — a laptop, or a phone that refused the permission. Deriving the
       * pitch from `sceneAnalysis.horizonY` is the trap: the analyser derives that FROM the pitch
       * it was given, so it is a loop with no ground truth, drifting on its own output. A fixed
       * stated assumption is worse in principle and far better in practice because it is stable.
       * -10° is a webcam on a laptop lid, tilted slightly down at whoever is in front of it.
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
        if (m.surface && m.confidence >= SURFACE_SWITCH_CONFIDENCE * 100) setSurface((cur) => (cur === m.surface ? cur : (m.surface as Surface)));
        if (renderer && local.lighting) renderer.setLighting(local.lighting);
      }
    }

    // Then the model, on its own schedule, where a key exists.
    if (hasVideo) schedulerRef.current?.tick();

    /*
     * AUTO-PLACE ONCE THE POSE IS WORTH TRUSTING, and the guard is about the POSE rather than the
     * geometry — `framePlacement` cannot fail, so there is nothing geometric left to guard. Set
     * before the placement was attempted, it was spent by the single null anchor of the first
     * frame, which is the normal case while the pose settles, and nothing was ever placed. Wait a
     * few frames for the orientation feed, then frame once; with no sensor the fallback pitch is
     * constant and there is nothing to wait for.
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
     * IS IT STILL ON SCREEN? At ~6 Hz, not every frame: `screenBounds` projects eight corners of a
     * Box3, which is real work sixty times a second on a mid-range phone for a question whose
     * answer cannot change meaningfully between frames.
     *
     * TIMED RATHER THAN COUNTED, and the difference lands on exactly the devices this is for. One
     * in ten FRAMES is 6 Hz at sixty fps and 0.7 Hz at seven — so on the slow phone where a product
     * is most likely to be lost, recovering it took five seconds. On a clock it is half a second
     * everywhere.
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
      /* The same band the framing solver composes into — see `visibleBand`. They have to agree, or
         a product tucked neatly behind the sheet is "on screen" to one and "framed" by the other,
         and the view shows a coaching line and an arrow about the same product in the same breath. */
      const band = visibleBand(map, chromeRef.current);
      const inside = bounds
        ? (Math.max(0, Math.min(bounds.x + bounds.w, map.w) - Math.max(bounds.x, 0)) *
            Math.max(0, Math.min(bounds.y + bounds.h, band.stageBottom) - Math.max(bounds.y, band.stageTop))) /
          Math.max(1, bounds.w * bounds.h)
        : 0;
      const isVisible = bounds !== null && inside >= 0.15;

      if (!isVisible) {
        offScreenFramesRef.current += 1;
        /*
         * Gone for about half a second. POINT AT IT; DO NOT FETCH IT.
         *
         * Re-framing here is the wrong answer and the audit showed it plainly: an extinguisher
         * measured at five camera pitches came back pixel-identical at every one, because half a
         * second after each tilt the view had quietly moved it back to the middle. A product that
         * follows the camera is not in the room, it is a sticker on the lens. So the anchor stays
         * and the nudge says which way it went, with a button for anyone who would rather not go
         * looking — an arrow is a better answer to "where did it go" than teleportation.
         */
        if (offScreenFramesRef.current > 3) {
          offScreenFramesRef.current = 3;
          /* `bounds`, not a second `screenBounds()` call: the same measurement the decision was
             made from, and one fewer traversal of the scene graph per check. */
          setNudge(nudgeFromBounds(bounds, { w: map.w, top: band.stageTop, bottom: band.stageBottom }));
        }
      } else {
        offScreenFramesRef.current = 0;
        setNudge((cur) => (cur === null ? cur : null));
      }
    }

    /*
     * THE INSTRUMENT PANEL. `debug.ts` calls itself "the live-camera tier's instrument panel" and
     * nothing wrote to it, so it was empty and every question about what the view was doing had to
     * be answered by squinting at a screenshot — three SKUs were invisible at every camera angle
     * in the audit with no way to ask why. Off unless asked for (`?debug=1`, `localStorage
     * ['ar.debug']`, or the build flag), so it costs one boolean check per frame in normal use.
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

  /*
   * ── 7. HANDS ──────────────────────────────────────────────────────────────
   *
   * One finger moves it; two size and turn it. Four buttons stepping 0.2 and 15 degrees a tap is
   * a spreadsheet's interaction model applied to a camera.
   *
   * EVERY POINTER IS TRACKED, BECAUSE THE NUMBER OF THEM IS THE MODE. Dropping from two fingers to
   * one must re-baseline or the product leaps to wherever the remaining finger is; picking up a
   * second mid-drag must stop the drag or the product chases the midpoint. Both fall out of
   * rebuilding the baseline whenever the count changes.
   */
  const pointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = React.useRef<{ dist: number; angle: number; scale: number; yaw: number } | null>(null);
  const gestureTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    },
    [],
  );

  const showGesture = React.useCallback((kind: 'scale' | 'rotate', value: string) => {
    setGesture({ kind, value });
    if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = setTimeout(() => setGesture(null), 900);
  }, []);

  const stagePoint = (e: React.PointerEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const beginPinch = React.useCallback(() => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return;
    const { dist, angle } = spanOf(pts.slice(0, 2));
    pinchRef.current = { dist, angle, scale: scaleMultRef.current, yaw: yawRef.current };
    draggingRef.current = false;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const map = coverMapRef.current;
    if (!stageRef.current || !map) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, stagePoint(e));

    if (pointersRef.current.size >= 2) {
      beginPinch();
      return;
    }
    const p = stagePoint(e);
    const vid = stageToVideo(map, p.x, p.y);
    draggingRef.current = true;
    /* From here the placement belongs to the user; nothing re-frames it out from under them. */
    userPlacedRef.current = true;
    placeAtPixel(vid.u, vid.v);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, stagePoint(e));
    const map = coverMapRef.current;
    if (!map) return;

    if (pointersRef.current.size >= 2) {
      const base = pinchRef.current;
      if (!base) {
        beginPinch();
        return;
      }
      const { dist, angle } = spanOf([...pointersRef.current.values()].slice(0, 2));
      if (base.dist > 8) {
        const next = Math.max(0.4, Math.min(6, base.scale * (dist / base.dist)));
        setEnlarged(false);
        setScaleMult(next);
        showGesture('scale', `${Math.round(next * 100)}%`);
      }
      /* Shortest way round, or crossing 180 degrees spins the product a full turn in the wrong
         direction under a thumb that barely moved. */
      let d = angle - base.angle;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) > 3) {
        const y = base.yaw + d;
        setYaw(y);
        showGesture('rotate', `${Math.round(((y % 360) + 360) % 360)}°`);
      }
      return;
    }

    if (!draggingRef.current) return;
    const p = stagePoint(e);
    const vid = stageToVideo(map, p.x, p.y);
    placeAtPixel(vid.u, vid.v);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    /* Re-baseline rather than continue: whichever finger is left is somewhere else entirely. */
    draggingRef.current = false;
  };

  /*
   * ── 7b. TAKE THE PICTURE ──────────────────────────────────────────────────
   *
   * A camera with no shutter is a strange thing. "Make it real" sends the frame to an image model,
   * takes seconds and costs money; most of the time somebody just wants the photo — the bag on
   * their floor, to send to whoever is paying for it. The feed and the WebGL layer are composited
   * at the VIDEO's resolution rather than the stage's, so what is saved is the full-quality frame
   * and not a screenshot of a phone screen.
   */
  const capture = React.useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const map = coverMapRef.current;
    if (!video || !canvas || !map || !video.videoWidth) return;
    try {
      const out = document.createElement('canvas');
      out.width = Math.round(map.cw);
      out.height = Math.round(map.ch);
      const ctx = out.getContext('2d');
      if (!ctx) return;
      /* The visible crop of the frame, not the whole frame: what was on screen is what gets saved. */
      ctx.drawImage(video, map.x0, map.y0, map.cw, map.ch, 0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
      download(out.toDataURL('image/jpeg', 0.92), `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-in-my-room.jpg`);
    } catch {
      /* A tainted canvas — nothing to save, and nothing worth interrupting the view for. */
    }
  }, [name]);

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

      const overlayB64 = canvasToB64(comp.overlay, 'image/jpeg', 0.92);

      const body = {
        photo: canvasToB64(comp.photo, 'image/jpeg', 0.9),
        overlay: overlayB64,
        mask: canvasToB64(comp.mask, 'image/png'),
        productReference: canvasToB64(comp.modelPass, 'image/png'),
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

      const best = await requestComposite({
        body,
        reference: productPixels(comp.modelPass),
        rect: comp.rect,
        photoW: comp.photo.width,
        photoH: comp.photo.height,
        overlay: overlayB64,
        fallbackNote: 'Placed at true 1:1 scale using the 3D model with wall perspective and contact shadow.',
      });

      setResult({ ...best, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const shareResult = () => result && shareImage(result.dataUrl, `${name.toLowerCase().replace(/\s+/g, '-')}-in-my-room.jpg`, `${name} in my room`);

  return (
    <div className="ar-stage ar-camera">
      {/* 1. Live Camera Video Feed */}
      <video ref={videoRef} playsInline muted autoPlay className="ar-camera-video ar-fill" data-live={camStatus === 'streaming'} />

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

      {/*
       * 4. THE DOOR. Shown until there is a feed, and it is the whole view while it is up.
       *
       * It used to be fifty lines of inline style — its own panel colour, its own radius, its own
       * type sizes, a hand-rolled 68 px circle — sitting at z-index 8 while the HUD sheet below
       * drew at a higher one. So a page that had never been given camera permission showed this
       * card with the room-view's product sheet, surface segment, size and turn sliders and
       * shutter button laid over the top of it: half a dozen controls for a scene that does not
       * exist yet, one of them covering the button that would create it.
       */}
      {camStatus !== 'streaming' && !result && (
        <div className="arv-door">
          <span className="arv-door-mark" aria-hidden="true">
            <IconVideo size={30} />
          </span>
          {/* h2: this is the room view's own heading and the page's h1 is directly above it, so h3
              skipped a level in the outline. The class carries the size. */}
          <h2 className="arv-door-title">See it in your room</h2>
          <p className="arv-door-copy">
            {camStatus === 'requesting'
              ? 'Opening the camera and starting to track the room…'
              : camStatus === 'denied'
                ? `Camera access is needed to put ${noun} on your ${rule.surfaceLabel} at its real size. Allow it below.`
                : `Turn the camera on and see ${noun} on your ${rule.surfaceLabel}, at its true size, right where it will go.`}
          </p>
          <div className="arv-door-actions">
            <button type="button" className="arv-action arv-action--buy" onClick={() => startCameraStream(facingMode)}>
              <IconCamera size={17} /> {camStatus === 'requesting' ? 'Starting…' : 'Turn the camera on'}
            </button>
            <button type="button" className="arv-action" onClick={onExit}>
              Use a photo instead
            </button>
          </div>
        </div>
      )}

      {/*
       * 5 + 6 + 10. THE HUD.
       *
       * One component, three bands, replacing eleven separately-positioned floating elements that
       * each carried their own inline styles and all competed at the same visual weight. See
       * ArHud.tsx for why the shape is what it is.
       */}
      {/* Gated on a live feed, not merely on "no photo yet". Every control in the sheet acts on
          something in the camera's view; before there is a view they are decoration over the door
          above. */}
      {!result && camStatus === 'streaming' && (
        <ArHud
          name={name}
          brand={brand}
          category={category}
          dims={dims}
          rule={rule}
          price={price}
          unit={unit}
          thumbnail={thumbnail}
          pdpHref={pdpHref}
          camStatus={camStatus}
          modelState={modelState}
          prompt={!areaOk && prompt.tone === 'ok' ? { tone: 'seek', text: areaPrompt(rule) } : prompt}
          surface={surface}
          scaleMult={scaleMult}
          enlarged={enlarged}
          yaw={yaw}
          nudge={nudge}
          oversized={oversized}
          noun={noun}
          gesture={gesture}
          /* Coaching stands down once something has been placed and is on screen. */
          settled={placed && nudge === null}
          onExit={onExit}
          onFlip={() => {
            const next = facingMode === 'environment' ? 'user' : 'environment';
            setFacingMode(next);
            startCameraStream(next);
          }}
          onSurface={(sf) => {
            setSurface(sf);
            frameNow(sf);
          }}
          onScale={(m) => {
            setEnlarged(false);
            setScaleMult(m);
          }}
          onTrueSize={() => {
            setEnlarged(false);
            setScaleMult(1);
          }}
          onYaw={setYaw}
          onRecentre={() => frameNow(surface)}
          onCapture={capture}
          onMakeReal={makeItReal}
        />
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
        <div className="ar-fill ar-center ar-result">
          <img src={result.dataUrl} alt={name} />
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

      {/* 11. Error Banner */}
      {error && <div className="ar-error">{error}</div>}
    </div>
  );
}

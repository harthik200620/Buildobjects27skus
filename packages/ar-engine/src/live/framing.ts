import type { PlacementRule, ProductDims, Surface } from '../types';
import { type Anchor, DEFAULT_CEILING_M, DEFAULT_TABLE_M, isVerticalSurface } from './anchor';
import type { Intrinsics } from './camera-math';
import { intersectPlane, type Pixel, type PixelIntrinsics, projectToPixel, rayFromPixel, wallNormalFacing } from './plane';
import { add, cameraAxes, type Mat3, normalize, scale, UP, type Vec3, v3 } from './pose';

/**
 * PUT THE PRODUCT WHERE IT CAN ACTUALLY BE SEEN.
 *
 * Everything else in this folder answers "given a pixel, where is that in the world". This
 * answers the question the live view actually has, which is the other way round: given a room, a
 * camera pointed somewhere in it, and a product that belongs on a named surface, WHERE DO WE PUT
 * IT so that the person holding the phone sees it.
 *
 * The view used to answer that with a constant. `defaultDropPoint` returned a fixed fraction of
 * the frame per mount type — v = 0.68 for anything on the floor, 0.20 for a ceiling — and the
 * anchor was wherever the ray through that fraction happened to land. A sweep of the placement
 * across camera pitch (test/framing.test.ts) shows what that produces on a 720 x 1280 phone frame:
 *
 *   - pitch +20 and above, ANY floor product   no anchor at all. The ray through v = 0.68 is still
 *                                              above the horizon, misses the floor plane entirely,
 *                                              and nothing is ever placed. The camera opens, the
 *                                              feed runs, there is no product, and there never
 *                                              will be one.
 *   - pitch +10, cement bag                    lands 25.4 m away and projects to 21 x 31 px.
 *   - pitch -20, bulb                          lands 66.7 m away: 2 x 4 px.
 *   - pitch -45, solar panel                   the ray is nearly parallel to the roof plane, so it
 *                                              "hits" at 176 000 px across. 0 % on screen.
 *   - pitch -75, tile                          25 % on screen. Bathtub 26 %, glass 1 %.
 *
 * The last band is the reported one — "camera angle from top it is not showing properly" — and it
 * is the same defect as the first: a fixed screen fraction is not a placement. The distance to the
 * surface through a fixed pixel varies by four orders of magnitude across the pitches at which a
 * person actually holds a phone, and nothing clamped it.
 *
 * -- WHAT THIS DOES INSTEAD ------------------------------------------------------------------
 * Every placement has ONE free parameter, and it is not a screen fraction:
 *
 *   - on a horizontal surface (floor, ground, roof, table, ceiling) how far along the surface,
 *     away from the camera, the product sits. Sliding a cement bag further down the floor is a
 *     completely honest placement; nothing about the product changes.
 *   - on a vertical surface (wall, window) how far away the wall is. The HEIGHT is not free: an
 *     extinguisher lives at a metre whether or not that is convenient to look at.
 *
 * So: sweep the free parameter, project the product's own box at each candidate, and take the one
 * that puts the most of the product on screen nearest the row its mount belongs at. When no
 * candidate in the physical band can frame it — a wall product with the phone pointed at the floor
 * — the product still goes at its honest position and `nudge` says which way to tilt, so the view
 * can point at it instead of silently rendering nothing.
 *
 * A sweep rather than a closed form, because the closed forms differ per surface, all of them go
 * singular somewhere in the range a phone is actually held at (which is precisely the top-down
 * case), and each would need its own roll handling. Forty-eight projections of an eight-corner box
 * is about thirty microseconds, ONCE per placement rather than per frame — robustness at a price
 * too small to measure.
 */

/** How near and how far a product is ever placed, metres. Nothing outside this is a placement. */
export const PLACEMENT_DISTANCE_M: readonly [number, number] = [0.45, 6];
/** A wall you can stand in front of. Narrower than the above: rooms are not 6 m deep. */
export const WALL_DISTANCE_M: readonly [number, number] = [0.9, 4.5];
/** The product's longest side wants to fill about half the frame's short side. */
export const TARGET_FRAME_FRACTION = 0.5;
/** Below this much of the product on screen, the placement is reported as needing a nudge. */
export const FRAMED_COVERAGE = 0.72;
/** Candidates tried along the free parameter. */
const SAMPLES = 48;

/** The visible crop of the video frame, in video pixels — the web layer's cover map. */
export interface ViewRect {
  x0: number;
  y0: number;
  cw: number;
  ch: number;
}

export const fullFrame = (K: { W: number; H: number }): ViewRect => ({ x0: 0, y0: 0, cw: K.W, ch: K.H });

/**
 * How far away the product should ideally be: the distance at which its longest dimension fills
 * `TARGET_FRAME_FRACTION` of the short side of the view.
 *
 * This is the distance a person naturally stands at to look at a thing, expressed as arithmetic.
 * A 200 mm epoxy tin wants to be about half a metre away and a 2.3 m solar module about five —
 * which is exactly how you would look at each of them in a yard.
 */
export function idealViewingDistanceM(dims: ProductDims, K: Pick<Intrinsics, 'fx' | 'fy'>, view: ViewRect): number {
  const longestM = Math.max(dims.w_mm, dims.h_mm, dims.d_mm) / 1000;
  const shortPx = Math.max(1, Math.min(view.cw, view.ch));
  const f = Math.min(K.fx, K.fy);
  if (!(longestM > 0) || !(f > 0)) return 2;
  const d = (longestM * f) / (TARGET_FRAME_FRACTION * shortPx);
  return Math.max(PLACEMENT_DISTANCE_M[0], Math.min(PLACEMENT_DISTANCE_M[1], d));
}

/**
 * A conservative world box for the product resting at an anchor.
 *
 * Deliberately yaw-free: the horizontal half-extent is the LARGER of half-width and half-depth,
 * which contains the product at every yaw. Framing does not need corner-exact geometry — it needs
 * a bound it cannot be wrong about, and a bound that changed when the user rotated the product
 * would make the choice of placement depend on the rotation, which nobody wants.
 *
 * The vertical extent follows the rule's anchor face, matching what `normalizeModel` does to the
 * mesh: `bottom` stands on the anchor, `top` (a hanging bulb) hangs below it, `back` and `center`
 * straddle it. On a wall the product also extends out of the surface along the normal.
 */
/**
 * Does this product LIE DOWN on a horizontal surface?
 *
 * `orientation: 'flat'` has been in the rules table since it was written — on tiles, solar panels,
 * cement and the bathtub — and no renderer ever read it. So a 1200 mm floor tile stood on its long
 * edge like a headstone and a 2278 mm solar module stood upright on a roof: both correct to the
 * millimetre, both absurd, and both worst from directly above, which is exactly where a phone gets
 * pointed to look at a floor.
 *
 * The condition tests height against depth rather than trusting the flag alone, because the flag
 * does not separate the two cases the catalogue actually contains. A tile (600 x 1200 x 9), a panel
 * (1134 x 2278 x 30) and a cement bag (450 x 700 x 140) all record their LONG axis as height and
 * genuinely need turning down. A bathtub (1700 x 600 x 750) records its true standing height and
 * must not be touched. `h > d` separates them exactly.
 */
export function laysFlat(rule: PlacementRule, surface: Surface, dims: ProductDims): boolean {
  if (rule.orientation !== 'flat') return false;
  if (isVerticalSurface(surface) || surface === 'ceiling') return false;
  return dims.h_mm > dims.d_mm;
}

export function productCorners(anchor: Anchor, dims: ProductDims, rule: PlacementRule, mult = 1): Vec3[] | null {
  if (anchor.kind === 'screen') return null;
  const flat = laysFlat(rule, anchor.surface, dims);
  const w = (dims.w_mm / 1000) * mult;
  /* Laid down, the stated height runs along the surface and the stated depth is what stands up. */
  const h = ((flat ? dims.d_mm : dims.h_mm) / 1000) * mult;
  const d = ((flat ? dims.h_mm : dims.d_mm) / 1000) * mult;
  const P = anchor.P;
  const out: Vec3[] = [];
  const hangs = rule.anchor === 'top' || rule.orientation === 'hanging';

  if (anchor.kind === 'vertical') {
    const n = normalize(anchor.n);
    const right = normalize(v3(-n.z, 0, n.x));
    const half = w / 2;
    /* A wall item straddles its mount point vertically (`back` / `center`); a bulb on a wall
       bracket hangs off it. */
    const yLo = hangs ? -h : rule.anchor === 'bottom' ? 0 : -h / 2;
    const yHi = yLo + h;
    for (const s of [-half, half]) for (const y of [yLo, yHi]) for (const t of [0, d]) out.push(add(P, add(add(scale(right, s), scale(UP, y)), scale(n, t))));
    return out;
  }

  const half = Math.max(w, d) / 2;
  const down = anchor.surface === 'ceiling';
  const yLo = hangs || down ? -h : rule.anchor === 'center' ? -h / 2 : 0;
  const yHi = yLo + h;
  for (const dx of [-half, half]) for (const y of [yLo, yHi]) for (const dz of [-half, half]) out.push(add(P, v3(dx, y, dz)));
  return out;
}

export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fraction of the box's area inside the view, 0-1. */
  coverage: number;
  /** Corners that fell behind the camera. Any at all and the 2D bounds have wrapped and mean nothing. */
  behind: number;
}

/** Project a world box to the view and report how much of it lands inside. Null when it is entirely behind the camera. */
export function projectBox(corners: Vec3[], K: PixelIntrinsics, R: Mat3, C: Vec3, view: ViewRect): ScreenBox | null {
  let minU = Number.POSITIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let behind = 0;
  for (const P of corners) {
    const px = projectToPixel(K, R, C, P);
    if (!px) {
      behind++;
      continue;
    }
    if (px.u < minU) minU = px.u;
    if (px.u > maxU) maxU = px.u;
    if (px.v < minV) minV = px.v;
    if (px.v > maxV) maxV = px.v;
  }
  if (behind === corners.length || !Number.isFinite(minU)) return null;
  const w = maxU - minU;
  const h = maxV - minV;
  const onU = Math.max(0, Math.min(maxU, view.x0 + view.cw) - Math.max(minU, view.x0));
  const onV = Math.max(0, Math.min(maxV, view.y0 + view.ch) - Math.max(minV, view.y0));
  /* A corner behind the camera makes the 2D bound meaningless in that direction; treat any such
     box as unframed rather than trusting a projection that has wrapped around the horizon. */
  const coverage = behind > 0 ? 0 : (onU * onV) / Math.max(1e-6, w * h);
  return { x: minU, y: minV, w, h, coverage, behind };
}

/** How far the box's centre falls outside the view, in pixels; 0 when it is inside. */
function missDistance(box: ScreenBox, view: ViewRect): number {
  const cu = box.x + box.w / 2;
  const cv = box.y + box.h / 2;
  const du = cu < view.x0 ? view.x0 - cu : cu > view.x0 + view.cw ? cu - (view.x0 + view.cw) : 0;
  const dv = cv < view.y0 ? view.y0 - cv : cv > view.y0 + view.ch ? cv - (view.y0 + view.ch) : 0;
  return Math.hypot(du, dv);
}

/**
 * The row the product's centre should land on.
 *
 * Not the middle of the frame: a floor product read from standing height belongs in the lower half
 * of the picture and a ceiling product in the upper, and putting either dead centre reads as a
 * sticker rather than as a thing in the room. Everything else is centred.
 */
function targetRow(surface: Surface, view: ViewRect): number {
  if (surface === 'ceiling') return view.y0 + view.ch * 0.34;
  if (surface === 'floor' || surface === 'ground' || surface === 'table' || surface === 'roof') return view.y0 + view.ch * 0.6;
  return view.y0 + view.ch * 0.5;
}

/** The camera's heading projected onto the horizontal plane, defined everywhere — including straight down. */
export function horizontalHeading(R: Mat3): Vec3 {
  const { forward, up } = cameraAxes(R);
  const h = Math.hypot(forward.x, forward.z);
  if (h > 0.08) return v3(forward.x / h, 0, forward.z / h);
  /*
   * POINTING STRAIGHT DOWN (OR STRAIGHT UP) HAS NO HEADING — and this is the top-down case.
   *
   * The horizontal part of the view axis vanishes, so normalising it amplifies sensor noise into a
   * heading that spins. `wallNormalFacing` divides by the same vanishing quantity, which is why a
   * wall product placed while the phone was pointed at the floor used to jump around the room.
   *
   * The camera's own up axis is well defined there and points along the top of the screen, which
   * is the direction the person is facing. Looking down it IS the heading; looking up it is the
   * reverse.
   */
  const hu = Math.hypot(up.x, up.z);
  if (hu > 1e-6) {
    const s = forward.y < 0 ? 1 : -1;
    return v3((up.x / hu) * s, 0, (up.z / hu) * s);
  }
  return v3(0, 0, -1);
}

export type Nudge = 'up' | 'down' | 'left' | 'right' | null;

export interface FramingInput {
  K: Intrinsics;
  R: Mat3;
  C: Vec3;
  rule: PlacementRule;
  dims: ProductDims;
  surface: Surface;
  /** The visible crop; the whole frame when omitted. */
  view?: ViewRect | null;
  /** A measured wall distance. When present it is the truth and is not swept. */
  measuredDistanceM?: number | null;
  ceilingHeightM?: number;
  tableHeightM?: number;
  yawDeg?: number;
  /** Product scale the view is currently drawing at, so framing judges what is actually on screen. */
  scaleMult?: number;
}

export interface Framing {
  anchor: Anchor;
  /** Slant distance from the camera to the anchor, metres — always inside `PLACEMENT_DISTANCE_M`. */
  distanceM: number;
  /** How much of the product lands inside the view, 0-1. */
  coverage: number;
  /** Which way to tilt to bring it into view; null when it is already framed. */
  nudge: Nudge;
  /**
   * The product is larger than the view at the only distance the surface allows.
   *
   * Real and unavoidable: a 1.2 m tile lying on a floor 1.4 m below a phone pointed straight down
   * is bigger than the frame at true scale, and no choice of placement changes that — the visible
   * patch of floor at that angle is under a metre across. The view says so instead of rendering a
   * wall of texture and calling it a product.
   */
  oversized: boolean;
  /** Which free parameter was chosen. */
  method: 'along_surface' | 'wall_distance' | 'measured_wall';
}

/** The height of a horizontal surface above the floor. */
function planeHeightM(surface: Surface, input: FramingInput): number {
  if (surface === 'ceiling') return input.ceilingHeightM ?? DEFAULT_CEILING_M;
  if (surface === 'table') return input.tableHeightM ?? DEFAULT_TABLE_M;
  return 0;
}

/** The middle of the rule's own mounting band, or eye level when it declares none. */
function mountHeightM(rule: PlacementRule): number {
  const band = rule.heightBandMm;
  return band ? (band[0] + band[1]) / 2 / 1000 : 1.5;
}

/**
 * Choose the placement.
 *
 * Always returns an anchor. There is no path here on which the product is left unplaced, because
 * "unplaced" renders as an empty camera feed, and that is the bug this replaces.
 */
export function framePlacement(input: FramingInput): Framing {
  const { K, R, C, rule, dims } = input;
  const surface = input.surface;
  const view = input.view ?? fullFrame(K);
  const mult = input.scaleMult ?? 1;
  const wantRow = targetRow(surface, view);
  const dIdeal = idealViewingDistanceM(dims, K, view);
  const heading = horizontalHeading(R);

  const candidates: { anchor: Anchor; d: number }[] = [];
  let method: Framing['method'];
  /* The distance to score against: the ideal viewing distance, unless a wall has been measured. */
  let preferred = dIdeal;

  if (isVerticalSurface(surface)) {
    /* The wall faces the camera. Taken from `horizontalHeading` rather than from
       `wallNormalFacing`, so that it is defined when the phone points straight down too. */
    const fallback = wallNormalFacing(R);
    const nn = v3(-heading.x, 0, -heading.z);
    const normal = nn.x !== 0 || nn.z !== 0 ? normalize(nn) : fallback;
    const y = mountHeightM(rule);
    const at = (D: number): { anchor: Anchor; d: number } => ({
      anchor: { kind: 'vertical', surface, P: add(v3(C.x, y, C.z), scale(normal, -D)), n: normal },
      d: Math.hypot(D, y - C.y),
    });
    /*
     * A MEASURED WALL IS A STRONG PREFERENCE, NOT A PIN.
     *
     * Pinning to it was the first version, and the audit caught what that costs: all three CCTV
     * SKUs were invisible at every camera angle, because a marginal reading put the wall under a
     * metre away and a camera mounted at 2.6 m on a wall that close is above the top of the frame
     * at any pitch you would hold a phone at.
     *
     * Truth still wins where truth works — the sweep below scores distance against the measurement
     * rather than against the ideal, so the measured wall is chosen whenever it can carry the
     * product. It loses only to coverage, which is worth an order of magnitude more: a measurement
     * that makes the product invisible is far likelier to be wrong than the geometry is.
     */
    for (let i = 0; i < SAMPLES; i++) candidates.push(at(WALL_DISTANCE_M[0] + ((WALL_DISTANCE_M[1] - WALL_DISTANCE_M[0]) * i) / (SAMPLES - 1)));
    const measured = input.measuredDistanceM;
    const usableMeasurement = typeof measured === 'number' && Number.isFinite(measured) && measured > 0;
    if (usableMeasurement) preferred = Math.max(WALL_DISTANCE_M[0], Math.min(PLACEMENT_DISTANCE_M[1], measured as number));
    method = usableMeasurement ? 'measured_wall' : 'wall_distance';
  } else {
    const planeY = planeHeightM(surface, input);
    const dy = planeY - C.y; // negative for a floor, positive for a ceiling
    const yaw = input.yawDeg ?? 0;
    const rMax = Math.sqrt(Math.max(0, PLACEMENT_DISTANCE_M[1] ** 2 - dy * dy));
    for (let i = 0; i < SAMPLES; i++) {
      const r = (rMax * i) / (SAMPLES - 1);
      const d = Math.hypot(r, dy);
      if (d < PLACEMENT_DISTANCE_M[0]) continue;
      candidates.push({ anchor: { kind: 'horizontal', surface: surface as 'floor', P: add(v3(C.x, planeY, C.z), scale(heading, r)), yawDeg: yaw }, d });
    }
    /* A ceiling directly overhead, or a table right under the camera, can leave the band empty. */
    if (!candidates.length)
      candidates.push({ anchor: { kind: 'horizontal', surface: surface as 'floor', P: v3(C.x, planeY, C.z), yawDeg: yaw }, d: Math.abs(dy) });
    method = 'along_surface';
  }

  const fwd = cameraAxes(R).forward;
  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestBox: ScreenBox | null = null;
  for (const c of candidates) {
    const corners = productCorners(c.anchor, dims, rule, mult);
    const box = corners ? projectBox(corners, K, R, C, view) : null;
    /*
     * Four terms, an order of magnitude apart so the ranking cannot invert.
     *
     *   coverage   how much of the product is on screen. Nothing else comes close to mattering.
     *   ranged     how near the natural viewing distance it sits — this is what stops a bulb
     *              being parked six metres down a ceiling just because that row looked right.
     *   centred    the row its mount belongs at. Only consulted when the projection is MEANINGFUL:
     *              a box with corners behind the camera has wrapped, and its "centre" is a number
     *              with no geometric content. Ranking on it put a 1.8 m window pane 0.9 m from
     *              somebody's face because the wrapped bounds happened to land near the target row.
     *   aimed      how far off the view axis the anchor is. Zero-coverage candidates are all tied
     *              at nothing on the first three, and this is what breaks the tie usefully: when a
     *              bulb genuinely cannot be seen from where the phone is pointed, the placement to
     *              choose is the one the SHORTEST TILT brings into view.
     */
    const usable = box !== null && box.behind === 0;
    const centred = usable ? 1 - Math.min(1, Math.abs((box as ScreenBox).y + (box as ScreenBox).h / 2 - wantRow) / Math.max(1, view.ch)) : 0;
    /* How far the product's centre falls OUTSIDE the view, in pixels. Zero-coverage candidates are
       all tied at nothing on `coverage`, and without this the tie broke on distance alone — which
       chose, for a floor product with the phone tilted up, the one directly underfoot rather than
       the one just past the bottom edge. Nearly-in-view has to beat nowhere-near. */
    const near = usable ? 1 - Math.min(1, missDistance(box as ScreenBox, view) / Math.hypot(view.cw, view.ch)) : 0;
    const ranged = 1 - Math.min(1, Math.abs(Math.log(c.d / preferred)));
    const cp = c.anchor.kind === 'screen' ? C : c.anchor.P;
    const dir = normalize(v3(cp.x - C.x, cp.y - C.y, cp.z - C.z));
    /* Only consulted when there is no usable projection at all: among placements that cannot be
       seen from here, the right one is whichever the SHORTEST tilt brings into view. */
    const aimed = usable ? 0 : (dir.x * fwd.x + dir.y * fwd.y + dir.z * fwd.z + 1) / 2;
    const score = (box?.coverage ?? 0) * 100 + near * 20 + ranged * 6 + centred * 10 + aimed * 3;
    if (score > bestScore) {
      bestScore = score;
      best = c;
      bestBox = box;
    }
  }

  const coverage = bestBox?.coverage ?? 0;
  /* Bigger than the frame at the only distance the surface allows — see `oversized` above. */
  const oversized = !!bestBox && bestBox.behind === 0 && (bestBox.w > view.cw || bestBox.h > view.ch);
  let nudge: Nudge = null;
  if (coverage < FRAMED_COVERAGE) {
    if (oversized) {
      /* Too close, and the fix is distance. Tilting toward the far end of the surface — up for a
         floor, down for a ceiling — is what lets the next re-frame put the product further away. */
      nudge = surface === 'ceiling' ? 'down' : 'up';
    } else if (!bestBox || bestBox.behind > 0) {
      /* Not in front of the camera at all, so there is no pixel to reason from. Point at where the
         product actually is: the difference in elevation between the anchor and the view axis. */
      const P = best.anchor.kind === 'screen' ? C : best.anchor.P;
      const dir = normalize(v3(P.x - C.x, P.y - C.y, P.z - C.z));
      nudge = dir.y > fwd.y ? 'up' : 'down';
    } else {
      const cu = bestBox.x + bestBox.w / 2;
      const cv = bestBox.y + bestBox.h / 2;
      const dv = cv < view.y0 ? view.y0 - cv : cv > view.y0 + view.ch ? cv - (view.y0 + view.ch) : 0;
      const du = cu < view.x0 ? view.x0 - cu : cu > view.x0 + view.cw ? cu - (view.x0 + view.cw) : 0;
      if (du > dv && du > 0) nudge = cu < view.x0 ? 'left' : 'right';
      else nudge = cv < view.y0 + view.ch / 2 ? 'up' : 'down';
    }
  }

  return { anchor: best.anchor, distanceM: best.d, coverage, nudge, oversized, method };
}

/**
 * A tap or drag, cast onto the surface and kept inside the placement band.
 *
 * The unclamped version is `anchorFromPixel`, and dragging with it is how a cement bag ends up
 * 25 m away: near the horizon a one-pixel move is metres of floor, so a drag that crosses the
 * horizon line throws the product to the far end of the room and then loses it entirely. Here the
 * ray is still the user's, and only the DISTANCE along it is bounded — so the product tracks the
 * finger everywhere it can, and stops receding where it would stop being visible.
 */
export function placementFromPixel(input: {
  K: PixelIntrinsics;
  R: Mat3;
  C: Vec3;
  u: number;
  v: number;
  surface: Surface;
  yawDeg?: number;
  plane: { n: Vec3; d: number };
}): Anchor {
  const [dMin, dMax] = PLACEMENT_DISTANCE_M;
  const ray = rayFromPixel(input.K, input.R, input.C, input.u, input.v);
  const hit = intersectPlane(ray, input.plane);
  const nrm = normalize(input.plane.n);
  const onPlane = (X: Vec3): Vec3 => add(X, scale(nrm, -(nrm.x * X.x + nrm.y * X.y + nrm.z * X.z - input.plane.d)));

  /* Where the ray meets the surface — or, when it misses (a floor tap above the horizon), a point
     a couple of metres ahead dropped onto it. Either way the product ends up ON the surface. */
  const raw = onPlane(hit ? hit.P : add(ray.origin, scale(ray.dir, 2)));

  /*
   * THE BOUND IS APPLIED IN THE PLANE, NOT ALONG THE RAY.
   *
   * Clamping the ray parameter and then dropping the result onto the surface does not bound the
   * distance: for a near-horizontal ray, dropping a point 6 m along it onto a floor 1.4 m below
   * lands 6.16 m from the camera. So the offset is measured from the camera's own foot — its
   * projection onto the surface — and scaled there, which is the only place the arithmetic closes.
   */
  const foot = onPlane(input.C);
  const perp = Math.hypot(input.C.x - foot.x, input.C.y - foot.y, input.C.z - foot.z);
  const offX = raw.x - foot.x;
  const offY = raw.y - foot.y;
  const offZ = raw.z - foot.z;
  const along = Math.hypot(offX, offY, offZ);
  const lo = Math.sqrt(Math.max(0, dMin * dMin - perp * perp));
  const hi = Math.sqrt(Math.max(0, dMax * dMax - perp * perp));
  const wanted = Math.max(lo, Math.min(hi, along));
  const k = along > 1e-9 ? wanted / along : 0;
  const P = along > 1e-9 ? v3(foot.x + offX * k, foot.y + offY * k, foot.z + offZ * k) : foot;
  if (isVerticalSurface(input.surface)) return { kind: 'vertical', surface: input.surface, P, n: nrm };
  return { kind: 'horizontal', surface: input.surface as 'floor', P, yawDeg: input.yawDeg ?? 0 };
}

/** The pixel a framed anchor sits at — for the "show me" arrow when the user turns away from it. */
export function anchorScreenPoint(anchor: Anchor, K: PixelIntrinsics, R: Mat3, C: Vec3): Pixel | null {
  if (anchor.kind === 'screen') return { u: anchor.u, v: anchor.v };
  return projectToPixel(K, R, C, anchor.P);
}

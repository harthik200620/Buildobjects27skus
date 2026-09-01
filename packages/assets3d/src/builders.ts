/**
 * Honest parametric models per category. Every model is built at the SKU's real dimensions
 * (dim_w_mm × dim_h_mm × dim_d_mm from the spec attributes), standing on y = 0 and centred on
 * x / z, front facing +Z, with brand-appropriate materials. When the image stage has produced
 * photo cut-outs they are mapped onto the model (`textured: true`):
 *
 *   cement             printed panel on the sack = hero cut-out, weave = mean colour
 *   tiles              top face = the tile face
 *   solar-panels       cell face = hero
 *   epoxy              label wrap on the front half of each tin (u ∈ [0.25, 0.75])
 *   fire-extinguishers label band = middle band of the hero, wrapped on the front half
 *   glass              tint = mean colour of the photo (alpha 0.35)
 *   cctv               body colour = mean colour of the photo
 *   bulbs, total stations, bathtub, generic — unchanged (emissive / flat colours)
 *
 * A real GLB at assets/3d/{SKU_CODE}.glb replaces any of them with no code change — PROVIDED
 * assets/3d/review.json has not rejected it. Nine were, for being the carton rather than the
 * product; see that file.
 */
import type { MeshData } from './gltf';
import { box, boxFaces, cylinder, dome, lathe, MAT, ring, rotate, sack, texturedMaterial, tintedMaterial, translate } from './shapes';
import type { BuilderTextures } from './textures';

export interface Dims {
  w: number;
  h: number;
  d: number;
} // metres
export interface BuildOptions {
  variant?: string | null;
  textures?: BuilderTextures | null;
}
export interface BuildResult {
  meshes: MeshData[];
  variant: string;
  /** True when a photo (texture or photo-derived colour) shaped the model. */
  textured: boolean;
  /** How the photos were used — recorded in the manifest. */
  textureNote?: string;
}
export type Builder = (dims: Dims, opts: BuildOptions) => BuildResult;

const SEG = 36;
const FRONT: [number, number] = [0.25, 0.75],
  BACK: [number, number] = [0.75, 1.25];

/** LED bulb: A60 photoreal model with metallic B22 bayonet cap + pins, white thermal housing and frosted diffuser dome. Real: Ø 60 × 110 mm. */
const bulb: Builder = ({ w, h }, { variant, textures: t }) => {
  const isE27 = /e27/i.test(variant ?? '');
  const r = (w || 0.06) / 2; // 30 mm radius
  const totalH = h || 0.11; // 110 mm height

  // 1. Base Cap: B22 bayonet or E27 screw cap (height ~20 mm)
  const capR = isE27 ? 0.0135 : 0.011; // 22mm diameter for B22, 27mm for E27
  const capH = 0.02;
  const cap = cylinder(capR, capR, capH, SEG, [0, 0, 0], MAT.silver, { smooth: true });

  // Bayonet locking pins (for B22)
  const pins: MeshData[] = [];
  if (!isE27) {
    const pinR = 0.0014,
      pinLen = 0.0035;
    const pin1 = translate(rotate(cylinder(pinR, pinR, pinLen, 12, [0, 0, 0], MAT.pinSilver, { smooth: true }), 'z', Math.PI / 2), [
      capR + pinLen / 2,
      capH * 0.45,
      0,
    ]);
    const pin2 = translate(rotate(cylinder(pinR, pinR, pinLen, 12, [0, 0, 0], MAT.pinSilver, { smooth: true }), 'z', -Math.PI / 2), [
      -(capR + pinLen / 2),
      capH * 0.45,
      0,
    ]);
    pins.push(pin1, pin2);
  }

  // 2. Insulator & Stepped Collar (height ~4 mm)
  const collarH = 0.004;
  const collar = ring(capR * 1.18, capR, collarH, SEG, [0, capH, 0], MAT.whitePlastic);

  // 3. Thermal Plastic Housing / Body (height ~40 mm)
  const bodyBaseY = capH + collarH;
  const bodyH = 0.04;
  const bodyMat = t?.hero ? texturedMaterial('bulb-housing-branded', t.hero, { roughness: 0.35 }) : MAT.bulbHousing;

  // Smooth lathe profile from collar (radius 13mm) to waist (radius 30mm)
  const housingProf: [number, number][] = [
    [capR * 1.15, 0],
    [capR * 1.25, bodyH * 0.2],
    [r * 0.72, bodyH * 0.55],
    [r * 0.92, bodyH * 0.85],
    [r, bodyH],
  ];
  const housing = lathe(housingProf, SEG, [0, bodyBaseY, 0], bodyMat, false, { smooth: true, uv: 'cylindrical' });

  // 4. Frosted Polycarbonate Diffuser Dome (A60 pear dome from body equator to top, height ~46 mm)
  const domeBaseY = bodyBaseY + bodyH;
  const domeH = totalH - domeBaseY; // remaining height ~46 mm
  const domeProf: [number, number][] = [
    [r, 0],
    [r * 0.99, domeH * 0.22],
    [r * 0.92, domeH * 0.48],
    [r * 0.76, domeH * 0.72],
    [r * 0.5, domeH * 0.9],
    [r * 0.24, domeH * 0.98],
    [0, domeH],
  ];
  const domeMesh = lathe(domeProf, SEG, [0, domeBaseY, 0], MAT.bulbDiffuser, false, { smooth: true });

  return {
    meshes: [cap, ...pins, collar, housing, domeMesh],
    variant: isE27 ? 'a60-e27' : 'a60-b22',
    textured: !!t?.hero,
    textureNote: t?.hero ? 'housing branded from the hero photo' : undefined,
  };
};

/** CCTV: a turret (eyeball in a cradle, lens along the mount axis) or a bullet on a swivel bracket. Body colour from the photo when the review allows one. */
const cctv: Builder = ({ w, h, d }, { variant, textures: t }) => {
  const bodyMat = t?.mean ? tintedMaterial('cctv-body', t.mean, { roughness: 0.5 }) : MAT.whitePlastic;
  const textured = !!t?.mean,
    textureNote = textured ? 'body colour from the hero photo' : undefined;
  const isBullet = /bullet/i.test(variant ?? '') || d > w * 1.4;
  if (isBullet) {
    const r = (Math.min(w, h) / 2) * 0.9,
      len = d;
    // Downward pitch for realistic surveillance angle
    const pitch = -0.22; // ~12.5 deg downward aim
    const body = rotate(cylinder(r, r * 0.92, len, SEG, [0, 0, 0], bodyMat, { smooth: true }), 'x', Math.PI / 2 + pitch, [0, 0, 0]);
    const bodyZ = translate(body, [0, r + 0.03, len * 0.85]);
    const lens = translate(rotate(ring(r * 0.92, r * 0.55, 0.006, SEG, [0, 0, 0], MAT.blackPlastic), 'x', Math.PI / 2 + pitch), [
      0,
      r + 0.03 - Math.sin(pitch) * len * 0.5,
      len * 0.85 + 0.003,
    ]);
    const lensGlass = translate(rotate(cylinder(r * 0.55, r * 0.55, 0.004, SEG, [0, 0, 0], MAT.lensGlass), 'x', Math.PI / 2 + pitch), [
      0,
      r + 0.03 - Math.sin(pitch) * len * 0.5,
      len * 0.85 + 0.002,
    ]);
    const hood = rotate(box(r * 2.05, 0.008, len * 0.55, [0, r * 2 + 0.024, len * 0.55], bodyMat), 'x', pitch, [0, r + 0.03, len * 0.3]);
    // Articulated swivel arm and wall mounting plate
    const arm = box(0.022, r + 0.03, 0.022, [0, (r + 0.03) / 2, len * 0.25], MAT.bracketSteel);
    const swivelBall = cylinder(0.016, 0.016, 0.024, 16, [0, r + 0.025, len * 0.25], MAT.bracketSteel);
    const plate = rotate(cylinder(0.045, 0.045, 0.008, 24, [0, 0, 0], MAT.bracketSteel), 'x', Math.PI / 2);
    const plateP = translate(plate, [0, 0, len * 0.25]);
    return { meshes: [bodyZ, lens, lensGlass, hood, arm, swivelBall, plateP], variant: 'bullet', textured, textureNote };
  }
  /*
   * TURRET ("eyeball"), not a smoked dome — which is what a Dahua HDW1200TRQ and most fixed
   * cameras in this catalogue actually are, and what the old model was not. It was a cylinder,
   * a flat ring and a tinted hemisphere: at AR size that reads as a dessert bowl, which is fair
   * comment on "cartoon cctv".
   *
   * What makes a camera legible at 90 mm on a wall is not polygon count, it is the FACE: a black
   * bezel with a recessed glass lens and the ring of IR LEDs around it. That is the silhouette
   * everybody recognises, so it is modelled rather than implied, and the ball is leaned so the
   * face turns towards the room instead of presenting a blank sphere to the viewer.
   */
  const R = w / 2;
  const baseH = Math.max(0.012, h * 0.16);
  const ballR = Math.min(R * 0.94, (h - baseH) * 0.92);
  const tilt = 0.38; // ~22° of lean towards +Z, the aim an installer leaves on a wall camera
  const ballY = baseH + ballR * 0.62;

  /* Mounting plate and the cradle the eyeball sits in. */
  const plate = cylinder(R * 1.04, R * 0.98, baseH * 0.45, SEG, [0, 0, 0], MAT.whitePlastic, { smooth: true });
  const cradle = lathe(
    [
      [R * 0.98, 0],
      [R * 0.99, baseH * 0.5],
      [R * 0.88, baseH],
      [R * 0.72, baseH * 1.35],
    ],
    SEG,
    [0, baseH * 0.45, 0],
    MAT.whitePlastic,
    false,
    { smooth: true },
  );
  const ball = dome(ballR, SEG, [0, ballY, 0], bodyMat, 0.62, 16, { smooth: true });
  /* The underside of the ball, so it is a ball and not a bowl seen from below. */
  const ballUnder = rotate(dome(ballR, SEG, [0, 0, 0], bodyMat, 0.42, 12, { smooth: true }), 'x', Math.PI, [0, 0, 0]);

  /* The face: bezel, IR ring, lens, and a glass cover over the whole recess. */
  const faceR = ballR * 0.74;
  const bezel = rotate(cylinder(faceR, faceR * 0.99, 0.004, SEG, [0, 0, 0], MAT.blackPlastic, { smooth: true }), 'x', Math.PI / 2);
  const irRing = rotate(ring(faceR * 0.92, faceR * 0.6, 0.003, SEG, [0, 0, 0], MAT.irWindow), 'x', Math.PI / 2);
  const lensBarrel = rotate(cylinder(faceR * 0.44, faceR * 0.4, 0.012, 24, [0, 0, 0], MAT.blackPlastic, { smooth: true }), 'x', Math.PI / 2);
  const lensGlass = rotate(dome(faceR * 0.38, 24, [0, 0, 0], MAT.lensGlass, 0.4, 8, { smooth: true }), 'x', Math.PI / 2);
  /*
   * THE LENS LOOKS AWAY FROM THE MOUNT — along +Y, not +Z — and that is a placement decision, not
   * a modelling preference.
   *
   * A model here has two distinguished directions: it stands on -Y and it faces +Z. On a floor
   * both survive. On a WALL they cannot: render3d.ts turns the model a quarter about X so the
   * base goes into the wall, which is the only way to mount it, and that same quarter turn sends
   * whatever faced +Z straight down at the floor. Built facing +Z, this camera arrived on a wall
   * staring at the skirting board.
   *
   * So a wall-mounted device is built with its business end along the axis it stands on, pointing
   * away from the mount. Then the quarter turn puts the plate flat on the wall and the lens out
   * into the room, and `ceiling_flush` (a half turn) puts the plate on the ceiling and the lens
   * down — both correct from one model, which is the test that says the convention is the right
   * one rather than a fix for one case.
   *
   * The 22° lean toward +Z is the aim an installer leaves on a wall camera, and it is what stops
   * the AR view presenting a featureless white sphere with the lens hidden on top.
   */
  const at = (m: MeshData, up: number) => translate(rotate(m, 'x', -Math.PI / 2), [0, ballY + ballR * up, 0]);
  const face = [at(bezel, 0.7), at(irRing, 0.73), at(lensBarrel, 0.74), at(lensGlass, 0.82)];
  const head = [ball, translate(ballUnder, [0, ballY, 0]), ...face].map((m) => rotate(m, 'x', tilt, [0, ballY, 0]));

  return { meshes: [plate, cradle, ...head], variant: 'turret', textured, textureNote };
};

/** Tile: a slab lying flat (w × thickness × length) with a darker edge; the top face wears the tile face photo. */
const tiles: Builder = ({ w, h, d }, { textures: t }) => {
  const th = Math.min(h, d, 0.02),
    len = Math.max(h, d);
  const bisque = box(w, th * 0.15, len, [0, th * 0.075, 0], MAT.tileEdge);
  if (t?.hero) {
    const body = tintedMaterial('tile-body', t.hero.mean, { roughness: 0.3 });
    const slab = boxFaces(w, th * 0.85, len, [0, th * 0.575, 0], { top: texturedMaterial('tile-face', t.hero, { roughness: 0.2 }), rest: body }, 'top');
    return { meshes: [...slab, bisque], variant: 'slab', textured: true, textureNote: 'tile face = hero cut-out, edges = mean colour' };
  }
  const slab = box(w, th * 0.85, len, [0, th * 0.575, 0], MAT.tileIvory);
  return { meshes: [slab, bisque], variant: 'slab', textured: false };
};

/** Glass: a vertical pane standing on its long edge, with a polished edge; tint from the photo. */
const glass: Builder = ({ w, h, d }, { textures: t }) => {
  const th = Math.min(d, h, 0.03);
  const paneMat = t?.mean ? tintedMaterial('glass-tint', t.mean, { alpha: 0.35, roughness: 0.05, blend: true, doubleSided: true }) : MAT.glassPane;
  const pane = box(w, h, th, [0, h / 2, 0], paneMat);
  const edge = box(w, 0.004, th * 1.02, [0, h - 0.002, 0], MAT.glassEdge);
  return {
    meshes: [pane, edge],
    variant: 'pane',
    textured: !!t?.mean,
    textureNote: t?.mean ? 'tint = mean colour of the hero photo at alpha 0.35' : undefined,
  };
};

/** Solar module lying tilted: aluminium frame, dark cell face (the hero photo when available), grid bars, and ground/roof tilt rack. */
const solar: Builder = ({ w, h, d }, { textures: t }) => {
  const L = Math.max(w, h),
    W = Math.min(w, h),
    th = Math.min(d, 0.05);
  const frameW = 0.035;
  const cellDims: [number, number, number, [number, number, number]] = [W - frameW * 2 + 0.004, th * 0.35, L - frameW * 2 + 0.004, [0, th - th * 0.175, 0]];
  const frame = [
    box(W, th, frameW, [0, th / 2, L / 2 - frameW / 2], MAT.aluminium),
    box(W, th, frameW, [0, th / 2, -L / 2 + frameW / 2], MAT.aluminium),
    box(frameW, th, L, [W / 2 - frameW / 2, th / 2, 0], MAT.aluminium),
    box(frameW, th, L, [-W / 2 + frameW / 2, th / 2, 0], MAT.aluminium),
  ];
  const back = box(W - frameW * 2, th * 0.3, L - frameW * 2, [0, th * 0.15, 0], MAT.blackPlastic);
  // Ground / roof tilt rack legs (~20 deg tilt angle)
  const rackLegH = L * 0.35;
  const rackLegL = box(0.04, rackLegH, 0.04, [-W * 0.4, rackLegH / 2, -L * 0.35], MAT.solarRackSteel);
  const rackLegR = box(0.04, rackLegH, 0.04, [W * 0.4, rackLegH / 2, -L * 0.35], MAT.solarRackSteel);
  const rackFootL = box(0.08, 0.008, 0.12, [-W * 0.4, 0.004, -L * 0.35], MAT.solarRackSteel);
  const rackFootR = box(0.08, 0.008, 0.12, [W * 0.4, 0.004, -L * 0.35], MAT.solarRackSteel);
  const rackFrontFootL = box(0.08, 0.008, 0.12, [-W * 0.4, 0.004, L * 0.4], MAT.solarRackSteel);
  const rackFrontFootR = box(0.08, 0.008, 0.12, [W * 0.4, 0.004, L * 0.4], MAT.solarRackSteel);
  const rackBrace = box(W * 0.84, 0.02, 0.02, [0, rackLegH * 0.7, -L * 0.35], MAT.solarRackSteel);
  const rack = [rackLegL, rackLegR, rackFootL, rackFootR, rackFrontFootL, rackFrontFootR, rackBrace];

  if (t?.hero) {
    const cells = boxFaces(...cellDims, { top: texturedMaterial('solar-face', t.hero, { roughness: 0.25, metallic: 0.1 }), rest: MAT.solarCell }, 'top');
    return {
      meshes: [...cells, ...frame, back, ...rack],
      variant: 'framed-module',
      textured: true,
      textureNote: 'cell face = hero cut-out with tilt mounting rack',
    };
  }
  const cells = box(...cellDims, MAT.solarCell);
  const bars: MeshData[] = [];
  for (let i = 1; i < 6; i++) bars.push(box(W - frameW * 2, 0.001, 0.003, [0, th + 0.0005, -L / 2 + frameW + ((L - frameW * 2) * i) / 6], MAT.solarGrid));
  bars.push(box(0.003, 0.001, L - frameW * 2, [0, th + 0.0005, 0], MAT.solarGrid));
  return { meshes: [cells, ...frame, ...bars, back, ...rack], variant: 'framed-module', textured: false };
};

/** Portable extinguisher: red cylinder, shoulder, brass valve, black lever + hose + gauge + steel wall mounting bracket. */
const extinguisher: Builder = ({ w, h }, { textures: t }) => {
  const r = (w / 2) * 0.82,
    bodyH = h * 0.72;
  const body = lathe(
    [
      [r * 0.85, 0],
      [r, r * 0.3],
      [r, bodyH - r * 0.4],
      [r * 0.55, bodyH],
      [r * 0.18, bodyH + 0.012],
    ],
    SEG,
    [0, 0, 0],
    MAT.signalRed,
    true,
    { smooth: true },
  );
  const valve = cylinder(r * 0.2, r * 0.2, h * 0.08, 24, [0, bodyH + 0.01, 0], MAT.brass);
  const head = box(r * 0.8, h * 0.07, r * 0.45, [0, bodyH + h * 0.12, 0], MAT.blackPlastic);
  const lever = rotate(box(r * 0.9, 0.006, r * 0.3, [r * 0.15, bodyH + h * 0.165, 0], MAT.blackPlastic), 'z', -0.25, [-r * 0.3, bodyH + h * 0.165, 0]);
  const gauge = rotate(cylinder(0.014, 0.014, 0.006, 20, [0, 0, 0], MAT.whitePlastic), 'x', Math.PI / 2);
  const gaugeP = translate(gauge, [r * 0.35, bodyH + h * 0.11, r * 0.28]);
  const hose = translate(cylinder(0.006, 0.006, bodyH * 0.7, 12, [0, 0, 0], MAT.rubber), [r * 1.06, bodyH * 0.18, 0]);
  const hoseBend = rotate(translate(cylinder(0.006, 0.006, r * 0.9, 12, [0, 0, 0], MAT.rubber), [0, 0, 0]), 'z', Math.PI / 2, [0, 0, 0]);
  const hoseTop = translate(hoseBend, [r * 1.06, bodyH * 0.18 + bodyH * 0.7, 0]);
  const nozzle = translate(cylinder(0.007, 0.012, 0.03, 12, [0, 0, 0], MAT.blackPlastic), [r * 1.06, bodyH * 0.18 - 0.03, 0]);

  // Wall-Mounting Bracket / Holder behind cylinder (at z = -r)
  const bracketSpine = box(0.035, bodyH * 0.65, 0.006, [0, bodyH * 0.5, -r - 0.003], MAT.bracketSteel);
  const bracketUpperHook = ring(r * 1.04, r * 0.98, 0.015, SEG, [0, bodyH * 0.68, 0], MAT.bracketSteel);
  const bracketLowerShelf = box(r * 1.4, 0.008, r * 0.6, [0, 0.004, -r * 0.4], MAT.bracketSteel);
  const bracketFlangeTop = box(0.05, 0.02, 0.006, [0, bodyH * 0.8, -r - 0.003], MAT.bracketSteel);
  const bracketFlangeBottom = box(0.05, 0.02, 0.006, [0, bodyH * 0.2, -r - 0.003], MAT.bracketSteel);
  const wallMount = [bracketSpine, bracketUpperHook, bracketLowerShelf, bracketFlangeTop, bracketFlangeBottom];

  const common = [body, valve, head, lever, gaugeP, hose, hoseTop, nozzle, ...wallMount];
  if (t?.band) {
    const bandH = bodyH * 0.38,
      bandY = bodyH * 0.29,
      bandR = r * 1.012;
    const front = cylinder(bandR, bandR, bandH, SEG, [0, bandY, 0], texturedMaterial('ext-label', t.band, { roughness: 0.6 }), {
      uv: 'cylindrical',
      arc: FRONT,
      smooth: true,
      caps: false,
    });
    const back = cylinder(bandR, bandR, bandH, SEG, [0, bandY, 0], tintedMaterial('ext-label-back', t.band.mean, { roughness: 0.6 }), {
      arc: BACK,
      smooth: true,
      caps: false,
    });
    return {
      meshes: [...common, front, back],
      variant: 'stored-pressure',
      textured: true,
      textureNote: 'label band = middle band of the hero with wall mounting bracket',
    };
  }
  const labelBand = box(r * 2.02, bodyH * 0.38, r * 2.02, [0, bodyH * 0.48, 0], MAT.tinLabel);
  return { meshes: [...common, labelBand], variant: 'stored-pressure', textured: false };
};

/**
 * Cement sack lying flat on the floor, printed panel up.
 *
 * ONE SHAPE, PHOTOGRAPH OR NOT. This used to be two different objects: a `boxFaces` slab when a
 * photo was available and a `box` with a coloured band when it was not — so whether a 50 kg sack
 * was bag-shaped depended on whether the image stage had run. A rectangular slab reads as
 * polystyrene either way; the silhouette gives it away before the print does. `sack()` sweeps a
 * superellipse along the length and pinches both ends into seams, which is the shape the contents
 * actually make, and the photo — when there is an honest one — is mapped onto that.
 *
 * TODAY THERE IS NO HONEST ONE. Every cement SKU here is photographed as somebody else's bag:
 * Dalmia on two, JK Super on a third, a 1 kg contact-cement pouch on the rest. assets/3d/review.json
 * refuses them, so the sack arrives unprinted and wears a neutral panel instead. An unbranded bag
 * at 450 × 700 × 140 is a true statement; a bag in a rival's livery is not, and it is what shipped.
 *
 * Built long-axis-along-X and turned a quarter so the seams end up on Z, keeping the bounding box
 * the flat version had (X = w, Y = d, Z = h) — the AR placement rectangle is computed from it.
 */
const cement: Builder = ({ w, h, d }, { textures: t }) => {
  const printed = t?.hero ? texturedMaterial('bag-print', t.hero, { roughness: 0.85 }) : MAT.sackPanel;
  /* The back of the bag, on the underside — what `t.angle` has always been for. */
  const underside = t?.hero ? texturedMaterial('bag-print-back', t.angle ?? t.hero, { roughness: 0.85 }) : undefined;
  const meshes = sack(h, d, w, [0, 0, 0], t?.mean ? tintedMaterial('bag-weave', t.mean, { roughness: 0.92 }) : MAT.sackWoven, {
    squareness: 3.1,
    panel: printed,
    underPanel: underside,
    panelSpan: [0.66, 0.7],
  }).map((m) => rotate(m, 'y', Math.PI / 2));
  return {
    meshes,
    variant: 'bag-flat',
    textured: !!t?.hero,
    textureNote: t?.hero ? 'printed panel = hero cut-out, mapped onto the sack; weave = mean colour' : undefined,
  };
};

/**
 * Two-part epoxy kit: a resin pail and a smaller hardener tin, standing on the floor together.
 *
 * A pail is not a plain cylinder. What says "tin of resin" is the rolled rim at the top, the
 * recessed lid inside it and the wire bail handle — that silhouette is the whole recognition,
 * and without it two smooth drums read as batteries. The straight-sided cylinders here were
 * doing exactly that.
 *
 * The loose spatula is gone. It was a flat black slab lying on the floor beside the tins, and at
 * AR size it read as a piece of debris rather than an applicator — a detail that costs
 * recognition instead of adding it.
 *
 * Unlabelled unless the review lets a photograph through, and for every epoxy SKU in this
 * catalogue it does not: the pictures are MYK Laticrete, Craft Basket, Kritok, MagicMart, Kafuter
 * and VazzLox tubs, and not one of them is Fosroc, Pidilite or Sika.
 */
const epoxy: Builder = ({ w, h, d }, { textures: t }) => {
  const rA = (Math.min(w, d) / 2) * 0.62,
    hA = h;
  const xA = -rA * 0.55;
  /* Pail wall: a slight taper (pails stack), a rolled rim, and the lid sunk inside it. */
  const bodyA = lathe(
    [
      [rA * 0.9, 0],
      [rA * 0.93, hA * 0.04],
      [rA, hA * 0.86],
      [rA * 1.05, hA * 0.92],
      [rA * 1.03, hA * 0.96],
      [rA * 0.96, hA * 0.94],
    ],
    SEG,
    [xA, 0, 0],
    MAT.tin,
    true,
    { smooth: true },
  );
  const lidA = cylinder(rA * 0.95, rA * 0.93, hA * 0.035, SEG, [xA, hA * 0.9, 0], MAT.tin, { smooth: true });
  /* Wire bail across the pail, on two lugs — the part of a tin the eye finds first.
     Swept as short segments along a semicircle rather than as an arc of a lathe: a lathe revolves
     about Y, so no rotation of it produces a handle standing UP over the lid, and the attempt
     rendered as a blip on the rim. Twelve segments is smooth enough at 90 mm. */
  const bailSeg = 12;
  const bailR = rA * 1.0;
  const wire = 0.0022;
  const bail: MeshData[] = [];
  for (let i = 0; i < bailSeg; i++) {
    const a0 = Math.PI * (i / bailSeg),
      a1 = Math.PI * ((i + 1) / bailSeg);
    const x0 = -Math.cos(a0) * bailR,
      y0 = Math.sin(a0) * bailR * 0.62;
    const x1 = -Math.cos(a1) * bailR,
      y1 = Math.sin(a1) * bailR * 0.62;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const seg = box(len, wire * 2, wire * 2, [0, 0, 0], MAT.bracketSteel);
    bail.push(translate(rotate(seg, 'z', Math.atan2(y1 - y0, x1 - x0)), [xA + (x0 + x1) / 2, hA * 0.9 + (y0 + y1) / 2, 0]));
  }
  const lugs = [
    box(0.006, hA * 0.06, 0.004, [xA - rA * 1.01, hA * 0.86, 0], MAT.bracketSteel),
    box(0.006, hA * 0.06, 0.004, [xA + rA * 1.01, hA * 0.86, 0], MAT.bracketSteel),
  ];

  const rB = rA * 0.55,
    hB = hA * 0.6,
    xB = rA * 0.95,
    zB = rA * 0.1;
  const bodyB = lathe(
    [
      [rB * 0.92, 0],
      [rB * 0.95, hB * 0.05],
      [rB, hB * 0.84],
      [rB * 1.06, hB * 0.91],
      [rB * 1.04, hB * 0.96],
      [rB * 0.95, hB * 0.93],
    ],
    SEG,
    [xB, 0, zB],
    MAT.tin,
    true,
    { smooth: true },
  );
  const lidB = cylinder(rB * 0.94, rB * 0.92, hB * 0.04, SEG, [xB, hB * 0.88, zB], MAT.tin, { smooth: true });

  const label = (r: number, hh: number, c: [number, number, number]): MeshData[] => {
    if (t?.hero) {
      const front = cylinder(r, r, hh, SEG, c, texturedMaterial('tin-label-photo', t.hero, { roughness: 0.6 }), {
        uv: 'cylindrical',
        arc: FRONT,
        smooth: true,
        caps: false,
      });
      const back = cylinder(r, r, hh, SEG, c, tintedMaterial('tin-label-back', t.hero.mean, { roughness: 0.6 }), { arc: BACK, smooth: true, caps: false });
      return [front, back];
    }
    return [cylinder(r, r, hh, SEG, c, MAT.tinLabel, { smooth: true })];
  };
  const labelA = label(rA * 1.006, hA * 0.5, [xA, hA * 0.2, 0]);
  const labelB = label(rB * 1.008, hB * 0.46, [xB, hB * 0.2, zB]);
  return {
    meshes: [bodyA, lidA, ...bail, ...lugs, ...labelA, bodyB, lidB, ...labelB],
    variant: 'two-part-kit',
    textured: !!t?.hero,
    textureNote: t?.hero ? 'label wrap = hero cut-out on the front half of each tin' : undefined,
  };
};

/**
 * Total station — THE INSTRUMENT, and not the tripod under it.
 *
 * It used to build a 1.6 m survey tripod with the instrument on top, and that is wrong twice
 * over. `dims_mm` for a GM-52 is 183 x 348 x 181: the instrument. The mesh came out 1.00 x 1.92
 * x 0.87, so the AR view — which scales a model to the SKU's real dimensions — squashed the whole
 * tripod down to 348 mm and left the instrument about 63 mm tall. The AR audit sees that as a
 * product covering 1014 px when it claims to be on screen, and fails it.
 *
 * And the tripod is already accounted for: PLACEMENT_RULES['total-stations'] carries
 * `mountOffsetMm: 1500`, which is the engine's way of standing it at working height. A tripod in
 * the mesh AS WELL puts the instrument at three metres.
 *
 * The other two total stations in the catalogue are supplied models of the instrument alone, at
 * 0.35 m. This now matches them, which is the other half of the argument: one category should
 * not be two different objects at two different scales depending on which model won.
 */
const totalStation: Builder = ({ w, h, d }) => {
  const bodyW = Math.max(w, 0.12),
    bodyH = Math.max(h, 0.2),
    bodyD = Math.max(d, 0.12);
  /* Tribrach: the levelling base it clamps to a tripod head by, three footscrews under it. */
  const tribrachH = bodyH * 0.15;
  const tribrach = lathe(
    [
      [bodyW * 0.34, 0],
      [bodyW * 0.4, tribrachH * 0.35],
      [bodyW * 0.36, tribrachH],
    ],
    24,
    [0, 0, 0],
    MAT.instrumentDark,
    true,
    { smooth: true },
  );
  const screws: MeshData[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    screws.push(cylinder(0.008, 0.009, tribrachH * 0.8, 12, [Math.cos(a) * bodyW * 0.3, 0, Math.sin(a) * bodyW * 0.3], MAT.bracketSteel, { smooth: true }));
  }
  /* Alidade: the part that turns. A round lower body, two standards, the telescope between. */
  const baseY = tribrachH;
  const lowerH = bodyH * 0.24;
  const lower = lathe(
    [
      [bodyW * 0.42, 0],
      [bodyW * 0.46, lowerH * 0.4],
      [bodyW * 0.44, lowerH],
    ],
    28,
    [0, baseY, 0],
    MAT.instrument,
    false,
    { smooth: true },
  );
  const standY = baseY + lowerH;
  const standH = bodyH * 0.46;
  const standL = box(bodyW * 0.26, standH, bodyD * 0.55, [-bodyW * 0.32, standY + standH / 2, 0], MAT.instrument);
  const standR = box(bodyW * 0.26, standH, bodyD * 0.55, [bodyW * 0.32, standY + standH / 2, 0], MAT.instrument);
  /* The telescope: a horizontal barrel on the trunnion axis, objective facing +Z. */
  const telY = standY + standH * 0.62;
  const telR = Math.min(bodyW * 0.17, standH * 0.3);
  /* CENTRED ON THE TRUNNION AXIS, not hung off the front of it. A cylinder turned onto Z spans
     [0, len], so translating it by +len/2 pushed the whole barrel forward and took the model's
     depth to 348 mm against a declared 181 — and depth is one of the three numbers the AR view
     scales by. Centred, the barrel is where a telescope is: through the standards. */
  const telLen = bodyD * 0.9;
  const telescope = translate(rotate(cylinder(telR, telR, telLen, 24, [0, 0, 0], MAT.instrumentDark, { smooth: true }), 'x', Math.PI / 2), [
    0,
    telY,
    -telLen / 2,
  ]);
  const objective = translate(rotate(cylinder(telR * 0.94, telR * 0.94, 0.004, 24, [0, 0, 0], MAT.lensGlass), 'x', Math.PI / 2), [0, telY, telLen / 2]);
  const eyeLen = bodyD * 0.12;
  const eyepiece = translate(rotate(cylinder(telR * 0.5, telR * 0.42, eyeLen, 16, [0, 0, 0], MAT.instrumentDark, { smooth: true }), 'x', Math.PI / 2), [
    0,
    telY,
    -telLen / 2 - eyeLen,
  ]);
  /* Keypad and display, tilted back on the front of the near standard — the face an operator reads. */
  const keypad = rotate(box(bodyW * 0.62, standH * 0.62, 0.01, [0, standY + standH * 0.42, bodyD * 0.29], MAT.instrumentDark), 'x', -0.22, [
    0,
    standY + standH * 0.42,
    bodyD * 0.29,
  ]);
  const display = rotate(box(bodyW * 0.5, standH * 0.26, 0.003, [0, standY + standH * 0.55, bodyD * 0.3], MAT.displayGlass), 'x', -0.22, [
    0,
    standY + standH * 0.42,
    bodyD * 0.29,
  ]);
  /* Carrying handle across the top, which is most of the silhouette from a distance. */
  const handleY = standY + standH;
  const handle = box(bodyW * 0.5, 0.014, bodyD * 0.16, [0, handleY + bodyH * 0.1, 0], MAT.instrumentDark);
  const posts = [
    box(0.014, bodyH * 0.1, bodyD * 0.16, [-bodyW * 0.24, handleY + bodyH * 0.05, 0], MAT.instrumentDark),
    box(0.014, bodyH * 0.1, bodyD * 0.16, [bodyW * 0.24, handleY + bodyH * 0.05, 0], MAT.instrumentDark),
  ];
  return {
    meshes: [tribrach, ...screws, lower, standL, standR, telescope, objective, eyepiece, keypad, display, handle, ...posts],
    variant: 'instrument',
    textured: false,
  };
};

/** The spec's gate demo product. A bathtub: 1700 × 750 × 600 mm tub with a rim. */
const bathtub: Builder = ({ w, h, d }) => {
  const outer = box(w, h, d, [0, h / 2, 0], MAT.whitePlastic);
  const rim = box(w * 1.04, 0.02, d * 1.06, [0, h, 0], MAT.whitePlastic);
  const basin = box(w * 0.84, h * 0.8, d * 0.7, [0, h * 0.62, 0], MAT.glassPane);
  return { meshes: [outer, rim, basin], variant: 'tub', textured: false };
};

const generic: Builder = ({ w, h, d }) => ({ meshes: [box(w, h, d, [0, h / 2, 0], MAT.paper)], variant: 'box', textured: false });

export const BUILDERS: Record<string, Builder> = {
  bulbs: bulb,
  cctv,
  tiles,
  glass,
  'solar-panels': solar,
  'fire-extinguishers': extinguisher,
  cement,
  epoxy,
  'total-stations': totalStation,
  bathtub,
  generic,
};

/** Sensible real-world defaults when a SKU has no dim_* attributes yet (mm). */
export const DEFAULT_DIMS_MM: Record<string, { w: number; h: number; d: number }> = {
  bulbs: { w: 60, h: 110, d: 60 },
  cctv: { w: 110, h: 85, d: 110 },
  tiles: { w: 600, h: 1200, d: 9 },
  glass: { w: 1200, h: 1800, d: 6 },
  'solar-panels': { w: 1134, h: 2278, d: 35 },
  'fire-extinguishers': { w: 140, h: 460, d: 190 },
  cement: { w: 520, h: 760, d: 120 },
  epoxy: { w: 180, h: 200, d: 180 },
  'total-stations': { w: 200, h: 350, d: 180 },
  bathtub: { w: 1700, h: 600, d: 750 },
  generic: { w: 300, h: 300, d: 300 },
};

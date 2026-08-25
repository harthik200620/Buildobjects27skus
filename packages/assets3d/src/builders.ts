/**
 * Honest parametric models per category. Every model is built at the SKU's real dimensions
 * (dim_w_mm × dim_h_mm × dim_d_mm from the spec attributes), standing on y = 0 and centred on
 * x / z, front facing +Z, with brand-appropriate materials. When the image stage has produced
 * photo cut-outs they are mapped onto the model (`textured: true`):
 *
 *   cement             front / back faces = hero / angle cut-outs, sides = mean colour
 *   tiles              top face = the tile face
 *   solar-panels       cell face = hero
 *   epoxy              label wrap on the front half of each tin (u ∈ [0.25, 0.75])
 *   fire-extinguishers label band = middle band of the hero, wrapped on the front half
 *   glass              tint = mean colour of the photo (alpha 0.35)
 *   cctv               body colour = mean colour of the photo
 *   bulbs, total stations, bathtub, generic — unchanged (emissive / flat colours)
 *
 * A real GLB dropped in as assets/3d/{SKU_CODE}.glb replaces any of them with no code change.
 */
import type { MeshData } from './gltf';
import { box, boxFaces, cylinder, dome, lathe, MAT, ring, rotate, texturedMaterial, tintedMaterial, translate } from './shapes';
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

/** CCTV: dome (base ring + smoked hemisphere) or bullet (cylinder body + lens ring + bracket). Body colour from the photo. */
/** CCTV: dome (base ring + smoked hemisphere + mount ring) or bullet (cylinder body + lens ring + swivel wall bracket). Body colour from the photo. */
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
  const r = w / 2,
    baseH = Math.max(0.02, h * 0.32);
  const mountRing = cylinder(r * 1.08, r * 1.08, 0.006, SEG, [0, 0, 0], MAT.bracketSteel);
  const base = cylinder(r, r * 0.97, baseH, SEG, [0, 0.006, 0], bodyMat, { smooth: true });
  const trim = ring(r * 0.97, r * 0.8, 0.004, SEG, [0, baseH + 0.006, 0], MAT.blackPlastic);
  const bubble = dome(Math.min(r * 0.8, h - baseH), SEG, [0, baseH + 0.006, 0], MAT.smokedDome, 0.5, 12, { smooth: true });
  const lens = dome(r * 0.22, 24, [0, baseH + 0.01, 0], MAT.lensGlass, 0.5, 6, { smooth: true });
  return { meshes: [mountRing, base, trim, bubble, lens], variant: 'dome', textured, textureNote };
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

/** Cement bag lying flat: a pillow-ish box; the printed face (top when flat) wears the hero, the underside the angle shot. */
const cement: Builder = ({ w, h, d }, { textures: t }) => {
  if (t?.hero) {
    const sides = tintedMaterial('bag-side', t.mean ?? t.hero.mean, { roughness: 0.9 });
    const faces = boxFaces(
      w,
      d,
      h,
      [0, d / 2, 0],
      {
        top: texturedMaterial('bag-front', t.hero, { roughness: 0.85 }),
        bottom: texturedMaterial('bag-back', t.angle ?? t.hero, { roughness: 0.85 }),
        rest: sides,
      },
      'all',
    );
    return {
      meshes: faces,
      variant: 'bag-flat',
      textured: true,
      textureNote: `printed face = hero cut-out, underside = ${t.angle ? 'angle cut-out' : 'hero cut-out'}, sides = mean colour`,
    };
  }
  const bag = box(w, d, h, [0, d / 2, 0], MAT.paper); // lying flat: height = thickness (d)
  const band = box(w * 1.002, d * 0.45, h * 0.3, [0, d / 2, 0], MAT.label);
  const topFold = box(w * 0.96, d * 0.12, 0.02, [0, d * 0.55, h / 2 - 0.012], MAT.paper);
  return { meshes: [bag, band, topFold], variant: 'bag-flat', textured: false };
};

/** Epoxy kit: a part-A tin with a lid and a smaller part-B tin beside it, plus applicator tool. */
const epoxy: Builder = ({ w, h, d }, { textures: t }) => {
  const rA = (Math.min(w, d) / 2) * 0.62,
    hA = h;
  const tinA = cylinder(rA, rA, hA * 0.93, SEG, [-rA * 0.55, 0, 0], MAT.tin, { smooth: true });
  const lidA = cylinder(rA * 1.03, rA * 1.03, hA * 0.07, SEG, [-rA * 0.55, hA * 0.93, 0], MAT.tin, { smooth: true });
  const rB = rA * 0.55,
    hB = hA * 0.6;
  const tinB = cylinder(rB, rB, hB * 0.92, SEG, [rA * 0.95, 0, rA * 0.1], MAT.tin, { smooth: true });
  const lidB = cylinder(rB * 1.03, rB * 1.03, hB * 0.08, SEG, [rA * 0.95, hB * 0.92, rA * 0.1], MAT.tin, { smooth: true });
  const spatula = box(0.025, 0.004, 0.14, [rA * 0.35, 0.002, rA * 0.8], MAT.blackPlastic);
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
  const labelA = label(rA * 1.004, hA * 0.45, [-rA * 0.55, hA * 0.25, 0]);
  const labelB = label(rB * 1.004, hB * 0.4, [rA * 0.95, hB * 0.25, rA * 0.1]);
  return {
    meshes: [tinA, lidA, ...labelA, tinB, lidB, ...labelB, spatula],
    variant: 'two-part-kit',
    textured: !!t?.hero,
    textureNote: t?.hero ? 'label wrap = hero cut-out on the front half of each tin' : undefined,
  };
};

/** Total station on a survey tripod at working height (~1.5 m): 3 aluminum legs with shoes, head plate, tribrach, optical scope. */
const totalStation: Builder = ({ w, h, d }) => {
  const tripodH = 1.45,
    legLen = 1.62,
    legR = 0.016,
    spread = 0.55;
  const legs: MeshData[] = [];
  const shoes: MeshData[] = [];
  const clamps: MeshData[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cylinder(legR, legR * 0.8, legLen, 12, [0, 0, 0], MAT.tripodLeg, { smooth: true });
    const tilt = Math.asin(spread / legLen);
    const tilted = rotate(leg, 'x', -tilt, [0, 0, 0]);
    legs.push(translate(rotate(tilted, 'y', a, [0, 0, 0]), [0, 0, 0]));

    // Steel point shoes on the floor
    const shoe = cylinder(0.024, 0.005, 0.06, 12, [-Math.sin(a) * spread, 0, -Math.cos(a) * spread], MAT.tripodShoe);
    shoes.push(shoe);

    // Leg quick-clamp lock
    const clamp = box(0.04, 0.03, 0.04, [-Math.sin(a) * spread * 0.5, tripodH * 0.5, -Math.cos(a) * spread * 0.5], MAT.instrumentDark);
    clamps.push(clamp);
  }
  const placed = legs.map((l, i) => {
    const a = (i / 3) * Math.PI * 2;
    return translate(l, [-Math.sin(a) * spread, 0, -Math.cos(a) * spread]);
  });
  const head = cylinder(0.09, 0.09, 0.035, 24, [0, tripodH, 0], MAT.instrumentDark);
  const tribrach = box(0.13, 0.03, 0.13, [0, tripodH + 0.05, 0], MAT.instrumentDark);
  const base = cylinder(0.07, 0.075, 0.05, 24, [0, tripodH + 0.065, 0], MAT.instrument);
  const bodyW = Math.max(w, 0.16),
    bodyH = Math.max(h, 0.22),
    bodyD = Math.max(d, 0.14);
  const standL = box(bodyW * 0.22, bodyH * 0.7, bodyD * 0.6, [-bodyW * 0.39, tripodH + 0.115 + bodyH * 0.35, 0], MAT.instrument);
  const standR = box(bodyW * 0.22, bodyH * 0.7, bodyD * 0.6, [bodyW * 0.39, tripodH + 0.115 + bodyH * 0.35, 0], MAT.instrument);
  const keyboard = rotate(box(bodyW * 0.55, bodyH * 0.3, 0.012, [0, tripodH + 0.115 + bodyH * 0.2, bodyD * 0.35], MAT.instrumentDark), 'x', -0.35, [
    0,
    tripodH + 0.115 + bodyH * 0.05,
    bodyD * 0.35,
  ]);
  const telescope = translate(rotate(cylinder(0.03, 0.03, bodyD * 1.1, 24, [0, 0, 0], MAT.instrumentDark), 'x', Math.PI / 2, [0, 0, 0]), [
    0,
    tripodH + 0.115 + bodyH * 0.55,
    bodyD * 0.55,
  ]);
  const objective = translate(rotate(cylinder(0.031, 0.031, 0.004, 24, [0, 0, 0], MAT.lensGlass), 'x', Math.PI / 2, [0, 0, 0]), [
    0,
    tripodH + 0.115 + bodyH * 0.55,
    bodyD * 0.55 + 0.002,
  ]);
  const handle = box(bodyW * 0.7, 0.014, 0.02, [0, tripodH + 0.115 + bodyH * 0.78, 0], MAT.instrumentDark);
  const handlePosts = [
    box(0.012, bodyH * 0.1, 0.02, [-bodyW * 0.3, tripodH + 0.115 + bodyH * 0.73, 0], MAT.instrumentDark),
    box(0.012, bodyH * 0.1, 0.02, [bodyW * 0.3, tripodH + 0.115 + bodyH * 0.73, 0], MAT.instrumentDark),
  ];
  return {
    meshes: [...placed, ...shoes, ...clamps, head, tribrach, base, standL, standR, keyboard, telescope, objective, handle, ...handlePosts],
    variant: 'on-tripod',
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

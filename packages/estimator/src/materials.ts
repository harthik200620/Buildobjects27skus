/**
 * What the money physically is.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────
 * "₹34,16,796" is an abstraction. Four hundred and thirty tipper-loads of sand is not. The
 * engine already computes every quantity; this turns those quantities into real objects at real
 * dimensions so the MATTER lens can stand them on the plot beside the house.
 *
 * ── THE ONE RULE: TRUE SCALE, ALWAYS ────────────────────────────────────────────────────────
 * Nothing here is exaggerated for drama and nothing is shrunk to fit the frame. Some piles come
 * out startlingly large — the sand for a 1,800 sqft house is several lorry-loads and it dwarfs
 * the house's footprint. Some come out startlingly small — twelve tonnes of TMT steel is a cube
 * 1.15 m on a side, which fits in a corner of a bedroom. BOTH DIRECTIONS ARE THE POINT. A buyer
 * who watches this and then stands next to the real delivery has to find that it matches, or
 * everything else this store says about honesty is worth nothing.
 *
 * ── SOURCES ─────────────────────────────────────────────────────────────────────────────────
 * Densities are handbook values (IS 875 Part 1 for building material unit weights). Unit sizes
 * are the Indian standard trade sizes the rate pack already prices against: the 50 kg cement bag,
 * the 230 × 110 × 70 mm modular brick (IS 1077), 12 m TMT lengths, 600 × 600 vitrified tile in
 * boxes of four. The tipper is the AP/TS 300 cft lorry; sand and aggregate are also sold by the
 * "unit" of 100 cft, which is how a buyer will hear it quoted at the counter.
 */
import type { EstimateResult, LineItem } from './types';

/** 1 cubic foot in cubic metres. Every cft quantity in the engine passes through this. */
export const CFT_TO_CUM = 0.0283168;
/** The AP/TS lorry load, and the counter unit sand is quoted in. */
export const TIPPER_CFT = 300;
export const SAND_UNIT_CFT = 100;

export type PileShape =
  /** Discrete pieces in a rectangular stack: bags, bricks, boxes, drums. */
  | 'stack'
  /** Poured on the ground and finding its own angle of repose: sand, aggregate. */
  | 'heap'
  /** Long pieces laid in a bundle: steel bars. */
  | 'bundle'
  /** Sheets on edge in a crate: glass, doors. */
  | 'crate';

/** One physical piece, at the size it actually arrives in. Metres. */
export interface PieceSize {
  l: number;
  w: number;
  h: number;
}

export interface MaterialSpec {
  /** Line key from the engine. */
  key: string;
  shape: PileShape;
  /** The size of one piece as delivered. Absent for bulk material, which has no piece. */
  piece?: PieceSize;
  /** kg per m³ of the material itself (steel) or of the delivered bulk (sand, aggregate). */
  densityKgPerCum?: number;
  /** How the engine's quantity converts to cubic metres of delivered volume. */
  cumPer: (qty: number) => number;
  /** How many pieces the engine's quantity is. Bulk material returns null. */
  piecesPer: (qty: number) => number | null;
  /** Highest a site will stack it, in pieces. Beyond this it spreads sideways. */
  maxStackHigh?: number;
  /** The angle of repose, degrees — what makes a sand heap a cone and not a cylinder. */
  reposeDeg?: number;
  basis: string;
}

/**
 * Paint is the one line whose quantity is an AREA and whose delivery is a VOLUME, so it needs a
 * spreading rate to get from one to the other. Emulsion covers 110–130 sqft per litre per coat;
 * the engine's area is a single-coat surface and the rate card prices two coats plus primer.
 */
const PAINT_SQFT_PER_L = 120;
const PAINT_COATS = 2;
const PAINT_DRUM_L = 20;

const spec = (s: MaterialSpec) => s;

export const MATERIALS: MaterialSpec[] = [
  spec({
    key: 'cement',
    shape: 'stack',
    /* A 50 kg bag laid flat settles to about this. Loose powder is denser than the laid bag
       because the bag is never full to its seams. */
    piece: { l: 0.8, w: 0.5, h: 0.18 },
    densityKgPerCum: 1440,
    cumPer: (bags) => bags * 0.8 * 0.5 * 0.18,
    piecesPer: (bags) => Math.round(bags),
    /* Ten bags is the site maximum — higher and the bottom bags set under their own weight. */
    maxStackHigh: 10,
    basis: '50 kg OPC/PPC bag, laid 0.80 × 0.50 × 0.18 m; site stacks capped at 10 high',
  }),
  spec({
    key: 'steel',
    shape: 'bundle',
    /* Not a piece size — a 12 m bar. The bundle's cross-section is derived from the volume. */
    piece: { l: 12, w: 0.012, h: 0.012 },
    densityKgPerCum: 7850,
    cumPer: (kg) => kg / 7850,
    piecesPer: (kg) => Math.round(kg / (12 * 0.888)),
    basis: 'Fe500 TMT at 7,850 kg/m³, 12 m lengths; piece count at 12 mm nominal (0.888 kg/m)',
  }),
  spec({
    key: 'bricks',
    shape: 'stack',
    piece: { l: 0.23, w: 0.11, h: 0.07 },
    densityKgPerCum: 1800,
    cumPer: (nos) => nos * 0.23 * 0.11 * 0.07,
    piecesPer: (nos) => Math.round(nos),
    maxStackHigh: 20,
    basis: 'IS 1077 modular brick 230 × 110 × 70 mm; site stacks 20 courses high',
  }),
  spec({
    key: 'sand',
    shape: 'heap',
    densityKgPerCum: 1600,
    cumPer: (cft) => cft * CFT_TO_CUM,
    piecesPer: () => null,
    reposeDeg: 34,
    basis: 'river/M-sand at 1,600 kg/m³ bulk, 34° angle of repose; quoted in units of 100 cft',
  }),
  spec({
    key: 'aggregate',
    shape: 'heap',
    densityKgPerCum: 1500,
    cumPer: (cft) => cft * CFT_TO_CUM,
    piecesPer: () => null,
    reposeDeg: 38,
    basis: '20 mm crushed aggregate at 1,500 kg/m³ bulk, 38° angle of repose',
  }),
  spec({
    key: 'floor_tiles',
    shape: 'stack',
    /* A box of four 600 × 600 tiles. */
    piece: { l: 0.62, w: 0.62, h: 0.05 },
    cumPer: (sqft) => (sqft / 15.5) * 0.62 * 0.62 * 0.05,
    piecesPer: (sqft) => Math.ceil(sqft / 15.5),
    maxStackHigh: 12,
    basis: '600 × 600 vitrified tile, 4 per box = 15.5 sqft; boxes stacked 12 high',
  }),
  spec({
    key: 'wall_tiles',
    shape: 'stack',
    piece: { l: 0.62, w: 0.32, h: 0.05 },
    cumPer: (sqft) => (sqft / 12.9) * 0.62 * 0.32 * 0.05,
    piecesPer: (sqft) => Math.ceil(sqft / 12.9),
    maxStackHigh: 12,
    basis: '600 × 300 wall tile, 6 per box = 12.9 sqft',
  }),
  spec({
    key: 'int_paint',
    shape: 'stack',
    /* A 20 litre emulsion drum. */
    piece: { l: 0.3, w: 0.3, h: 0.37 },
    cumPer: (sqft) => paintDrums(sqft) * 0.3 * 0.3 * 0.37,
    piecesPer: (sqft) => paintDrums(sqft),
    maxStackHigh: 4,
    basis: `interior emulsion at ${PAINT_SQFT_PER_L} sqft/L/coat × ${PAINT_COATS} coats, in ${PAINT_DRUM_L} L drums`,
  }),
  spec({
    key: 'ext_paint',
    shape: 'stack',
    piece: { l: 0.3, w: 0.3, h: 0.37 },
    cumPer: (sqft) => paintDrums(sqft) * 0.3 * 0.3 * 0.37,
    piecesPer: (sqft) => paintDrums(sqft),
    maxStackHigh: 4,
    basis: `exterior emulsion at ${PAINT_SQFT_PER_L} sqft/L/coat × ${PAINT_COATS} coats, in ${PAINT_DRUM_L} L drums`,
  }),
  spec({
    key: 'window_glass',
    shape: 'crate',
    piece: { l: 1.2, w: 0.006, h: 1.5 },
    densityKgPerCum: 2500,
    cumPer: (sqft) => sqft * 0.0929 * 0.006,
    piecesPer: (sqft) => Math.ceil(sqft / 19.4),
    basis: '5–6 mm float glass at 2,500 kg/m³, cut to 1.2 × 1.5 m sheets (19.4 sqft) in edge crates',
  }),
  spec({
    key: 'doors',
    shape: 'crate',
    piece: { l: 2.1, w: 0.05, h: 0.9 },
    cumPer: (nos) => nos * 2.1 * 0.05 * 0.9,
    piecesPer: (nos) => Math.round(nos),
    maxStackHigh: 12,
    basis: 'flush door leaf 2,100 × 900 × 40 mm with frame, stacked flat',
  }),
];

function paintDrums(sqft: number): number {
  return Math.ceil((sqft * PAINT_COATS) / PAINT_SQFT_PER_L / PAINT_DRUM_L);
}

const BY_KEY = new Map(MATERIALS.map((m) => [m.key, m]));

/** The footprint a stack of `n` pieces occupies when it is built no higher than the site allows. */
function stackFootprint(piece: PieceSize, n: number, maxHigh: number) {
  const layers = Math.min(maxHigh, Math.max(1, Math.ceil(Math.sqrt(n / 4))));
  const perLayer = Math.ceil(n / layers);
  /* Square-ish in plan, because that is how a site stacks when it is not against a wall. */
  const cols = Math.max(1, Math.round(Math.sqrt((perLayer * piece.w) / piece.l)));
  const rows = Math.ceil(perLayer / cols);
  return { rows, cols, layers, l: cols * piece.l, w: rows * piece.w, h: layers * piece.h };
}

/** A cone of bulk material at its own angle of repose: the base radius for a given volume. */
function heapRadius(cum: number, reposeDeg: number) {
  const tan = Math.tan((reposeDeg * Math.PI) / 180);
  /* V = (1/3)·π·r²·h and h = r·tan(θ) → r = cbrt(3V / (π·tanθ)) */
  return Math.cbrt((3 * cum) / (Math.PI * tan));
}

export interface MaterialPile {
  key: string;
  label: string;
  /** The engine's own quantity and unit, unchanged. */
  qty: number;
  unit: string;
  amount: number;
  shape: PileShape;
  /** Delivered volume, m³. The number every comparison below is derived from. */
  cum: number;
  /** Mass in kg where a density is known. */
  kg: number | null;
  /** Discrete pieces, or null for bulk. */
  pieces: number | null;
  piece?: PieceSize;
  /** Bounding box of the pile as it would stand on the plot, metres. */
  box: { l: number; w: number; h: number };
  /** For a heap: base radius and cone height. */
  heap?: { radius: number; height: number };
  /** For a stack: the instancing grid, so the renderer draws one mesh and not sixty thousand. */
  grid?: { rows: number; cols: number; layers: number };
  /** Lorry loads at the AP/TS 300 cft tipper — the unit a buyer will actually be quoted. */
  tipperLoads: number | null;
  /** The side of a cube of the same volume. This is what makes twelve tonnes of steel legible. */
  cubeSideM: number;
  basis: string;
}

/**
 * Turn an estimate into the physical things it buys.
 *
 * Only lines with a real delivered quantity appear. Labour, formwork hire, plumbing rough-in and
 * every per-sqft service line have no object to stand on the plot and are deliberately absent —
 * showing a "pile of plumbing" would be the exaggeration this file exists to refuse.
 */
export function materialise(result: EstimateResult): MaterialPile[] {
  const piles: MaterialPile[] = [];
  for (const line of result.lines) {
    const m = BY_KEY.get(line.key);
    if (!m || line.qty <= 0) continue;
    const cum = m.cumPer(line.qty);
    if (cum <= 0) continue;
    const pieces = m.piecesPer(line.qty);
    const kg = m.densityKgPerCum ? Math.round(cum * m.densityKgPerCum) : null;

    let box: { l: number; w: number; h: number };
    let grid: MaterialPile['grid'];
    let heap: MaterialPile['heap'];
    if (m.shape === 'heap') {
      const r = heapRadius(cum, m.reposeDeg ?? 35);
      heap = { radius: r, height: r * Math.tan(((m.reposeDeg ?? 35) * Math.PI) / 180) };
      box = { l: r * 2, w: r * 2, h: heap.height };
    } else if (m.shape === 'bundle' && m.piece) {
      /* A bundle is as long as the bar and as thick as the volume makes it. */
      const side = Math.sqrt(cum / m.piece.l);
      box = { l: m.piece.l, w: side, h: side };
    } else if (m.piece) {
      const f = stackFootprint(m.piece, pieces ?? 1, m.maxStackHigh ?? 10);
      grid = { rows: f.rows, cols: f.cols, layers: f.layers };
      box = { l: f.l, w: f.w, h: f.h };
    } else {
      const s = Math.cbrt(cum);
      box = { l: s, w: s, h: s };
    }

    piles.push({
      key: line.key,
      label: line.label,
      qty: line.qty,
      unit: line.unit,
      amount: line.amount,
      shape: m.shape,
      cum: Math.round(cum * 1000) / 1000,
      kg,
      pieces,
      piece: m.piece,
      box: { l: round2(box.l), w: round2(box.w), h: round2(box.h) },
      heap: heap ? { radius: round2(heap.radius), height: round2(heap.height) } : undefined,
      grid,
      tipperLoads: m.shape === 'heap' ? Math.round((cum / (TIPPER_CFT * CFT_TO_CUM)) * 10) / 10 : null,
      cubeSideM: round2(Math.cbrt(cum)),
      basis: m.basis,
    });
  }
  return piles.sort((a, b) => b.cum - a.cum);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which lines have a physical form at all. Used by the UI to decide what MATTER can show. */
export function isPhysical(line: LineItem): boolean {
  return BY_KEY.has(line.key);
}

/** A 5' 6" adult, in metres. Present on the plot in MATTER so the scale means something. */
export const HUMAN_HEIGHT_M = 1.676;

/**
 * Is the quote you were given fair? Maps a quotation's lines onto the engine's line keys and says
 * where each sits against a rate card that states its version, city index and basis.
 *
 * Four rules, none negotiable:
 *
 *  1. NEVER ACCUSE ANYONE. "22% above our rate for Hyderabad, Aug 2026", with the rate cited —
 *     never "your contractor is cheating you". We have not seen the site, the specification or
 *     the terms, and a contractor may be dearer for a dozen legitimate reasons.
 *  2. A LINE BELOW THE RANGE IS FLAGGED HARDER THAN ONE ABOVE. An over-quote costs money; an
 *     under-quote is how a build stalls at month nine with the slab cast and the money gone.
 *  3. UNMATCHABLE LINES ARE LISTED, NEVER DROPPED — omission is how a comparison becomes a lie.
 *  4. EVERY COMPARISON CARRIES ITS RATE-PACK VERSION AND CITY INDEX, so the buyer can argue with
 *     it. An unarguable number is just another person to trust.
 *
 * A contractor's quotation is a private commercial document. Nothing here persists it.
 */
import { estimate } from './estimate';
import type { CatalogPrices, EstimateInputs, EstimateResult, LineItem, Tier } from './types';
import { TIERS } from './types';

/** One line as it appears on a contractor's quotation, however it arrived — typed, pasted or read. */
export interface QuotedLine {
  /**
   * Which line of the pasted document this was. A quotation can carry two identical labels — two
   * "Extra work" rows is normal — so the position in the document is the only stable identity a
   * line has, and it is worth showing back to the buyer as well.
   */
  line: number;
  /**
   * The contractor's own words for the work, with the row's own figures taken off the end.
   *
   * "Cement 720 bags 600 4,32,000" is a label of "Cement", not of "Cement 720 bags 600" — the
   * quantity, the rate and the amount are all carried in their own fields on this same object,
   * and leaving them in the description as well printed them twice on every row. Descriptive
   * numbers stay: "600×600 GVT tiles" and "M20 concrete" keep theirs, because those are the
   * name of the thing rather than a count of it.
   */
  label: string;
  qty?: number | null;
  unit?: string | null;
  rate?: number | null;
  amount: number;
  /** 0–1 when a reader extracted it rather than the buyer typing it. */
  confidence?: number;
}

export type QuoteVerdict = 'within' | 'above' | 'below' | 'unmatchable';

/**
 * The same line, bought from the store instead — the only part of the comparison that is not an
 * opinion. A rate card is a published average a contractor can honestly disagree with; this is
 * the price the store sells that exact material for today, which is arithmetic the buyer can act
 * on.
 *
 * A line whose engine rate came from a thumb rule (`rateSource: 'seed'`) is left alone — labour,
 * centering, plastering: the store has no price and inventing one is worse than silence. The
 * saving at the top of the card is always a floor, never a claim about the whole quotation.
 */
export interface StoreReprice {
  sku_code: string;
  skuName: string;
  /** The unit both sides are being compared in. */
  unit: string;
  /**
   * What the store charges for one of them, today — UNROUNDED.
   *
   * Rounding it here printed ₹75 a square foot beside 1,200 sqft and a total of ₹89,808, which
   * is 1,200 × 74.84 and does not multiply out to anything the reader can check. A rate a reader
   * cannot multiply is worse than a rate with two decimals in it, so the caller rounds for
   * display only when there is nothing after the point.
   */
  storeRate: number;
  /** What the quotation works out to for one of them, when the document says enough to know. */
  quotedRate: number | null;
  qty: number;
  /**
   * Whose quantity was used.
   *
   * `quote` when the document states a quantity in a unit that agrees with ours — then this
   * really is the same shopping list at two prices. `estimate` when it does not, and the
   * quantity is the one this house works out at. Which one it used is printed beside the
   * figure, because the two answer different questions and conflating them would be a lie.
   */
  qtySource: 'quote' | 'estimate';
  storeAmount: number;
  /** quoted − store. Positive means the store is cheaper by this much. */
  saving: number;
}

/** Something about a quantity that is worth a second look, in the buyer's language. */
export interface QuoteFlag {
  kind: 'unit' | 'quantity' | 'ratio';
  /** The line it is about, or null when it is about the quotation as a whole. */
  line: number | null;
  message: string;
}

export interface QuoteMatch {
  quoted: QuotedLine;
  /** The engine line it mapped to, or null. */
  lineKey: string | null;
  lineLabel: string | null;
  /** What the same work costs across the three finish levels — the honest span, not one number. */
  range: { low: number; likely: number; high: number } | null;
  verdict: QuoteVerdict;
  /** Signed share against the nearer edge of the range. +0.22 = 22 % above the top of it. */
  delta: number | null;
  /** One sentence, in the buyer's language, with the rate cited. Never an accusation. */
  note: string;
  /** How the label was matched, so a wrong match is visible rather than silent. */
  matchedOn: string | null;
  /** The same line at the store's own price, when the store sells the thing. */
  store: StoreReprice | null;
  /** Unit and quantity checks on this line. */
  flags: QuoteFlag[];
}

export interface QuoteComparison {
  matches: QuoteMatch[];
  quotedTotal: number;
  /** The engine's total for the same house at the buyer's chosen tier. */
  estimateTotal: number;
  /** Only the lines that matched, summed both ways — the only honest total-to-total comparison. */
  matchedQuotedTotal: number;
  matchedEstimateTotal: number;
  counts: Record<QuoteVerdict, number>;
  /**
   * Only the lines the store can actually price, summed both ways. `saved` is the honest floor
   * of what buying the material here would take off this quotation — it says nothing at all
   * about the lines the store does not sell.
   */
  store: { lines: number; quotedTotal: number; storeTotal: number; saved: number };
  /** Checks that need more than one line to make — cement against steel, and each against this house. */
  flags: QuoteFlag[];
  /** Everything the reader needs to print beside the comparison. */
  citation: { version: string; city: string; cityIndex: number; tier: Tier };
}

/* ── UNITS ────────────────────────────────────────────────────────────────────────────────────
   A rate is only comparable to another rate in the same unit, so nothing is compared until both
   sides normalise to the same word. Everything a person writes on an Indian quotation is here;
   anything else normalises to null and the line falls back to our own quantity. */
const UNIT_ALIASES: Record<string, string> = {
  bag: 'bag',
  bags: 'bag',
  bori: 'bag',
  boriya: 'bag',
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  ton: 'ton',
  tons: 'ton',
  tonne: 'ton',
  tonnes: 'ton',
  mt: 'ton',
  no: 'nos',
  nos: 'nos',
  number: 'nos',
  numbers: 'nos',
  pcs: 'nos',
  pc: 'nos',
  piece: 'nos',
  pieces: 'nos',
  each: 'nos',
  qty: 'nos',
  panel: 'nos',
  panels: 'nos',
  unit: 'nos',
  units: 'nos',
  set: 'nos',
  sets: 'nos',
  door: 'nos',
  doors: 'nos',
  window: 'nos',
  windows: 'nos',
  sqft: 'sqft',
  sft: 'sqft',
  sqfeet: 'sqft',
  sq: 'sqft',
  'sq ft': 'sqft',
  'square feet': 'sqft',
  cft: 'cft',
  cuft: 'cft',
  'cu ft': 'cft',
  'cubic feet': 'cft',
  cum: 'cum',
  'cu m': 'cum',
  m3: 'cum',
  'cubic metre': 'cum',
  rft: 'rft',
  rmt: 'rft',
  rm: 'rft',
  running: 'rft',
  litre: 'litre',
  litres: 'litre',
  ltr: 'litre',
  lit: 'litre',
  kw: 'kw',
  kwp: 'kw',
  kva: 'kw',
  ls: 'lumpsum',
  lumpsum: 'lumpsum',
  'lump sum': 'lumpsum',
  job: 'lumpsum',
  work: 'lumpsum',
};

/** One spelling for a unit, or null when the word is not one we know how to compare. */
export function normUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const k = u
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return UNIT_ALIASES[k] ?? null;
}

/**
 * What each material is legitimately sold by.
 *
 * A quotation that prices steel in BAGS has a unit error, and on a real quotation a unit error is
 * almost always a quantity error wearing a disguise — the figure beside it was worked out from
 * something, and if the something is wrong the figure is wrong. This is why the ask was "100 bags
 * of cement and 80 bags of steel": nobody sells steel by the bag.
 */
const SOLD_BY: Record<string, string[]> = {
  cement: ['bag', 'ton'],
  steel: ['kg', 'ton'],
  sand: ['cft', 'cum', 'ton'],
  aggregate: ['cft', 'cum', 'ton'],
  bricks: ['nos'],
  solar_panels: ['kw', 'nos'],
};

const UNIT_WORD: Record<string, string> = {
  bag: 'bags',
  kg: 'kilograms',
  ton: 'tonnes',
  nos: 'numbers',
  sqft: 'square feet',
  cft: 'cubic feet',
  cum: 'cubic metres',
  rft: 'running feet',
  litre: 'litres',
  kw: 'kilowatts',
  lumpsum: 'a lump sum',
};
const says = (u: string) => UNIT_WORD[u] ?? u;

/**
 * The same line, bought here. Three things hold before a rupee of saving is claimed, and a line
 * failing any of them is left alone rather than guessed at:
 *
 *   1. THE STORE ACTUALLY SELLS IT — `rateSource: 'store'`, a live SKU with a real price rather
 *      than a thumb rule.
 *   2. THERE IS A QUANTITY TO MULTIPLY — the document's, in a unit that agrees with ours, or this
 *      house's own, and the output says which.
 *   3. THE ARITHMETIC IS THE DOCUMENT'S OWN. Given qty AND rate, they must multiply out to within
 *      3 % of its stated amount. A row whose numbers do not multiply is a row we have misread.
 */
function repriceFromStore(q: QuotedLine, line: LineItem): StoreReprice | null {
  if (line.rateSource !== 'store' || !line.sku_code || !(line.rate > 0)) return null;

  const ourUnit = normUnit(line.unit);
  const theirUnit = normUnit(q.unit);
  const qtyOk = typeof q.qty === 'number' && Number.isFinite(q.qty) && q.qty > 0;
  const multipliesOut = qtyOk && typeof q.rate === 'number' && q.rate > 0 && Math.abs(q.qty! * q.rate - q.amount) <= q.amount * 0.03;
  const useTheirs = qtyOk && ourUnit !== null && (theirUnit === ourUnit || (theirUnit === null && multipliesOut));

  const qty = useTheirs ? (q.qty as number) : line.qty;
  if (!(qty > 0)) return null;

  const storeAmount = Math.round(qty * line.rate);
  return {
    sku_code: line.sku_code,
    skuName: line.skuName ?? line.label,
    unit: line.unit,
    storeRate: line.rate,
    quotedRate: useTheirs ? q.amount / qty : null,
    qty,
    qtySource: useTheirs ? 'quote' : 'estimate',
    storeAmount,
    saving: q.amount - storeAmount,
  };
}

/** Unit and quantity checks that need only the one line and the engine's own figure for it. */
function lineFlags(q: QuotedLine, line: LineItem, key: string): QuoteFlag[] {
  const out: QuoteFlag[] = [];
  const theirUnit = normUnit(q.unit);
  const allowed = SOLD_BY[key];

  if (theirUnit && allowed && !allowed.includes(theirUnit)) {
    out.push({
      kind: 'unit',
      line: q.line,
      message: `${line.label} is bought by ${allowed.map(says).join(' or ')}, and this line is priced by ${says(theirUnit)}. Worth checking what the figure beside it was worked out from.`,
    });
  }

  /* Their quantity against ours, only when both are in the same unit — otherwise the comparison
     is between two different things and the number would be nonsense. */
  const ourUnit = normUnit(line.unit);
  if (typeof q.qty === 'number' && q.qty > 0 && ourUnit && theirUnit === ourUnit && line.qty > 0) {
    const ratio = q.qty / line.qty;
    if (ratio < 0.6 || ratio > 1.7) {
      out.push({
        kind: 'quantity',
        line: q.line,
        message: `This line lists ${fmt(q.qty)} ${says(ourUnit)}. A ${fmt(line.qty)}-${says(ourUnit).replace(/s$/, '')} figure is what this house works out at, so one of the two is describing a different job.`,
      });
    }
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: n < 10 ? 1 : 0 });

/**
 * Cement against steel, the one cross-line check worth making: the concrete decides both, so
 * kilograms of steel per bag of cement is roughly fixed for a kind of building, and a quote out on
 * that ratio has mispriced or miscounted one of the two — invisible reading the lines one at a
 * time. The expected ratio is not a number anybody chose: it is what THIS estimate works out for
 * THIS house from its own published quantities, printed beside the quote's so the reader can check
 * both against the line items further up the same page.
 */
function ratioFlags(quoted: QuotedLine[], byKey: Map<string, LineItem>): QuoteFlag[] {
  const ours = { cement: byKey.get('cement'), steel: byKey.get('steel') };
  if (!ours.cement || !ours.steel || !(ours.cement.qty > 0)) return [];

  const find = (key: string, unit: string) => {
    for (const q of quoted) {
      if (matchLabel(q.label)?.key !== key) continue;
      if (!(typeof q.qty === 'number' && q.qty > 0)) continue;
      const u = normUnit(q.unit);
      if (u === unit) return q.qty;
      if (u === 'ton' && unit === 'kg') return q.qty * 1000;
    }
    return null;
  };
  const theirCement = find('cement', 'bag');
  const theirSteel = find('steel', 'kg');
  if (theirCement === null || theirSteel === null) return [];

  const oursRatio = ours.steel.qty / ours.cement.qty;
  const theirs = theirSteel / theirCement;
  if (oursRatio <= 0) return [];
  const off = theirs / oursRatio;
  if (off >= 0.65 && off <= 1.55) return [];

  return [
    {
      kind: 'ratio',
      line: null,
      message:
        `The quote works out at ${theirs.toFixed(1)} kg of steel per bag of cement; this house works out at ${oursRatio.toFixed(1)}. ` +
        `The two always move together, because the concrete decides both — so one of those two lines is counting a different building.`,
    },
  ];
}

/**
 * Trade words to engine line keys.
 *
 * This is the part that has to know India. A quotation from a Warangal contractor says "centering"
 * where a textbook says formwork, "jelly" or "metal" where the engine says aggregate, "rods" for
 * steel and "kadapa" for a stone slab. Roman-script Telugu and Hindi trade words are here for the
 * same reason — the document was written by a person on a site, not by a procurement system.
 */
const SYNONYMS: { key: string; words: string[] }[] = [
  { key: 'cement', words: ['cement', 'opc', 'ppc', 'ultratech', 'acc', 'ambuja', 'simentu', 'बोरी'] },
  { key: 'steel', words: ['steel', 'tmt', 'rod', 'rods', 'reinforcement', 'iron', 'sariya', 'sariyaa', 'ismt', 'fe500'] },
  { key: 'bricks', words: ['brick', 'bricks', 'block', 'blocks', 'flyash', 'fly ash', 'itta', 'eetalu'] },
  { key: 'sand', words: ['sand', 'msand', 'm-sand', 'river sand', 'isuka', 'ret'] },
  { key: 'aggregate', words: ['aggregate', 'metal', 'jelly', 'kankar', 'gravel', '20mm', '20 mm', 'kankara'] },
  { key: 'formwork', words: ['formwork', 'shuttering', 'centering', 'centring', 'plywood shutter', 'staging'] },
  { key: 'civil_labour', words: ['labour', 'labor', 'mason', 'mestri', 'mistri', 'coolie', 'workmanship', 'civil labour', 'bar bending'] },
  { key: 'plaster', words: ['plaster', 'plastering', 'rendering', 'putty coat', 'wall plaster'] },
  { key: 'ext_paint', words: ['exterior paint', 'external paint', 'weather', 'apex', 'outside painting', 'outer painting'] },
  { key: 'int_paint', words: ['interior paint', 'internal paint', 'emulsion', 'inside painting', 'painting', 'paint'] },
  { key: 'waterproofing', words: ['waterproof', 'waterproofing', 'damp proof', 'terrace treatment'] },
  { key: 'floor_tiles', words: ['floor tile', 'flooring', 'vitrified', 'granite flooring', 'marble', 'tiles'] },
  { key: 'wall_tiles', words: ['wall tile', 'dado', 'bathroom tile', 'kitchen tile'] },
  { key: 'tile_laying', words: ['tile laying', 'tile fixing', 'laying charges', 'fixing labour'] },
  { key: 'plumbing', words: ['plumbing', 'sanitary', 'cpvc', 'upvc', 'water line', 'drainage'] },
  { key: 'bathroom_fixtures', words: ['sanitaryware', 'sanitary ware', 'ewc', 'wash basin', 'closet', 'jaquar', 'commode'] },
  { key: 'wiring', words: ['wiring', 'electrical', 'conduit', 'cabling', 'mcb', 'db box', 'point wiring'] },
  { key: 'fittings', words: ['switches', 'sockets', 'fittings', 'modular switch', 'fan point', 'light point'] },
  { key: 'doors', words: ['door', 'doors', 'flush door', 'teak door', 'main door', 'talupu'] },
  { key: 'window_frames', words: ['window', 'windows', 'upvc window', 'aluminium window', 'kitiki'] },
  { key: 'window_glass', words: ['glass', 'glazing', 'toughened'] },
  { key: 'compound_wall', words: ['compound wall', 'boundary wall', 'fencing wall', 'prakara'] },
  { key: 'gate', words: ['gate', 'ms gate', 'main gate'] },
  { key: 'staircase', words: ['staircase', 'stair', 'steps', 'railing'] },
  { key: 'borewell', words: ['borewell', 'bore well', 'bore', 'submersible'] },
  { key: 'sump', words: ['sump', 'underground tank', 'ugt', 'water tank'] },
  { key: 'septic', words: ['septic', 'soak pit', 'sewage tank'] },
  { key: 'rainwater', words: ['rainwater', 'rain water', 'harvesting', 'recharge pit'] },
  { key: 'parking', words: ['parking', 'porch', 'car park', 'portico'] },
  { key: 'false_ceiling', words: ['false ceiling', 'pop ceiling', 'gypsum ceiling'] },
  { key: 'modular_kitchen', words: ['modular kitchen', 'kitchen cabinet', 'kitchen work'] },
  { key: 'wardrobes', words: ['wardrobe', 'wardrobes', 'cupboard', 'almirah'] },
  { key: 'solar_panels', words: ['solar', 'solar panel', 'pv', 'rooftop solar'] },
  { key: 'lift', words: ['lift', 'elevator', 'home lift'] },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ൿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * How short a trade word has to be before it is only ever matched whole.
 *
 * This is not a tuning knob, it is a bug fix with a number on it. Plain substring matching put
 * "Consultancy retainer" into the sand line, because `ret` — रेत, which is what a north-Indian
 * contractor writes for sand — is inside "retainer". A three-letter trade word inside a longer
 * English word is a coincidence, not a match; a five-letter one usually is a match, which is what
 * lets "brickwork" find `brick`.
 */
const PREFIX_MIN = 4;

/**
 * Find the engine line a quoted label is talking about.
 *
 * Multi-word synonyms match as phrases; single words match whole, or as a prefix once they are
 * long enough to mean something on their own. The longest match wins, so "wall tile" beats
 * "tiles" and lands on the dado line rather than the flooring line.
 */
export function matchLabel(label: string): { key: string; on: string } | null {
  const n = norm(label);
  if (!n) return null;
  const tokens = n.split(' ');
  let best: { key: string; on: string } | null = null;
  for (const s of SYNONYMS) {
    for (const w of s.words) {
      const hit = w.includes(' ') ? n.includes(w) : tokens.some((t) => t === w || (w.length >= PREFIX_MIN && t.startsWith(w)));
      if (!hit) continue;
      if (!best || w.length > best.on.length) best = { key: s.key, on: w };
    }
  }
  return best;
}

/**
 * The span the same work occupies across the three finish levels, for one line key.
 *
 * The three estimates are run ONCE for the whole quotation and indexed by key. This used to run
 * `estimate()` three times per matched line — a twenty-line quote cost sixty full passes of the
 * engine, every one of them computing the same three results.
 */
type TierIndex = Record<Tier, Map<string, LineItem>>;

function tierIndex(inputs: EstimateInputs, catalog: CatalogPrices): TierIndex {
  const out = {} as TierIndex;
  for (const t of TIERS) out[t] = new Map(estimate({ ...inputs, tier: t }, catalog).lines.map((l) => [l.key, l]));
  return out;
}

function lineRange(idx: TierIndex, tier: Tier, key: string): { low: number; likely: number; high: number } | null {
  const amounts: number[] = [];
  let likely: number | null = null;
  for (const t of TIERS) {
    const l = idx[t].get(key);
    if (!l) continue;
    amounts.push(l.amount);
    if (t === tier) likely = l.amount;
  }
  if (amounts.length === 0 || likely === null) return null;
  return { low: Math.min(...amounts), likely, high: Math.max(...amounts) };
}

/**
 * Compare a quotation against the estimate for the same house.
 *
 * `result` must be the estimate for the house the quote is FOR. Comparing a quote for a G+1
 * against an estimate for a G+2 would produce confident nonsense, so the caller is responsible
 * for that pairing and the UI states which house is being compared.
 */
export function compareQuote(result: EstimateResult, quoted: QuotedLine[], catalog: CatalogPrices = {}): QuoteComparison {
  const byKey = new Map<string, LineItem>(result.lines.map((l) => [l.key, l]));
  const idx = tierIndex(result.inputs, catalog);
  const matches: QuoteMatch[] = [];
  const counts: Record<QuoteVerdict, number> = { within: 0, above: 0, below: 0, unmatchable: 0 };
  let matchedQuotedTotal = 0;
  let matchedEstimateTotal = 0;
  const store = { lines: 0, quotedTotal: 0, storeTotal: 0, saved: 0 };

  for (const q of quoted) {
    const hit = matchLabel(q.label);
    const line = hit ? byKey.get(hit.key) : undefined;
    if (!hit || !line) {
      counts.unmatchable += 1;
      matches.push({
        quoted: q,
        lineKey: null,
        lineLabel: null,
        range: null,
        verdict: 'unmatchable',
        delta: null,
        note: 'We could not map this line to anything in our rate card. It is not wrong — it is outside what this estimate covers.',
        matchedOn: null,
        store: null,
        flags: [],
      });
      continue;
    }
    const range = lineRange(idx, result.inputs.tier, hit.key);
    if (!range) {
      counts.unmatchable += 1;
      matches.push({
        quoted: q,
        lineKey: hit.key,
        lineLabel: line.label,
        range: null,
        verdict: 'unmatchable',
        delta: null,
        note: 'This line exists in our card but not in this house, so there is nothing to compare it against.',
        matchedOn: hit.on,
        store: null,
        flags: [],
      });
      continue;
    }

    matchedQuotedTotal += q.amount;
    matchedEstimateTotal += range.likely;

    let verdict: QuoteVerdict;
    let delta: number;
    if (q.amount > range.high) {
      verdict = 'above';
      delta = (q.amount - range.high) / range.high;
    } else if (q.amount < range.low) {
      verdict = 'below';
      delta = (q.amount - range.low) / range.low;
    } else {
      verdict = 'within';
      delta = (q.amount - range.likely) / (range.likely || 1);
    }
    counts[verdict] += 1;

    const pct = `${Math.abs(Math.round(delta * 100))} %`;
    const cite = `our ${result.version} rate for ${result.derived.cityName}`;
    const note =
      verdict === 'above'
        ? `${pct} above the top of ${cite}. That can be right — better material, harder access, or work this estimate does not include. Worth asking what it covers.`
        : verdict === 'below'
          ? `${pct} below the bottom of ${cite}. Take this one seriously: a line quoted under cost is the usual way a build stops halfway. Ask what specification it assumes.`
          : `Inside ${cite}.`;

    const repriced = repriceFromStore(q, line);
    if (repriced) {
      store.lines += 1;
      store.quotedTotal += q.amount;
      store.storeTotal += repriced.storeAmount;
      store.saved += repriced.saving;
    }

    matches.push({
      quoted: q,
      lineKey: hit.key,
      lineLabel: line.label,
      range,
      verdict,
      delta,
      note,
      matchedOn: hit.on,
      store: repriced,
      flags: lineFlags(q, line, hit.key),
    });
  }

  return {
    matches,
    quotedTotal: quoted.reduce((a, q) => a + q.amount, 0),
    estimateTotal: result.grandTotal,
    matchedQuotedTotal,
    matchedEstimateTotal,
    counts,
    store,
    flags: ratioFlags(quoted, byKey),
    citation: { version: result.version, city: result.derived.cityName, cityIndex: result.derived.cityIndex, tier: result.inputs.tier },
  };
}

/**
 * Read a pasted quotation into typed lines.
 *
 * Deliberately dumb and deliberately local: one line per newline, the last number on the line is
 * the amount, the rest of it is the label. It handles what a person actually pastes out of
 * WhatsApp or types off a paper quote, including Indian digit grouping (`1,08,000`) and the ₹
 * sign, and it does it without a model — so the common path costs nothing and works offline.
 * A photographed quotation goes through the reader instead.
 */
export function parseQuoteText(text: string): QuotedLine[] {
  const out: QuotedLine[] = [];
  const rows = text.split(/\r?\n/);
  for (let n = 0; n < rows.length; n += 1) {
    const row = rows[n].trim();
    if (!row || row.length < 3) continue;
    /* Indian grouping: 1,08,000 and 12,34,567 as well as 108000 and 1,08,000.50 */
    const nums = row.match(/₹?\s*\d[\d,]*(?:\.\d+)?/g);
    if (!nums || nums.length === 0) continue;
    const amount = Number(nums[nums.length - 1].replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const label = row
      .slice(0, row.lastIndexOf(nums[nums.length - 1]))
      .replace(/[-–—:|]+\s*$/, '')
      .trim();
    if (!label) continue;
    /*
     * A QUANTITY IS A NUMBER WITH A UNIT WORD AFTER IT — "720 bags", "6300 kg", "14400 nos".
     *
     * That pattern is worth hunting for wherever it sits on the row, rather than only reading
     * the first number when a row happens to carry three of them. It is what makes a rate
     * comparable to a rate: without the unit, ₹400 on the cement line could be four hundred
     * rupees a bag or four hundred a tonne, and the difference is the whole answer.
     *
     * Scanning also steps over the numbers that are part of a description — "600×600 GVT",
     * "20mm jelly", "Fe500" — because `mm`, `x` and `gvt` are not units and the scan carries on.
     */
    const val = (t: string) => Number(t.replace(/[₹,\s]/g, ''));
    let qty: number | null = null;
    let unit: string | null = null;
    for (const m of row.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z.]{1,10})\b/g)) {
      const u = normUnit(m[2]);
      if (!u) continue;
      qty = val(m[1]);
      unit = u;
      break;
    }

    /*
     * And a row states its own rate when one of its numbers multiplies the quantity out to the
     * amount. Looking for THAT rather than reading the second number is what gets "20mm jelly
     * 300 cft 45 13,500" right: the leading 20 is part of the description, and a rule that took
     * the first two numbers would have quietly answered 20 x 300.
     *
     * A row whose numbers do not multiply out at all is a row we have misread, and reading a
     * rate off it would put a confident wrong figure in front of somebody.
     */
    let rate: number | null = null;
    const multipliesTo = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a * b - amount) <= amount * 0.03;
    if (qty !== null && qty > 0) {
      for (const t of nums.slice(0, -1)) {
        const b = val(t);
        if (multipliesTo(qty, b)) {
          rate = b;
          break;
        }
      }
    } else if (nums.length >= 3 && multipliesTo(val(nums[0]), val(nums[1]))) {
      qty = val(nums[0]);
      rate = val(nums[1]);
    }
    /*
     * Peel the row's own figures off the end of the description, one trailing "number, maybe
     * with a unit word after it" at a time, stopping at the first thing that is not one.
     *
     * The lookbehind is the whole of what makes this safe. Without it the strip ate the grade
     * out of "M20 concrete 45 cum" and returned "M": the trailing pattern happily read the 20
     * as a quantity and "concrete" as its unit. A number that a letter or another digit runs
     * straight into is part of the NAME of the thing — M20, Fe500, 600x600, 20mm — and is never
     * a count of it.
     */
    let clean = label;
    for (;;) {
      const next = clean.replace(/[\s·|,@x×-]*(?<![A-Za-z0-9])\d[\d,]*(?:\.\d+)?\s*(?:[A-Za-z.]{1,10})?[\s·|,-]*$/, '').trim();
      if (next === clean || !/[A-Za-zऀ-෿]/.test(next)) break;
      clean = next;
    }
    out.push({ line: n + 1, label: clean, amount, qty, rate, unit });
  }
  return out;
}

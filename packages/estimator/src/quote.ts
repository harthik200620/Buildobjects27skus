/**
 * Is the quote you were given fair?
 *
 * ── WHY THIS IS THE HOOK ────────────────────────────────────────────────────────────────────
 * Almost everybody building a house has two or three contractor quotes on a phone and no way at
 * all to judge them. There is no published rate for "brickwork in Guntur in August". The buyer's
 * only options today are to trust the contractor, or to ask an uncle.
 *
 * This maps a quote's lines onto the engine's own line keys and says where each one sits against
 * a rate card that states its version, its city index and its basis. It is not an opinion.
 *
 * ── THE RULES, AND THEY ARE NOT NEGOTIABLE ──────────────────────────────────────────────────
 *
 *  1. NEVER ACCUSE ANYONE. The output is "22 % above our rate for Hyderabad, Aug 2026" with the
 *     rate cited. It is never "your contractor is cheating you". We have not seen the site, the
 *     specification, the access or the terms; a contractor may be dearer for a dozen legitimate
 *     reasons and the buyer is the one who knows which.
 *  2. A LINE BELOW THE RANGE IS FLAGGED HARDER THAN ONE ABOVE. Underquoting is how a build stalls
 *     at month nine with the slab cast and the money gone, and it is the failure mode nobody
 *     warns a first-time builder about. An over-quote costs money; an under-quote costs the house.
 *  3. UNMATCHABLE LINES ARE LISTED, NEVER DROPPED. Quietly ignoring a line the platform cannot
 *     understand is how a comparison becomes a lie by omission.
 *  4. EVERY COMPARISON CARRIES ITS RATE-PACK VERSION AND CITY INDEX, so the buyer can argue with
 *     it. Being arguable is the point — an unarguable number is just another person to trust.
 *
 * ── AND IT IS THEIR DOCUMENT ────────────────────────────────────────────────────────────────
 * A contractor's quotation is a private commercial document. Nothing here persists it. The caller
 * holds it in memory for the session and the UI says so.
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
  /** The contractor's own words. Kept verbatim so the buyer recognises their own document. */
  label: string;
  qty?: number | null;
  unit?: string | null;
  rate?: number | null;
  amount: number;
  /** 0–1 when a reader extracted it rather than the buyer typing it. */
  confidence?: number;
}

export type QuoteVerdict = 'within' | 'above' | 'below' | 'unmatchable';

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
  /** Everything the reader needs to print beside the comparison. */
  citation: { version: string; city: string; cityIndex: number; tier: Tier };
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

/** The span the same work occupies across the three finish levels, for one line key. */
function lineRange(inputs: EstimateInputs, catalog: CatalogPrices, key: string): { low: number; likely: number; high: number } | null {
  const amounts: number[] = [];
  let likely: number | null = null;
  for (const t of TIERS) {
    const r = estimate({ ...inputs, tier: t }, catalog);
    const l = r.lines.find((x) => x.key === key);
    if (!l) continue;
    amounts.push(l.amount);
    if (t === inputs.tier) likely = l.amount;
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
  const matches: QuoteMatch[] = [];
  const counts: Record<QuoteVerdict, number> = { within: 0, above: 0, below: 0, unmatchable: 0 };
  let matchedQuotedTotal = 0;
  let matchedEstimateTotal = 0;

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
      });
      continue;
    }
    const range = lineRange(result.inputs, catalog, hit.key);
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

    matches.push({ quoted: q, lineKey: hit.key, lineLabel: line.label, range, verdict, delta, note, matchedOn: hit.on });
  }

  return {
    matches,
    quotedTotal: quoted.reduce((a, q) => a + q.amount, 0),
    estimateTotal: result.grandTotal,
    matchedQuotedTotal,
    matchedEstimateTotal,
    counts,
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
    /* A "12 x 450 = 5400" row gives quantity and rate for free. */
    const qty = nums.length >= 3 ? Number(nums[0].replace(/[₹,\s]/g, '')) : null;
    const rate = nums.length >= 3 ? Number(nums[1].replace(/[₹,\s]/g, '')) : null;
    out.push({ line: n + 1, label, amount, qty, rate, unit: null });
  }
  return out;
}

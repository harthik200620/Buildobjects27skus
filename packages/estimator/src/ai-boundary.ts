/**
 * The line a language model may not cross.
 *
 * NO NUMBER IN THIS INTERFACE ORIGINATES FROM A LANGUAGE MODEL. Not a total, not a rate, not a
 * quantity, not a dimension, not a load. A model may read a drawing and say "I think this is G+1",
 * read a quotation and say "this line says brickwork", or find a published rate and propose the
 * engine's is low, with a link. It may never hand back a figure that reaches the buyer's screen
 * without the engine computing it.
 *
 * That is a TYPE, not a review, because "be careful not to let the model set a total" is a rule
 * somebody breaks in six months in a hurry. Everything crossing is an INPUT PATCH (clamped by
 * `normalizeInputs`), an ADJUSTMENT[] (clamped to +/-35% and refused entirely on store-priced
 * lines), or TEXT, which can hold no authority. No member of `AiPatch` carries a total, and
 * `parseAiPatch` drops any key it does not recognise: `{ grandTotal: 9900000 }` produces `null`,
 * and there is a test that asserts it.
 *
 * Explanations stream; numbers never do. A figure arriving a digit at a time reads as a machine
 * computing it, which is the impression this file exists to prevent.
 */
import { ADJUSTMENT_CLAMP, ADJUSTMENT_LINE_KEY_RE, INPUT_RANGES, normalizeInputs } from './inputs';
import type { Adjustment, EstimateInputs } from './types';

/** Fields of the input schema a model is allowed to propose. Anything else is dropped. */
const PATCHABLE = new Set<keyof EstimateInputs>([
  'city',
  'state',
  'plot',
  'floors',
  'coverage',
  'constructionType',
  'parking',
  'compoundWall',
  'tier',
  'addons',
  'builtUpOverrideSqft',
  'rooms',
  'floorHeightFt',
  'soil',
  'foundation',
  'roof',
  'exteriorFinish',
  'interior',
  'plumbingTier',
  'electricalPointsPerRoom',
  'staircase',
  'lift',
  'water',
  'balconyUtilitySqft',
  'boundaryWall',
  'landscapingSqft',
  'solarKw',
  'site',
]);

export type AiPatch =
  /** A reviewable diff of the input form. The buyer sees it highlighted and confirms it. */
  | { kind: 'inputs'; patch: Partial<EstimateInputs>; fieldConfidence: Record<string, number>; note: string }
  /** Rate or quantity overrides, each with a citation. The engine clamps them. */
  | { kind: 'adjustments'; adjustments: Adjustment[]; note: string }
  /** Prose. Carries no authority and sets nothing. */
  | { kind: 'explanation'; text: string };

/** Below this, a field is shown as a suggestion and never applied without a tap. */
export const AUTO_APPLY_CONFIDENCE = 0.75;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse whatever a model returned into something that cannot lie about money.
 *
 * Returns `null` for anything that is not one of the three shapes — including, deliberately, an
 * object that carries a plausible-looking `grandTotal`, `perSqft` or `amount`. There is no code
 * path from a model's JSON to a figure on screen.
 */
export function parseAiPatch(raw: unknown): AiPatch | null {
  if (!isObj(raw)) return null;

  if (raw.kind === 'explanation') {
    const text = typeof raw.text === 'string' ? raw.text.slice(0, 8000) : '';
    return text ? { kind: 'explanation', text } : null;
  }

  if (raw.kind === 'inputs') {
    if (!isObj(raw.patch)) return null;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw.patch)) {
      if (PATCHABLE.has(k as keyof EstimateInputs)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) return null;
    /*
     * Normalising here rather than at the call site is what makes the clamp unavoidable. Every
     * numeric field goes through INPUT_RANGES, every enum through its own list, so a model
     * proposing forty floors gets four and a model proposing a negative plot gets the minimum.
     */
    const full = normalizeInputs(patch as Partial<EstimateInputs>);
    const clean: Partial<EstimateInputs> = {};
    for (const k of Object.keys(patch) as (keyof EstimateInputs)[]) (clean as Record<string, unknown>)[k] = full[k];

    const fc: Record<string, number> = {};
    if (isObj(raw.fieldConfidence)) {
      for (const [k, v] of Object.entries(raw.fieldConfidence)) {
        const n = Number(v);
        if (Number.isFinite(n)) fc[k] = Math.min(1, Math.max(0, n));
      }
    }
    return { kind: 'inputs', patch: clean, fieldConfidence: fc, note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '' };
  }

  if (raw.kind === 'adjustments') {
    if (!Array.isArray(raw.adjustments)) return null;
    const out: Adjustment[] = [];
    for (const a of raw.adjustments) {
      if (!isObj(a)) continue;
      const key = typeof a.line_key === 'string' ? a.line_key : '';
      if (!ADJUSTMENT_LINE_KEY_RE.test(key)) continue;
      /*
       * A citation is mandatory for an AI-proposed adjustment. A model asserting a rate with no
       * source is exactly the free-floating number this boundary exists to refuse — the engine
       * will clamp it to ±35 %, but a clamped invention is still an invention.
       */
      const url = typeof a.source_url === 'string' && /^https?:\/\//.test(a.source_url) ? a.source_url : null;
      if (!url) continue;
      const rate = Number(a.rate);
      const qty = Number(a.qty);
      const adj: Adjustment = {
        line_key: key,
        reason: typeof a.reason === 'string' ? a.reason.slice(0, 300) : '',
        source_url: url,
        provenance: 'ai_suggested',
      };
      if (Number.isFinite(rate) && rate > 0) adj.rate = rate;
      if (Number.isFinite(qty) && qty > 0) adj.qty = qty;
      if (adj.rate === undefined && adj.qty === undefined) continue;
      out.push(adj);
      if (out.length >= INPUT_RANGES.adjustmentsMax) break;
    }
    return out.length ? { kind: 'adjustments', adjustments: out, note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '' } : null;
  }

  return null;
}

/**
 * Apply a parsed patch to the buyer's inputs.
 *
 * Low-confidence fields are returned as `held` and are NOT applied — the UI shows them as
 * suggestions with their confidence, and a person taps to accept. The brief's rule is that
 * low-confidence fields are never silently applied, and the only reliable way to keep that rule
 * is for the function that applies things to refuse to apply them.
 */
export function applyAiPatch(
  inputs: EstimateInputs,
  patch: AiPatch,
): { inputs: EstimateInputs; applied: string[]; held: { field: string; confidence: number }[] } {
  if (patch.kind !== 'inputs') return { inputs, applied: [], held: [] };
  const applied: string[] = [];
  const held: { field: string; confidence: number }[] = [];
  const next: Record<string, unknown> = { ...inputs };
  for (const [k, v] of Object.entries(patch.patch)) {
    const c = patch.fieldConfidence[k];
    if (c !== undefined && c < AUTO_APPLY_CONFIDENCE) {
      held.push({ field: k, confidence: c });
      continue;
    }
    next[k] = v;
    applied.push(k);
  }
  return { inputs: normalizeInputs(next as Partial<EstimateInputs>), applied, held };
}

/** The clamp, re-exported here so the boundary's contract reads in one place. */
export const AI_ADJUSTMENT_CLAMP = ADJUSTMENT_CLAMP;

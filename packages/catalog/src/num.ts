/**
 * Numbers, as the store shows them.
 *
 * Two jobs live here. Coercion: reading a number out of an LLM response, a JSON fixture or an
 * image analysis, any of which can hand back a string, a null or a NaN. Formatting: Indian
 * digit grouping, which every surface uses and which must agree between the pipeline (writing
 * spec sheets) and the web app (rendering them) — the same value has to read the same way in
 * a search facet, on a card and in the spec table.
 *
 * `Intl.NumberFormat` construction is expensive relative to formatting, and `toLocaleString`
 * builds one per call. These are built once.
 */

const LOCALE = 'en-IN';

const integers = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 });
const rupees = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
const rupeesWithPaise = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Constrains `n` to [lo, hi]. Assumes a finite input — use `clamp01` for untrusted values. */
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Coerces any value to a confidence/ratio in [0, 1]. Anything that is not a finite number —
 * `null`, `"high"`, `NaN`, `undefined` — becomes 0, which reads as "no confidence" everywhere
 * this is used and is always the safe direction to fail.
 */
export function clamp01(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}

/** `1,23,456` — Indian grouping. Whole numbers stay whole; fractions keep up to three places. */
export const formatNumber = (n: number): string => (Number.isInteger(n) ? integers : decimals).format(n);

/**
 * `₹1,23,456`, or `₹1,23,456.50` when `decimals` is asked for and the value actually has paise.
 * A missing or non-finite price renders as an em dash rather than `₹NaN`.
 */
export function formatRupees(n: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const hasPaise = opts.decimals === true && Math.round(n * 100) % 100 !== 0;
  return `₹${(hasPaise ? rupeesWithPaise : rupees).format(n)}`;
}

/**
 * One attribute value as every surface shows it: numbers grouped and carrying their unit,
 * booleans as Yes/No, everything else as written.
 *
 * `₹` is the one unit that leads rather than trails. `dataType` comes from the attribute
 * registry and is authoritative when the stored value's own type disagrees — EAV round-trips
 * booleans through `"true"` and numbers through strings often enough to matter.
 *
 * The pipeline uses this when it bakes `spec_json`, and the product page uses it when it
 * renders one; they must not drift.
 */
export function formatSpecValue(value: string | number | boolean | null | undefined, unit?: string | null, dataType?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean' || dataType === 'boolean') return value === true || value === 'true' ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const n = formatNumber(value);
    return unit === '₹' ? `₹${n}` : unit ? `${n} ${unit}` : n;
  }
  return unit && dataType === 'number' ? `${value} ${unit}` : String(value);
}

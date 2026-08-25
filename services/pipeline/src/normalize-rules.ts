/**
 * Key-family canonicalisation rules — pure string → token functions with no I/O. Each rule owns a
 * family of registry keys and turns the marketing sentence a source wrote ("BEE 3 Star, as marketed
 * for the Indian market") into the short token a facet and a spec table want ("BEE 3 Star"). Nothing
 * here invents: when the token is not in the text the rule returns null and the generic path runs.
 */

export interface RuleResult {
  value: string | number /** Human explanation of the transformation; empty when verbatim. */;
  note: string;
}
export interface RuleContext {
  key: string;
  dataType: string;
  unit: string | null;
}
export interface Rule {
  name: string;
  test: (key: string) => boolean;
  apply: (raw: string, ctx: RuleContext) => RuleResult | null;
}

export const MAX_TOKEN = 40;

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const was = (raw: string) => `was: "${clip(raw)}"`;

/* ── energy rating ─────────────────────────────────────────────────────────── */
const energyRating: Rule = {
  name: 'energy_rating',
  test: (k) => /(^|_)(energy|bee|star)_rating$|^bee_star|_star_rating$/.test(k),
  apply: (raw) => {
    if (/\b(un-?rated|not rated|no (bee )?rating|not applicable)\b/i.test(raw)) return { value: 'Unrated', note: was(raw) };
    const m = /(\d)\s*[- ]?\s*star/i.exec(raw) ?? /star\s*[- ]?\s*(\d)\b/i.exec(raw);
    if (!m) return null;
    return { value: `BEE ${m[1]} Star`, note: was(raw) };
  },
};

/* ── IP / IK ratings ───────────────────────────────────────────────────────── */
const ipRating: Rule = {
  name: 'ip_rating',
  test: (k) => /(^|_)ip_rating$|ingress_protection|^ip_class|_ip_rating$/.test(k),
  apply: (raw) => {
    const all = [...raw.matchAll(/\bIP\s?-?\s?(\d{2}K?|X\d|\dX)\b/gi)].map((m) => `IP${m[1].toUpperCase()}`);
    if (!all.length) return null;
    const uniq = [...new Set(all)];
    return { value: uniq[0], note: uniq.length > 1 ? `${was(raw)} — also states ${uniq.slice(1).join(', ')}` : was(raw) };
  },
};
const ikRating: Rule = {
  name: 'ik_rating',
  test: (k) => /(^|_)ik_rating$|impact_protection_rating|vandal_rating/.test(k),
  apply: (raw) => {
    const m = /\bIK\s?-?\s?(\d{2})\b/i.exec(raw);
    return m ? { value: `IK${m[1]}`, note: was(raw) } : null;
  },
};

/* ── lamp bases ────────────────────────────────────────────────────────────── */
const BASES = [
  'B22d',
  'B22',
  'B15d',
  'B15',
  'E27',
  'E26',
  'E14',
  'E12',
  'E40',
  'GU10',
  'GU5.3',
  'GU4',
  'G9',
  'G4',
  'G13',
  'G5',
  'G24',
  'GX53',
  'MR16',
  'R7s',
  'PAR30',
  'PAR38',
  '2G11',
];
const baseType: Rule = {
  name: 'base_type',
  test: (k) => /(^|_)(base|cap|socket|holder)_type$|^lamp_base$|^base$|^cap$/.test(k),
  apply: (raw) => {
    const up = raw.toUpperCase();
    for (const b of BASES) {
      const re = new RegExp(`(^|[^A-Z0-9])${b.toUpperCase().replace('.', '\\.')}(?=$|[^A-Z0-9])`);
      if (re.test(up)) return { value: b, note: raw.trim() === b ? '' : was(raw) };
    }
    return null;
  },
};

/* ── standards ─────────────────────────────────────────────────────────────── */
const STD_RE =
  /\b(IS|IEC|ISO|EN|BS EN|BS|DIN|ASTM|ANSI|UL|JIS|IEEE|ITU|ISI)\s*[:-]?\s*(\d{2,6}(?:[.-]\d{1,4})*)(?:\s*\(?\s*Part\s*[-:]?\s*(\d+)\s*\)?)?(?:\s*[:/-]\s*((?:19|20)\d{2}))?/gi;
const isStandard: Rule = {
  name: 'is_standard',
  test: (k) => /(^|_)(is|bis|governing|applicable|reference|iec|iso|en)_standard(s)?$|^standard(s)?$|^standard_(code|number)$|_standards?_compliance$/.test(k),
  apply: (raw) => {
    const tokens: string[] = [];
    for (const m of raw.matchAll(STD_RE)) {
      const body = m[1].toUpperCase() === 'ISI' ? 'IS' : m[1].toUpperCase();
      const t = `${body} ${m[2]}${m[3] ? ` (Part ${m[3]})` : ''}${m[4] ? `:${m[4]}` : ''}`;
      if (!tokens.includes(t)) tokens.push(t);
    }
    if (!tokens.length) return null;
    let value = tokens[0];
    for (let i = 1; i < tokens.length; i++) {
      const next = `${value} / ${tokens[i]}`;
      if (next.length > MAX_TOKEN) break;
      value = next;
    }
    const dropped = tokens.filter((t) => !value.includes(t));
    const note = value === raw.trim() ? '' : `${was(raw)}${dropped.length ? ` — also states ${dropped.join(', ')}` : ''}`;
    return { value, note };
  },
};

/* ── country of origin ─────────────────────────────────────────────────────── */
const COUNTRIES: [RegExp, string][] = [
  [/\bindia\b/i, 'India'],
  [/\bchina\b|\bprc\b/i, 'China'],
  [/\bgermany\b/i, 'Germany'],
  [/\bjapan\b/i, 'Japan'],
  [/\b(usa|u\.s\.a\.|united states|america)\b/i, 'USA'],
  [/\bitaly\b/i, 'Italy'],
  [/\bswitzerland\b|\bswiss\b/i, 'Switzerland'],
  [/\b(south )?korea\b/i, 'South Korea'],
  [/\btaiwan\b/i, 'Taiwan'],
  [/\bvietnam\b/i, 'Vietnam'],
  [/\bthailand\b/i, 'Thailand'],
  [/\bmalaysia\b/i, 'Malaysia'],
  [/\b(uk|united kingdom|britain|england)\b/i, 'UK'],
  [/\bturkey\b|\btürkiye\b/i, 'Turkey'],
  [/\b(uae|united arab emirates|dubai)\b/i, 'UAE'],
  [/\bspain\b/i, 'Spain'],
  [/\bfrance\b/i, 'France'],
  [/\bnetherlands\b|\bholland\b/i, 'Netherlands'],
  [/\bbelgium\b/i, 'Belgium'],
  [/\bsweden\b/i, 'Sweden'],
  [/\bczech\b/i, 'Czech Republic'],
  [/\bpoland\b/i, 'Poland'],
  [/\bindonesia\b/i, 'Indonesia'],
  [/\bsingapore\b/i, 'Singapore'],
  [/\bmexico\b/i, 'Mexico'],
  [/\bbrazil\b/i, 'Brazil'],
  [/\bcanada\b/i, 'Canada'],
  [/\baustralia\b/i, 'Australia'],
  [/\bdenmark\b/i, 'Denmark'],
  [/\bfinland\b/i, 'Finland'],
  [/\baustria\b/i, 'Austria'],
  [/\bhungary\b/i, 'Hungary'],
  [/\bportugal\b/i, 'Portugal'],
];
const countryOfOrigin: Rule = {
  name: 'country_of_origin',
  test: (k) => /country_of_origin|origin_country|^made_in$|manufacturing_country|country_of_manufacture/.test(k),
  apply: (raw) => {
    const hits: string[] = [];
    for (const [re, name] of COUNTRIES) if (re.test(raw) && !hits.includes(name)) hits.push(name);
    if (!hits.length) return null;
    const value = hits[0];
    return { value, note: raw.trim() === value ? '' : `${was(raw)}${hits.length > 1 ? ` — also mentions ${hits.slice(1).join(', ')}` : ''}` };
  },
};

/* ── warranty ──────────────────────────────────────────────────────────────── */
const warranty: Rule = {
  name: 'warranty',
  test: (k) => /warranty|guarantee/.test(k),
  apply: (raw, ctx) => {
    const m = /(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)\b/i.exec(raw);
    if (!m) return null;
    const n = Number(m[1]);
    const years = /^y/i.test(m[2]);
    const wantMonths = /_months?$/.test(ctx.key) || /month/i.test(ctx.unit ?? '');
    const wantYears = /_years?$/.test(ctx.key) || /year/i.test(ctx.unit ?? '');
    if (ctx.dataType === 'number') {
      const value = wantMonths ? (years ? Math.round(n * 12) : n) : wantYears ? (years ? n : Math.round((n / 12) * 100) / 100) : n;
      return { value, note: `${was(raw)}${wantMonths && years ? ' — converted years to months' : wantYears && !years ? ' — converted months to years' : ''}` };
    }
    const value = `${n} ${years ? (n === 1 ? 'year' : 'years') : n === 1 ? 'month' : 'months'}`;
    return { value, note: raw.trim() === value ? '' : was(raw) };
  },
};

/* ── colour temperature ────────────────────────────────────────────────────── */
const colourTemperature: Rule = {
  name: 'colour_temperature',
  test: (k) => /colou?r_temp|(^|_)cct$|correlated_colou?r/.test(k),
  apply: (raw, ctx) => {
    const m = /(\d{4})\s*K\b/i.exec(raw) ?? /(\d{4})\s*kelvin/i.exec(raw) ?? /\b(\d\.\d)\s*k\b/i.exec(raw);
    if (!m) return null;
    const n = m[1].includes('.') ? Math.round(Number(m[1]) * 1000) : Number(m[1]);
    if (ctx.dataType === 'number') return { value: n, note: was(raw) };
    const value = `${n} K`;
    return { value, note: raw.trim() === value ? '' : was(raw) };
  },
};

export const RULES: Rule[] = [energyRating, ipRating, ikRating, baseType, isStandard, countryOfOrigin, warranty, colourTemperature];

/** The generic split: head before the first explanatory separator when the head is a usable token (≤ 40 chars). */
const SEPARATORS = [' — ', ' – ', ' - ', ': ', '; ', ' (', ', as ', ' for ', ' with ', ' as per ', ' i.e. ', ' e.g. ', ' such as '];
export function genericSplit(raw: string): RuleResult | null {
  const s = raw.trim();
  if (s.length <= MAX_TOKEN) return null;
  let best: string | null = null;
  for (const sep of SEPARATORS) {
    const i = s.indexOf(sep);
    if (i <= 0) continue;
    const head = s
      .slice(0, i)
      .trim()
      .replace(/[,:;–—-]+$/, '')
      .trim();
    if (head.length < 3 || head.length > MAX_TOKEN || !/[a-z0-9]/i.test(head)) continue;
    if (best === null || head.length > best.length) best = head;
  }
  if (best === null) return null;
  return { value: best, note: was(s) };
}

/** Enum token match: exact → case-insensitive → squashed → single word-bounded containment → first of several (noted). */
export function enumMatch(raw: string, allowed: string[]): { value: string; note: string } | null {
  const s = raw.trim();
  const exact = allowed.find((a) => a === s);
  if (exact) return { value: exact, note: '' };
  const ci = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
  if (ci) return { value: ci, note: '' };
  const squash = (x: string) =>
    x
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '');
  const sq = allowed.find((a) => squash(a) && squash(a) === squash(s));
  if (sq) return { value: sq, note: was(s) };
  const lower = s.toLowerCase();
  const hits = allowed
    .map((a) => ({ a, at: wordIndex(lower, a.toLowerCase()) }))
    .filter((h) => h.at >= 0)
    .sort((x, y) => x.at - y.at || y.a.length - x.a.length);
  if (hits.length === 1) return { value: hits[0].a, note: was(s) };
  if (hits.length > 1) return { value: hits[0].a, note: `${was(s)} — several registry values named (${hits.map((h) => h.a).join(', ')}); kept the first` };
  return null;
}

function wordIndex(haystack: string, needle: string): number {
  if (!needle) return -1;
  const re = new RegExp(`(?:^|[^a-z0-9])(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^a-z0-9])`, 'i');
  const m = re.exec(haystack);
  return m ? m.index + m[0].indexOf(m[1]) : -1;
}

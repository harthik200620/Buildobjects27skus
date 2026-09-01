/**
 * The vision assist, at last — and on Claude rather than Gemini.
 *
 * `assets/3d/manifest.json` carries the same sentence on twenty-one of its twenty-eight models:
 * "judge skipped — no vision assist wired". `@buildobjects/llm` has the judge (`judgeImages`,
 * `judgeModelMatch`) and it is good; what it does not have is a provider that answers. It speaks
 * only to Gemini, and this project's Gemini account has returned `429 RESOURCE_EXHAUSTED — "Your
 * prepayment credits are depleted"` to every generateContent call since 2026-08-26 (re-checked
 * 2026-08-30; listing models still works, which is what makes it look alive).
 *
 * So this is a second, small provider for the one job that was blocking everything downstream:
 * looking at a photograph and saying what is in it. It talks to the Messages API through
 * BO_CHAT_BASE_URL, which is where this deployment's Claude key actually points.
 *
 * WHY IT EXISTS AT ALL. Image roles in this catalogue are assigned by POSITION, not content —
 * `stages.ts` is literally `const role = IMAGE_ROLES[i]` and `validate-curated.ts` enforces it —
 * so every SKU reads `1:hero 2:angle 3:in_context 4:detail 5:pack_or_dimensions` whatever the
 * pictures show. Position 1 is called the hero whether it is the product, its carton, a rival
 * brand's sack, or a WiFi router. Nothing in the data can tell them apart, and the 3D pipeline
 * modelled position 1 for every SKU. That is how a bulb came to be a cardboard box.
 *
 * Results are cached by sha1(image) + model + prompt version, so a re-run costs nothing and a
 * changed prompt costs everything again — which is the right way round.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { REPO_ROOT } from '../config';

/** Bump when the prompt or the schema changes, so cached verdicts from the old one are ignored. */
const PROMPT_VERSION = 'v6';
const CACHE_DIR = path.join(REPO_ROOT, 'storage', 'reports', 'vision');

export const SHOWS = ['bare_product', 'product_in_packaging', 'packaging_only', 'other_product', 'accessory_only', 'lifestyle_or_stock', 'no_product'] as const;
export type Shows = (typeof SHOWS)[number];

export interface ImageVerdict {
  shows: Shows;
  /** Exactly one unit in frame — a four-pack cannot model a single lamp. */
  single_unit: boolean;
  /** Visible branding is the SKU's brand, or nothing is branded. False = somebody else's product. */
  brand_ok: boolean;
  /** Plain white or seamless studio ground, so a cut-out is possible. */
  clean_background: boolean;
  /**
   * Visible evidence that this is a DIFFERENT model from the same maker — a different form
   * factor, a legible model number that is not this one, or a filename naming another product.
   * `brand_ok` does not cover it: Dahua's own site offered a Flame Detection Camera for an
   * HAC-HDW1200TRQ and it passed every other check, because it really is a Dahua eyeball camera.
   */
  wrong_model: boolean;
  /** The model's own answer to the only question the 3D pipeline asks. */
  usable_for_3d: boolean;
  why: string;
}

export interface ProductIdentity {
  sku: string;
  brand: string;
  name: string;
  category: string;
}

/**
 * What the photograph would be FOR, which decides how strictly to read it.
 *
 * A tile or a pane of glass is photographed as a full-frame swatch: the picture IS the material,
 * it is mapped onto a face, and it is never cut out — so "is the background clean" is a question
 * about a background that does not exist, and asking it rejected every tile in the catalogue.
 * A bulb or a camera is photographed as an object on white and has to be separated from it.
 */
export type PhotoUse = 'surface' | 'object' | 'packaged';
const SURFACE_CATEGORIES = new Set(['tiles', 'glass']);
/*
 * Categories where the RETAIL PACK IS THE PRODUCT.
 *
 * "Bare product, out of any box" is the right test for a bulb or a camera and a nonsense for a
 * 50 kg sack of cement: there is no photograph of loose cement powder, and if there were it is
 * not what the AR view puts on a customer's floor — a bag is. The same goes for a two-part epoxy,
 * which is sold, shipped and set down as a pair of tins.
 *
 * Applying the object rule to them rejected every cement and epoxy photograph in the catalogue
 * with the reason `product_in_packaging` — a true observation and the wrong conclusion. For these
 * the pack is admissible; what still is not is a pack with no product identity: an empty carton,
 * a multipack, somebody else's livery, or the wrong variant.
 */
const PACKAGED_CATEGORIES = new Set(['cement', 'epoxy']);
export const photoUse = (category: string): PhotoUse =>
  SURFACE_CATEGORIES.has(category) ? 'surface' : PACKAGED_CATEGORIES.has(category) ? 'packaged' : 'object';

const PROMPT = (p: ProductIdentity, hint?: string) => `You are checking one catalogue photograph before it is used to build a 3D model of a product.

The product is: ${p.brand} — ${p.name} (category: ${p.category.replace(/-/g, ' ')}).${
  hint
    ? `
The image file is named: ${hint}
Treat that name as evidence about what the file depicts, but judge the picture too.`
    : ''
}

Answer about THE IMAGE ONLY. Be strict and literal; do not give the benefit of the doubt.

"shows" — pick exactly one:
  bare_product        the product itself, out of any box or wrapper
  product_in_packaging  the product AND its carton/box/bag together, or visible through a window
  packaging_only      only a carton, box, bag or label — the product is artwork printed on it
  other_product       a different product, or the same kind of product from a different brand
  accessory_only      only a bracket, cable, remote, recorder or other accessory
  lifestyle_or_stock  a marketing banner, an installed scene, people at work, a stock photo
  no_product          scenery, a blank background, or nothing identifiable

Then:
  single_unit        true only if exactly ONE unit of the product is in frame. A TWO-PART product
                     sold as one kit — Comp. A and Comp. B, base and hardener, resin and activator —
                     is ONE unit when both parts are shown together and nothing else is: that pair
                     is what ships, and what a 3D model of it depicts. Four bulbs in a row or three
                     bags stacked are still not one unit.
  brand_ok           false ONLY if visible branding names a DIFFERENT company than "${p.brand}".
                     Generic wording on the product ("POWDER", "ABC", "LED", a capacity or a
                     model number) is not a brand. No legible branding at all is fine: true.
  clean_background   true for plain white or a seamless studio backdrop. If the product FILLS the
                     frame edge to edge so there is no background to judge — a tile swatch, a
                     sheet of glass — answer true; there is nothing to cut it out from.
  wrong_model        true if anything says this is a DIFFERENT model from the same maker. Weigh
                     the FILE NAME heavily: brand CDNs name a file after what it depicts, so a
                     name carrying a product line, series or capability that does NOT appear in
                     "${p.name}" means the file is of another product — "Flame-Detection-Camera"
                     is not a "Fixed-focal Eyeball Camera", "WizMind" is not "Lite Series". Also
                     true for a clearly different form factor or a legible model number that is
                     not this one. When the file name is neutral (a bare SKU code, a number) and
                     the picture does not contradict the product, answer false.
  usable_for_3d      true only if ALL of: shows=bare_product, single_unit, brand_ok,
                     clean_background, and NOT wrong_model. EXCEPT for cement and epoxy, where the
                     retail pack IS the product and no photograph of the bare contents exists: for
                     those, shows=product_in_packaging also counts if everything else holds.
  why                one short sentence, naming what you actually see

Reply with ONLY a JSON object and no other text:
{"shows":"...","single_unit":true,"brand_ok":true,"clean_background":true,"wrong_model":false,"usable_for_3d":true,"why":"..."}`;

const pick = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return undefined;
};

export const visionKey = (): string => pick('BO_CHAT_API_KEY', 'ANTHROPIC_API_KEY') ?? '';
export const visionBase = (): string => (pick('BO_CHAT_BASE_URL', 'ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
/** Haiku: this is a classification, run 135 times. Nothing here needs a larger model. */
export const visionModel = (): string => pick('BO_CHAT_VISION_MODEL', 'BO_CHAT_MODEL') ?? 'claude-haiku-4-5-20251001';
export const hasVision = (): boolean => visionKey().length > 0;

/**
 * Long edge sent to the model. Vision tokenises about a megapixel and refuses very large uploads
 * outright — a 4000 px brand render came back as "Your request was invalid" for six of Dahua's
 * eight candidates, which reads like a bad photograph and is actually a bad request. Normalising
 * to JPEG at this size fixes those and costs a third of the tokens; nothing in this classification
 * needs more resolution than a person would use to answer the same question.
 */
const SEND_MAX_PX = 1400;

/**
 * Bytes ready for the vision call — WITHOUT going through sharp when it can be avoided.
 *
 * Two things bit here in one afternoon.
 *
 * A 4000 px brand render came back as "Your request was invalid" for six of Dahua's eight
 * candidates: too large, which reads like a bad photograph and is actually a bad request. So big
 * images do have to be shrunk.
 *
 * But shrinking them cost four models their judgement. This module is loaded INTO the photoreal
 * runner as its `--assist`, and that process has already loaded `@buildobjects/assets3d`'s copy of
 * sharp — two libvips instances in one process, which is what the
 * `VipsInterpretation value "32" is invalid` warning and the `colourspace: parameter space not
 * set` failures actually were. Both images decoded perfectly when tested on their own.
 *
 * So sharp is now the exception rather than the rule: anything already small enough goes to the
 * model as it came off the wire, which is most things and is also faster. Only a genuinely large
 * image is resized, and if that fails it is still sent whole rather than not judged at all —
 * a decoding quirk must never be the reason a model ships unchecked.
 */
const SEND_MAX_BYTES = 3_500_000;
const MAGIC: [string, string][] = [
  ['89504e47', 'image/png'],
  ['ffd8ff', 'image/jpeg'],
  ['52494646', 'image/webp'],
];
const sniff = (b: Buffer): string | null => {
  const head = b.subarray(0, 4).toString('hex');
  for (const [magic, mime] of MAGIC) if (head.startsWith(magic)) return mime;
  return null;
};

const forSending = async (bytes: Buffer): Promise<{ data: string; media_type: string }> => {
  const mime = sniff(bytes);
  if (mime && bytes.length <= SEND_MAX_BYTES) return { data: bytes.toString('base64'), media_type: mime };
  try {
    const out = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(SEND_MAX_PX, SEND_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { data: out.toString('base64'), media_type: 'image/jpeg' };
  } catch (e) {
    if (mime) return { data: bytes.toString('base64'), media_type: mime };
    throw new Error(`could not read the image for the vision call (${e instanceof Error ? e.message : String(e)})`);
  }
};

function cacheFile(bytes: Buffer, p: ProductIdentity, hint?: string): string {
  const h = createHash('sha1')
    .update(bytes)
    .update(visionModel())
    .update(PROMPT_VERSION)
    .update(p.brand)
    .update(p.name)
    .update(hint ?? '')
    .digest('hex');
  return path.join(CACHE_DIR, `${h}.json`);
}

/** Strip the ```json fences Haiku wraps JSON in about half the time. */
function parseVerdict(text: string, use: PhotoUse): ImageVerdict {
  const body = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`no JSON object in reply: ${text.slice(0, 120)}`);
  const raw = JSON.parse(body.slice(start, end + 1)) as Partial<ImageVerdict>;
  if (!raw.shows || !(SHOWS as readonly string[]).includes(raw.shows)) throw new Error(`unknown "shows": ${String(raw.shows)}`);
  return {
    shows: raw.shows,
    single_unit: !!raw.single_unit,
    brand_ok: raw.brand_ok !== false,
    clean_background: !!raw.clean_background,
    wrong_model: !!raw.wrong_model,
    /* Recomputed rather than trusted: the four facts are the finding, and the conclusion has to
       follow from them or the file records a contradiction nobody can act on. Background is not
       part of it for a surface material — see `photoUse`. */
    /* A packaged good may arrive as the pack; everything else must be the bare product. The other
       four conditions are unchanged — a multipack, a rival's livery or the wrong variant is just
       as useless in a bag as it is in a bulb. */
    usable_for_3d:
      (use === 'packaged' ? raw.shows === 'bare_product' || raw.shows === 'product_in_packaging' : raw.shows === 'bare_product') &&
      !!raw.single_unit &&
      raw.brand_ok !== false &&
      !raw.wrong_model &&
      (use === 'surface' || !!raw.clean_background),
    why: String(raw.why ?? '').slice(0, 240),
  };
}

export async function classifyImage(
  file: string,
  p: ProductIdentity,
  opts: { timeoutMs?: number; force?: boolean; hint?: string } = {},
): Promise<ImageVerdict> {
  const bytes = await fs.promises.readFile(file);
  const cache = cacheFile(bytes, p, opts.hint);
  if (!opts.force && fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8')) as ImageVerdict;

  const body = {
    model: visionModel(),
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', ...(await forSending(bytes)) } },
          { type: 'text', text: PROMPT(p, opts.hint) },
        ],
      },
    ],
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await fetch(`${visionBase()}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': visionKey(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { content?: { text?: string }[] };
  const verdict = parseVerdict(json.content?.[0]?.text ?? '', photoUse(p.category));
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(verdict, null, 2));
  return verdict;
}

// ── 3D model vs the photograph it was built from ─────────────────────────────

export interface ModelMatch {
  same_product: boolean;
  silhouette: number;
  colour: number;
  branding: number;
  overall: number;
  defects: string[];
}

const MATCH_PROMPT = (p: ProductIdentity) => `The FIRST image is the official photograph of ${p.brand} ${p.name}.
The SECOND is a render of a 3D model generated from it.

Judge whether the render depicts THAT PRODUCT, well enough to show a customer at true size in their own room.

Score 0.0-1.0:
  silhouette  shape and proportions agree
  colour      colours, materials and finish agree
  branding    printed text and labels are placed like the photo and are not garbled. Score 1.0 when
              the product carries no branding and the render invents none.
  overall     your combined verdict on shipping this model

same_product  false if the render is a different object — notably if it is the product's BOX,
              a fragment, or something that is not the product at all
defects       concrete faults: missing or extra parts, melted or hollow geometry, garbled text,
              floating pieces, a hand or a person, wrong orientation. Empty list means none.

Reply with ONLY a JSON object:
{"same_product":true,"silhouette":0.0,"colour":0.0,"branding":0.0,"overall":0.0,"defects":["..."]}`;

/**
 * The T7 gate the 3D manifest records as never having run: "judge skipped — no vision assist
 * wired". It exists in @buildobjects/llm as `judgeModelMatch` and speaks only to Gemini, which
 * this account cannot reach. This is the same comparison against the provider that answers.
 */
export async function judgeModelMatch(hero: Buffer, preview: Buffer, p: ProductIdentity, opts: { timeoutMs?: number } = {}): Promise<ModelMatch> {
  const body = {
    model: visionModel(),
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'FIRST — the official product photograph:' },
          { type: 'image', source: { type: 'base64', ...(await forSending(hero)) } },
          { type: 'text', text: 'SECOND — a render of the generated 3D model:' },
          { type: 'image', source: { type: 'base64', ...(await forSending(preview)) } },
          { type: 'text', text: MATCH_PROMPT(p) },
        ],
      },
    ],
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await fetch(`${visionBase()}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': visionKey(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text ?? '';
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error(`no JSON in judge reply: ${text.slice(0, 120)}`);
  const raw = JSON.parse(cleaned.slice(a, b + 1)) as Partial<ModelMatch>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  /* A render that is not the product cannot score well however pretty it is, so the conclusion is
     floored rather than taken on trust — the same reason classifyImage recomputes usable_for_3d. */
  const same = raw.same_product !== false;
  return {
    same_product: same,
    silhouette: num(raw.silhouette),
    colour: num(raw.colour),
    branding: num(raw.branding),
    overall: same ? num(raw.overall) : Math.min(num(raw.overall), 0.2),
    defects: Array.isArray(raw.defects) ? raw.defects.map(String).slice(0, 8) : [],
  };
}

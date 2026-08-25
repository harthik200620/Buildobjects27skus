/**
 * Finds a SKU's photographs on its own manufacturer's page.
 *
 * Why this exists: the curated files carried five image URLs per SKU and 89 of the 134 were
 * not on the brand's own domain. Forty-five of those were on a direct competitor's — every
 * UltraTech image pointed at ambujahelp.in, every Somany image at kajariaceramics.com,
 * Waaree's hero at adanisolar.com — and several were Unsplash stock. A store that sells the
 * real product cannot show a rival's bag and call it UltraTech, so the URLs are no longer
 * hand-written. They are read out of the official product page the fetch stage already
 * captured, and anything on another catalogue brand's domain is refused outright.
 */
import { load } from 'cheerio';

/** A brand in this catalogue, for the conflict rule. */
export interface BrandDomains {
  slug: string;
  domains: string[];
}

export interface Candidate {
  url: string;
  /** How the page offered it — og:image and JSON-LD are the page's own declaration of its subject. */
  origin: 'og' | 'json_ld' | 'srcset' | 'img' | 'css';
  score: number;
  why: string[];
}

/** Filenames that are furniture, not product photography. */
const FURNITURE =
  /(logo|icon|sprite|favicon|placeholder|spacer|pixel|blank|avatar|banner|arrow|bullet|chevron|social|share|whatsapp|facebook|twitter|linkedin|youtube|instagram|play-|close|menu|hamburger|search|cart|flag|loader|spinner|thumb-up|star|tick|check|badge-|pattern|texture-bg|bg-|header|footer|nav-)/i;
/** Vector marks and tracking gifs are never a product photograph. */
const NOT_PHOTO = /\.(svg|gif|ico|bmp)(\?|$)/i;
/** Marketplace and stock-library hosts. Real listings, but not the manufacturer's own asset. */
const NOT_OFFICIAL = /(unsplash|pexels|pixabay|shutterstock|istockphoto|gettyimages|imimg\.com|tistatic|media-amazon|flipkart|moglix|indiamart)/i;
/** A width hinted in the path or query — Contentful, AEM, WordPress and Shopify all leak it. */
const WIDTH_HINT = /(?:[?&](?:w|width|sw)=(\d{3,5}))|(?:[-_](\d{3,5})x\d{3,5}\.)/i;
/** Paths a manufacturer keeps product photography under. */
const PRODUCT_PATH = /\/(dam|media|products?|assets|uploads|images?|content|catalog|document|permalink)\//i;
/**
 * A path segment that says the asset belongs to the product itself, or to something else on
 * the site. CP Plus name every asset with a UUID, so the only thing separating their camera
 * from the router on the same page is `/prodassets/product/…` against `/prodassets/category/…`
 * — and without this the category thumbnail won, putting a Wi-Fi router on a camera SKU.
 */
const OWN_PRODUCT_PATH = /\/(product|products|prodassets\/product)\//i;
const NOT_THIS_PRODUCT_PATH = /\/(category|categories|banner|banners|slider|carousel|brand|brands|blog|news)\//i;

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'pack',
  'set',
  'type',
  'series',
  'model',
  'india',
  'ltd',
  'limited',
  'pvt',
  'new',
  'high',
  'low',
  'best',
  'grade',
  'class',
  'size',
  'mm',
  'kg',
  'w',
  'v',
  'a',
  'of',
  'in',
  'on',
  'by',
  'at',
  'to',
]);

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Significant words of a product name, for matching against a filename. */
function tokens(...parts: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      parts
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ];
}

function absolute(src: string, pageUrl: string): string | null {
  try {
    if (/^data:/i.test(src)) return null;
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

function widthHint(url: string): number {
  const m = WIDTH_HINT.exec(url);
  return m ? Number(m[1] ?? m[2]) : 0;
}

/**
 * The same photograph at the size the brand actually holds it, not the size the page asked for.
 *
 * Every major site CDN encodes a resize in the URL, so a page showing a 49×49 thumbnail and a
 * 500×500 hero is offering one image twice. Ceasefire's page yielded nothing but 49-pixel Wix
 * thumbnails until this existed. Returns the variants to try, largest first, always ending
 * with the URL as written so a CDN that dislikes the rewrite still gets its chance.
 */
export function fullSizeVariants(url: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u !== url && !out.includes(u)) out.push(u);
  };

  // Wix: /media/{asset}/v1/fill/w_49,h_49,.../file.png → /media/{asset}
  const wix = /^(https?:\/\/static\.wixstatic\.com\/media\/[^/]+)\/v1\//i.exec(url);
  if (wix) push(wix[1]);

  // Shopify: name_1024x1024.jpg → name.jpg, and drop the width/height query.
  if (/cdn\.shopify\.com|\/cdn\/shop\//i.test(url)) push(url.replace(/_\d{2,5}x\d{0,5}(?=\.[a-z]{3,4})/i, '').replace(/[?&](width|height)=\d+/gi, ''));

  // Contentful and other query-resized CDNs: the naked asset is the original.
  if (/images\.ctfassets\.net|\.imgix\.net|cdn11\.bigcommerce\.com/i.test(url)) push(url.split('?')[0]);

  // WordPress writes the crop into the filename: photo-300x200.jpg → photo.jpg
  if (/\/wp-content\/uploads\//i.test(url)) push(url.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]{3,4})/i, ''));

  // Sitecore/AEM `-/media/...ashx`: the sizing lives in the query and the asset is fine without it.
  if (/\/-\/media\/.*\.ashx/i.test(url)) push(url.split('?')[0]);

  // A `_thumb` / `-small` suffix before the extension, which most CMSs use and most keep the
  // original beside. Dahua serve their camera as an 8.9 KB thumbnail and a 1.4 MB original
  // that differ only by this, and the thumbnail is unreadable at card size.
  const thumb = /[-_](thumb|thumbnail|small|sm|mini|preview)(?=\.[a-z]{3,4}(\?|$))/i;
  if (thumb.test(url)) push(url.replace(thumb, ''));

  out.push(url);
  return out;
}

/**
 * True when the host belongs to a brand in this catalogue that is not this SKU's brand.
 * This is the rule that would have stopped every one of the forty-five competitor images.
 */
export function isRivalHost(url: string, brandSlug: string, brands: BrandDomains[]): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const b of brands) {
    if (b.slug === brandSlug) continue;
    for (const d of b.domains) {
      const dom = d.toLowerCase().replace(/^www\./, '');
      if (host === dom || host.endsWith(`.${dom}`)) return b.slug;
    }
  }
  return null;
}

export interface DiscoverInput {
  html: string;
  pageUrl: string;
  brandSlug: string;
  brandName: string;
  productName: string;
  modelNo?: string | null;
  brands: BrandDomains[];
}

/**
 * Ranked photograph candidates from one captured page, best first. Scoring favours what the
 * page itself nominates as its subject (og:image, JSON-LD) and filenames that name the
 * product, and refuses anything on a rival's domain, a stock library or a marketplace.
 */
export function discoverImages(input: DiscoverInput): Candidate[] {
  const $ = load(input.html);
  const raw = new Map<string, Candidate['origin']>();

  const add = (src: string | undefined, origin: Candidate['origin']) => {
    if (!src) return;
    const abs = absolute(src.trim(), input.pageUrl);
    if (abs && !raw.has(abs)) raw.set(abs, origin);
  };

  $('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]').each((_, el) => add($(el).attr('content'), 'og'));

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return void node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === 'image') {
            if (typeof v === 'string') add(v, 'json_ld');
            else if (Array.isArray(v))
              for (const x of v)
                if (typeof x === 'string') add(x, 'json_ld');
                else if (v && typeof v === 'object') add((v as { url?: string }).url, 'json_ld');
          } else walk(v);
        }
      };
      walk(JSON.parse($(el).contents().text()));
    } catch {
      /* a page with malformed JSON-LD still has its <img> tags */
    }
  });

  // Take the widest entry of every srcset — that is the one worth downloading.
  $('img[srcset], source[srcset]').each((_, el) => {
    const best = ($(el).attr('srcset') ?? '')
      .split(',')
      .map((part) => {
        const [u, d] = part.trim().split(/\s+/);
        return { u, w: Number((d ?? '').replace(/[^\d]/g, '')) || 0 };
      })
      .filter((x) => x.u)
      .sort((a, b) => b.w - a.w)[0];
    if (best) add(best.u, 'srcset');
  });

  /*
   * Lazy-loading themes park the real URL in a data attribute and leave `src` holding a
   * transparent data: URI. Taking `src` first therefore finds nothing on exactly the pages
   * that need this most, so a data: `src` is treated as absent.
   */
  $('img').each((_, el) => {
    const img = $(el);
    const src = img.attr('src');
    const real = src && !/^data:/i.test(src.trim()) ? src : undefined;
    add(real ?? img.attr('data-src') ?? img.attr('data-original') ?? img.attr('data-lazy-src'), 'img');
  });

  $('[style*="background-image"]').each((_, el) => {
    const m = /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i.exec($(el).attr('style') ?? '');
    if (m) add(m[2], 'css');
  });

  const nameTokens = tokens(input.productName);
  const model = input.modelNo ? norm(input.modelNo) : '';
  const out: Candidate[] = [];

  for (const [url, origin] of raw) {
    const why: string[] = [];
    if (NOT_PHOTO.test(url)) continue;
    if (NOT_OFFICIAL.test(url)) continue;
    const rival = isRivalHost(url, input.brandSlug, input.brands);
    if (rival) continue;

    const file = url.split('?')[0].split('/').pop() ?? '';
    if (FURNITURE.test(file)) continue;

    let score = 0;
    if (origin === 'og' || origin === 'json_ld') {
      score += 40;
      why.push('the page names it as its subject');
    }
    const flat = norm(url);
    if (model && model.length >= 4 && flat.includes(model)) {
      score += 60;
      why.push('filename carries the model number');
    }
    const hits = nameTokens.filter((t) => flat.includes(t));
    if (hits.length) {
      score += Math.min(45, hits.length * 15);
      why.push(`filename matches ${hits.slice(0, 3).join(', ')}`);
    }
    if (PRODUCT_PATH.test(url)) {
      score += 12;
      why.push('served from a product asset path');
    }
    if (OWN_PRODUCT_PATH.test(url)) {
      score += 18;
      why.push('under the site’s product asset path');
    }
    if (NOT_THIS_PRODUCT_PATH.test(url)) {
      score -= 45;
      why.push('under a category / banner path — not this product');
    }
    const w = widthHint(url);
    if (w >= 1600) {
      score += 25;
      why.push(`${w}px hinted`);
    } else if (w >= 1000) {
      score += 12;
      why.push(`${w}px hinted`);
    } else if (w && w < 400) {
      score -= 30;
      why.push(`only ${w}px hinted`);
    }
    if (origin === 'css') score -= 10;
    out.push({ url, origin, score, why });
  }

  return out.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}

/**
 * What this device knows about the person using it: what they have looked at, rated, ordered and
 * loved, and which of their friends love what.
 *
 * WHY IT IS ON THE DEVICE AND NOT IN A TABLE. The deployment has no database — `lib/static-
 * catalogue.ts` IS the live site — so anything kept server-side would work on a laptop and fail in
 * production, which is the worst of both. Everything here is written by the person it describes,
 * belongs to them, and is small; localStorage is the honest home for it. It also means none of it
 * is sent anywhere: the store learns nothing about you from this file.
 *
 * WHAT IT IS FOR. The chips over "On the shelf now" — Rating 4.0+, Previously ordered, New to you,
 * Loved by friends — are questions about the shopper, not about the catalogue, and this is the
 * only place that can answer them. Each field is written by a real action somewhere in the store:
 *
 *   viewed   a product page was opened            components/RecordView.tsx
 *   rated    you gave it stars                    components/YourVerdict.tsx
 *   ordered  you placed the order                 components/cart/BoCart.tsx
 *   loved    you pressed the heart                components/YourVerdict.tsx
 *   friends  you opened a list a friend shared    components/FriendLoves.tsx
 *
 * NOTHING HERE IS INVENTED. A fresh device has no ratings and no orders, and the chips that read
 * them keep nothing — exactly as they would for a new customer of any shop. That is the honest
 * state, and it fills in as the person uses the store.
 */

export interface Shopper {
  /** sku → when the product page was last opened, epoch ms. */
  viewed: Record<string, number>;
  /** sku → the stars this person gave it, 1–5. */
  rated: Record<string, number>;
  /** sku → when it was last ordered, epoch ms. */
  ordered: Record<string, number>;
  /** sku → when it was loved, epoch ms. */
  loved: Record<string, number>;
  /** sku → the friends who love it, by the name their shared list carried. */
  friends: Record<string, string[]>;
}

export const EMPTY_SHOPPER: Shopper = { viewed: {}, rated: {}, ordered: {}, loved: {}, friends: {} };

const KEY = 'bo_shopper';
/** Broadcast so every mounted view — chips, hearts, stars — agrees within the tab. */
export const SHOPPER_EVENT = 'bo-shopper';

/** The most recent things first, capped so one device's history cannot grow without bound. */
const KEEP = 400;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Anything on disk is data somebody could have edited, so every field is checked, not trusted. */
export function parseShopper(raw: unknown): Shopper {
  if (!isRecord(raw)) return { ...EMPTY_SHOPPER };
  const stamps = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!isRecord(v)) return out;
    for (const [sku, at] of Object.entries(v)) if (typeof at === 'number' && Number.isFinite(at)) out[sku] = at;
    return out;
  };
  const stars: Record<string, number> = {};
  if (isRecord(raw.rated)) for (const [sku, n] of Object.entries(raw.rated)) if (typeof n === 'number' && n >= 1 && n <= 5) stars[sku] = Math.round(n);
  const friends: Record<string, string[]> = {};
  if (isRecord(raw.friends))
    for (const [sku, who] of Object.entries(raw.friends)) {
      if (!Array.isArray(who)) continue;
      const names = [...new Set(who.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.trim().slice(0, 40)))];
      if (names.length) friends[sku] = names;
    }
  return { viewed: stamps(raw.viewed), rated: stars, ordered: stamps(raw.ordered), loved: stamps(raw.loved), friends };
}

/** Keep only the newest `KEEP` entries of a stamped map. */
function trim(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map);
  if (entries.length <= KEEP) return map;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, KEEP));
}

export function readShopper(): Shopper {
  if (typeof window === 'undefined') return { ...EMPTY_SHOPPER };
  try {
    return parseShopper(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...EMPTY_SHOPPER };
  }
}

/**
 * Read, change, write, tell everyone. The whole record is rewritten each time, which is fine at
 * this size and removes a class of bug: there is no partial update to get wrong.
 */
export function updateShopper(change: (s: Shopper) => Shopper): void {
  if (typeof window === 'undefined') return;
  try {
    const next = change(readShopper());
    localStorage.setItem(KEY, JSON.stringify({ ...next, viewed: trim(next.viewed), ordered: trim(next.ordered), loved: trim(next.loved) }));
    window.dispatchEvent(new Event(SHOPPER_EVENT));
  } catch {
    /* A full or disabled store is not worth breaking a page over. */
  }
}

export const markViewed = (sku: string) => updateShopper((s) => ({ ...s, viewed: { ...s.viewed, [sku]: Date.now() } }));

export const markOrdered = (skus: string[]) =>
  updateShopper((s) => ({ ...s, ordered: { ...s.ordered, ...Object.fromEntries(skus.map((sku) => [sku, Date.now()])) } }));

/** Stars, 1–5. Rating it again replaces the old score; 0 takes the rating away. */
export function rate(sku: string, stars: number): void {
  updateShopper((s) => {
    const rated = { ...s.rated };
    if (stars >= 1 && stars <= 5) rated[sku] = Math.round(stars);
    else delete rated[sku];
    return { ...s, rated };
  });
}

export function toggleLove(sku: string): void {
  updateShopper((s) => {
    const loved = { ...s.loved };
    if (loved[sku]) delete loved[sku];
    else loved[sku] = Date.now();
    return { ...s, loved };
  });
}

/** Someone shared their list; remember which of their loves this device now knows about. */
export function addFriendLoves(name: string, skus: string[]): number {
  const who = name.trim().slice(0, 40) || 'A friend';
  let added = 0;
  updateShopper((s) => {
    const friends = { ...s.friends };
    for (const sku of skus) {
      const already = friends[sku] ?? [];
      if (already.includes(who)) continue;
      friends[sku] = [...already, who];
      added += 1;
    }
    return { ...s, friends };
  });
  return added;
}

/* ── sharing a list ───────────────────────────────────────────────────────────
   A link, and nothing else: no account, no server, no record of who sent what. The person who
   opens it decides whether to keep it (components/FriendLoves.tsx). */

export const LOVES_PARAM = 'loves';
export const LOVES_FROM_PARAM = 'from';

export function lovesLink(origin: string, path: string, name: string, skus: string[]): string {
  const p = new URLSearchParams();
  p.set(LOVES_FROM_PARAM, name.trim().slice(0, 40) || 'A friend');
  p.set(LOVES_PARAM, skus.join(','));
  return `${origin}${path}?${p.toString()}`;
}

/** What a shared link is offering, or null when it is not one. SKU codes only, capped. */
export function readLovesLink(params: URLSearchParams): { from: string; skus: string[] } | null {
  const raw = params.get(LOVES_PARAM);
  if (!raw) return null;
  const skus = [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9-]{3,64}$/.test(s)),
    ),
  ].slice(0, 100);
  if (!skus.length) return null;
  return { from: (params.get(LOVES_FROM_PARAM) ?? '').trim().slice(0, 40) || 'A friend', skus };
}

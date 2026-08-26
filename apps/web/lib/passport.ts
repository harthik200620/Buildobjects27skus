/**
 * THE BUILD OBJECTS PASSPORT.
 *
 * A membership identity for a builder, laid out like a passport data page because a passport is
 * the most-read identity document on earth: everybody already knows where the number goes, where
 * the photograph goes, and that the two lines at the bottom are the machine's copy of the rest.
 * Borrowing that layout means nobody has to be taught how to read this card.
 *
 * It is a BUILD OBJECTS card and it says so on its face, twice — the issuing authority line and
 * a standing note that it is not a government document. A store's loyalty card styled after a
 * passport is a design decision; one that could be mistaken for a travel document is a forgery,
 * and the difference is entirely in whether the card tells you which it is.
 *
 * ── WHERE IT LIVES ──────────────────────────────────────────────────────────────────────────
 * The browser, beside the profile name and the coin balance, which is where every other piece of
 * this account already lives. No migration, no new table, and nothing about a person leaves their
 * own machine — for a card carrying somebody's address and photograph that is the right default,
 * not a shortcut.
 */

const KEY = 'bo_passport';
const PHOTO_KEY = 'bo_passport_photo';

export type Gender = 'F' | 'M' | 'X' | '';

export interface Passport {
  name: string;
  address: string;
  mobile: string;
  email: string;
  gender: Gender;
  /** Stored as a date so the card never goes stale; the age on the face is computed. */
  dob: string;
  /** Optional and free text — "Site engineer", "Contractor", "Owner-builder". */
  role: string;
}

export const EMPTY: Passport = { name: '', address: '', mobile: '', email: '', gender: '', dob: '', role: '' };

/**
 * The number, and it is derived rather than stored.
 *
 * A stored identifier can be edited, cleared with the cache, or collide with somebody else's.
 * This one is a function of the account itself — the numeric user id and the phone the session
 * was opened with — so the same person gets the same number on every device they sign in from,
 * forever, and two people cannot share one.
 *
 * FNV-1a over the pair, printed in Crockford's base32: no I, L, O or U, so there is no character
 * in it that can be misread aloud or mistyped from a photograph of the card. Two groups of four
 * with a leading BO, which is the shape of a document number people are used to reading.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function passportId(uid: number | string, phone: string): string {
  const seed = `bo:${uid}:${phone}`;
  /* Two independent FNV-1a passes with different offsets — one 32-bit hash is 8 base32 digits
     and we want 8 that do not share a low-order tail. */
  const fnv = (offset: number) => {
    let h = offset >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  const digits = (h: number, n: number) => {
    let out = '';
    let x = h >>> 0;
    for (let i = 0; i < n; i += 1) {
      out = ALPHABET[x % 32] + out;
      x = Math.floor(x / 32);
    }
    return out;
  };
  return `BO-${digits(fnv(0x811c9dc5), 4)}-${digits(fnv(0x01000193), 4)}`;
}

/** Whole years, or null when no date of birth has been given. */
export function ageFrom(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function loadPassport(): Passport {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Passport>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function savePassport(p: Passport): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    window.dispatchEvent(new CustomEvent('bo-passport-changed'));
  } catch {
    /* private mode, or the quota — the card stays as it is on screen */
  }
}

export function loadPhoto(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PHOTO_KEY);
}

export function savePhoto(dataUrl: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (dataUrl) localStorage.setItem(PHOTO_KEY, dataUrl);
    else localStorage.removeItem(PHOTO_KEY);
    window.dispatchEvent(new CustomEvent('bo-passport-changed'));
  } catch {
    /* quota */
  }
}

/**
 * A photograph, cropped square and cut down to 320px before it is stored.
 *
 * localStorage is a handful of megabytes and it holds the cart, the estimate and the coin
 * history as well. A phone camera's 4MB JPEG base64-encodes to about 5.4MB and would evict all
 * of that. 320px is more than the card ever draws, at about 25KB.
 */
export function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 320;
      const x = c.getContext('2d');
      if (!x) return reject(new Error('Could not read that image'));
      x.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 320, 320);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image this browser can read'));
    };
    img.src = url;
  });
}

/**
 * The two lines across the foot of the card.
 *
 * A real passport's machine-readable zone is fixed-width and filler-padded with `<` so a scanner
 * knows where every field ends without needing to understand any of them. This follows the same
 * discipline against this card's own fields. It is not ICAO 9303 and does not pretend to be —
 * there is no country code and no check digit, because inventing either would be the one detail
 * that made this look like a document it is not.
 */
export function mrz(p: Passport, id: string): [string, string] {
  const up = (s: string, n: number) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .replace(/\s+/g, '<')
      .slice(0, n)
      .padEnd(n, '<');
  const num = id.replace(/-/g, '');
  const dob = p.dob ? p.dob.replace(/-/g, '').slice(2) : '<<<<<<';
  return [`BO<BUILDOBJECTS<<${up(p.name, 26)}`, `${up(num, 11)}${p.gender || '<'}${dob}${up(p.role || 'BUILDER', 26)}`];
}

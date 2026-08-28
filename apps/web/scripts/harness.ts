/**
 * What every script under scripts/ needs before it can do anything: the base URL, its flags, a
 * browser page that is already signed in, and the WCAG sums.
 *
 * Each of these was written out again in each script, and they had drifted: four scripts read
 * `--base` and three read `BASE_URL`, with three different defaults between them, so which server
 * a check ran against depended on which check it was.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser, BrowserContext, Page } from 'playwright';
import { sessionCookieFor } from './session-cookie';

/** Node's own parser, rather than a hand-rolled scan of argv in every script. */
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: false,
  options: {
    base: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string' },
    strict: { type: 'boolean' },
    shots: { type: 'boolean' },
  },
});

export const flags = values as { base?: string; only?: string; out?: string; strict?: boolean; shots?: boolean };

/** `--base`, then BASE_URL, then the production server this repo runs locally. */
export const BASE = (flags.base ?? process.env.BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** A comma-separated `--only`, already split and trimmed. */
export const only = (flags.only ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The two viewports every visual check uses. Desktop is a laptop, mobile is an iPhone 14. */
export const VIEWPORTS = {
  desktop: { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  /** The three counting audits calibrated their per-route budgets at this width; moving it moves them. */
  audit: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/** A signed-in page at the given viewport. Close the context, not the page. */
export async function openPage(
  browser: Browser,
  opts: { viewport?: ViewportName; motion?: 'reduce' | 'no-preference'; auth?: boolean } = {},
): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext({ ...VIEWPORTS[opts.viewport ?? 'desktop'], reducedMotion: opts.motion ?? 'reduce' });
  if (opts.auth !== false) await ctx.addCookies([sessionCookieFor(BASE)]);
  return { page: await ctx.newPage(), ctx };
}

/**
 * Two lines in the cart, written where the app keeps them. An empty cart paints no sticky total
 * and no order summary, so a check that measures either would pass by having nothing to measure.
 */
export async function seedCart(page: Page): Promise<void> {
  if (!page.url().startsWith(BASE)) await page.goto(`${BASE}/welcome`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() =>
    localStorage.setItem(
      'bo_estimate_picks',
      JSON.stringify([
        { sku_code: 'CEM-ULT-PPC50', qty: 12 },
        { sku_code: 'TIL-KAJ-GP00215', qty: 4 },
      ]),
    ),
  );
}

/** sRGB channel to linear light, per WCAG 2.1. */
const linear = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: readonly number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export function contrast(fg: readonly number[], bg: readonly number[]): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

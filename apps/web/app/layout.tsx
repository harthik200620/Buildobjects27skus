import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { REVEAL_BOOTSTRAP } from '@/lib/reveal-bootstrap';
import './globals.css';

/**
 * Type — the Build Objects type program. Four faces, four jobs, no overlap.
 *
 *   Display 1 (Instrument Serif)  — headlines and section titles. Nothing else.
 *   Display 2 (Audiowide)         — the brand name, wherever it appears, and nothing else.
 *   Sans 3    (Schibsted Grotesk) — every control, label, body and nav: the working face.
 *   Sans 5    (Encode Sans)       — every figure (tabular-nums, a true ₹).
 *
 * Display 1 is the change that carries the restyle. The store's type ramp ran 12 → 24px, a 2×
 * range, and a page whose headline is nearly the size of its caption has no drama in it however
 * correct the rest is. A display tier in a genuine editorial serif, topping out at 92px, is most
 * of the difference between this store and a commodity marketplace. Instrument Serif has one
 * weight and no bold, which is a constraint rather than a gap: display sizes take their weight
 * from SIZE, and a synthesised bold on a high-contrast serif is a smear.
 *
 * Sans 3 replaces Arimo, which is a Helvetica metric clone and therefore has no voice of its own —
 * it was in the store to be neutral and it succeeded. Schibsted Grotesk ships as one variable file
 * covering 400–800, so four static cuts and three round trips become one.
 *
 * Audiowide was briefly removed on the argument that a webfont loaded to set two words is a
 * webfont loaded for a picture, and the wordmark was drawn as vector instead. That was the wrong
 * call: the brand face IS the brand's voice, and a hand-cut substitute — however carefully
 * drawn — reads as a wireframe of the name rather than as the name. It is back, it is the only
 * thing that ever sets the brand name, and components/Wordmark.tsx is the one place that does it.
 *
 * Single-word fallbacks ONLY in localFont: next/font writes the list into the CSS variable
 * unquoted, and an unquoted multi-word family is invalid CSS that discards the whole
 * declaration. The ₹-bearing fallbacks live in --font-figure in theme.css, quoted.
 */
/*
 * INSTRUMENT SERIF IS NOT LOADED ANY MORE, and the reason is worth the note.
 *
 * A declared source is a preload the first paint waits on whether or not a glyph ever asks for
 * it — 23.5 KB on the critical path of every route in the store. What it was still setting, at
 * the end, was three ghost numerals on the front door and one empty-state line. The numerals are
 * figures and now use the figure face; the empty state is a title and now uses the brand face.
 *
 * That leaves two families, which is the right number for this store: Audiowide names things and
 * Encode Sans counts them. A third face is not a third voice, it is a third thing to keep in
 * step, and this one had already fallen out of step without anybody noticing.
 *
 * The file is still in public/fonts and fetch-fonts.mts still fetches it, so bringing it back is
 * one declaration here rather than a round trip.
 */
const brand = localFont({
  src: [{ path: '../public/fonts/BuildObjectsDisplay2-Regular.woff2', weight: '400', style: 'normal' }],
  display: 'swap',
  variable: '--font-brand-face',
  fallback: ['system-ui', 'sans-serif'],
});

const ui = localFont({
  /* One variable file, 400–800. A weight anywhere in that range costs nothing extra. */
  src: [{ path: '../public/fonts/BuildObjectsSans3-Variable.woff2', weight: '400 800', style: 'normal' }],
  display: 'swap',
  variable: '--font-ui-face',
  fallback: ['system-ui', 'sans-serif'],
});

const figure = localFont({
  /*
   * NO MEDIUM. A declared source is a preload the first paint waits on whether or not a glyph
   * ever asks for it, and nothing in this store sets a figure at 500 — 21.2 KB on the critical
   * path of every page for a weight no number is ever set at.
   *
   * Regular was dropped with it on the same reasoning and PUT BACK, because the reasoning was
   * wrong: `.price--card` sets 400, and the sampler that said otherwise only looked at elements
   * with direct text children while that price lives in nested spans. scripts/type-audit.mts
   * caught it on four routes within the minute — "wants figure 400, which is not a declared cut"
   * — which is precisely why that gate exists and why this note names it.
   */
  src: [
    { path: '../public/fonts/BuildObjectsSans5-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/BuildObjectsSans5-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: '../public/fonts/BuildObjectsSans5-Bold.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-figure-face',
  fallback: ['system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: { default: 'Build Objects', template: '%s · Build Objects' },
  description:
    'Construction materials for India — tax-paid prices per unit with the GST rate stated, every product viewable at true size in your own room, and an estimator that tells you what your house will cost. Delivering today across Andhra Pradesh and Telangana.',
  applicationName: 'Build Objects',
};

/** The mobile browser chrome takes the header colour, and the page is the same family of teal. */
export const viewport: Viewport = {
  themeColor: '#04141a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // One appearance: deep teal and silver. No theme toggle, no prefers-color-scheme branch.
    <html lang="en" className={`${brand.variable} ${ui.variable} ${figure.variable}`} suppressHydrationWarning>
      <head>
        {/*
         * Arms the scroll choreography before the browser paints, which is the only place it can
         * go: an effect runs after paint, so the reader would see the page assembled and then
         * blink out. It also arms the failsafe that un-hides everything if the observer never
         * mounts — see components/Reveal.tsx.
         *
         * text/javascript on the server, text/plain on the client, per Next's own
         * preventing-flash-before-hydration guide: it silences React's development warning about
         * rendering <script>, and stops the script re-running on a client re-render.
         * suppressHydrationWarning on <html> covers both that type swap and the class the script
         * adds to the element React is managing.
         */}
        <script
          type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
          suppressHydrationWarning
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string constant from lib/reveal-bootstrap.ts, with no interpolation of any kind — an inline <script> is the only thing that runs before first paint, and this is the shape Next's own preventing-flash-before-hydration guide prescribes
          dangerouslySetInnerHTML={{ __html: REVEAL_BOOTSTRAP }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

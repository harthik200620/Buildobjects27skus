import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { REVEAL_BOOTSTRAP } from '@/lib/reveal-bootstrap';
import './globals.css';

/**
 * Type — two faces, two jobs. Audiowide names things (the brand, every title) and Encode Sans
 * counts them (every figure, tabular, with a true rupee). Schibsted Grotesk is the working face
 * for controls, labels, body and nav.
 *
 * Instrument Serif is deliberately NOT loaded. A declared source is a preload the first paint
 * waits on whether or not a glyph asks for it — 23.5 KB on the critical path of every route — and
 * what it still set was three numerals and one empty-state line. The file is still in public/fonts
 * and fetch-fonts.mts still fetches it, so bringing it back is one declaration here.
 *
 * Single-word fallbacks ONLY in localFont: next/font writes the list into the CSS variable
 * unquoted, and an unquoted multi-word family is invalid CSS that discards the declaration. The
 * rupee-bearing fallbacks live in --font-figure in theme.css, quoted.
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

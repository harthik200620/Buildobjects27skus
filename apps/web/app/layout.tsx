import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Splash from '@/components/Splash';
import SplashController from '@/components/SplashController';
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

/**
 * Telugu, for the city greeting after sign-in and for nothing else.
 *
 * PRELOAD IS OFF, and that is the whole reason this is a separate declaration rather than a
 * fallback on --font-ui-face. A declared source is a preload the first paint waits on whether or
 * not a glyph asks for it — the note on Instrument Serif above is that lesson — and this face is
 * asked for on ONE screen, once, immediately after an OTP. Preloading it would put 22 KB on the
 * critical path of every route in the store to set two words a shopper sees at most once a
 * session. Without the preload it is fetched when the greeting mounts, which is when it exists.
 *
 * Noto Serif Telugu, not a sans: the greeting is warm and ceremonial, the store's own display face
 * has no Telugu at all, and a modulated stroke at 130px carries that register where a UI grotesque
 * would read as a system notification.
 */
const telugu = localFont({
  src: [{ path: '../public/fonts/BuildObjectsTelugu-Variable.woff2', weight: '400 700', style: 'normal' }],
  display: 'swap',
  preload: false,
  variable: '--font-telugu-face',
  fallback: ['serif'],
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
    <html lang="en" className={`${brand.variable} ${ui.variable} ${figure.variable} ${telugu.variable}`} suppressHydrationWarning>
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
      <body>
        {/*
         * First in the body so it is the first thing painted, on every load, before the page
         * behind it has been sent — app/loading.tsx is what lets the document go out that early.
         * The controller comes last so it hydrates after every loading boundary in the tree.
         */}
        <Splash />
        {children}
        <SplashController />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { REVEAL_BOOTSTRAP } from '@/lib/reveal-bootstrap';
import './globals.css';

/**
 * Type — the Build Objects type program. Three faces.
 *
 *   Display 2 (Audiowide)     — the brand name, wherever it appears, and nothing else.
 *   Sans 5    (Encode Sans)   — every figure (tabular-nums, a true ₹, static 300–700 cuts).
 *   Sans 3    (Arimo)         — every piece of body and UI text.
 *
 * Audiowide was briefly removed on the argument that a webfont loaded to set two words is a
 * webfont loaded for a picture, and the wordmark was drawn as vector instead. That was the wrong
 * call: the display face IS the brand's voice, and a hand-cut substitute — however carefully
 * drawn — reads as a wireframe of the name rather than as the name. It is back, it is the only
 * thing that ever sets the brand name, and components/Wordmark.tsx is the one place that does it.
 *
 * Single-word fallbacks ONLY in localFont: next/font writes the list into the CSS variable
 * unquoted, and an unquoted multi-word family is invalid CSS that discards the whole
 * declaration. The ₹-bearing fallbacks live in --font-figure in theme.css, quoted.
 */
const display = localFont({
  src: [{ path: '../public/fonts/BuildObjectsDisplay2-Regular.woff2', weight: '400', style: 'normal' }],
  display: 'swap',
  variable: '--font-display-face',
  fallback: ['system-ui', 'sans-serif'],
});

const ui = localFont({
  src: [
    { path: '../public/fonts/BuildObjectsSans3-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/BuildObjectsSans3-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../public/fonts/BuildObjectsSans3-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: '../public/fonts/BuildObjectsSans3-Bold.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-ui-face',
  fallback: ['Arial', 'Helvetica', 'system-ui', 'sans-serif'],
});

const figure = localFont({
  /* No 300: nothing in the app sets a weight below 400, and a declared source is a preload the
     first paint waits on whether or not a glyph ever asks for it. */
  src: [
    { path: '../public/fonts/BuildObjectsSans5-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/BuildObjectsSans5-Medium.woff2', weight: '500', style: 'normal' },
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
    <html lang="en" className={`${display.variable} ${ui.variable} ${figure.variable}`} suppressHydrationWarning>
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

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * Type — the Build Objects type program. Two faces, down from three.
 *
 *   Sans 5    (Encode Sans)   — every figure (tabular-nums, a true ₹, static 300–700 cuts).
 *   Sans 3    (Arimo)         — every piece of body and UI text.
 *
 * Display 2 (Audiowide) is gone. It was loaded on every page to set two words — the wordmark —
 * and the wordmark is now drawn as vector in components/Wordmark.tsx, where the O of OBJECTS can
 * actually be the brand teal at the mark's own size. A webfont for a logo is a webfont for a
 * picture; this deletes ~19 KB from every first paint and removes a face nothing else could use.
 *
 * Single-word fallbacks ONLY in localFont: next/font writes the list into the CSS variable
 * unquoted, and an unquoted multi-word family is invalid CSS that discards the whole
 * declaration. The ₹-bearing fallbacks live in --font-figure in theme.css, quoted.
 */
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
  src: [
    { path: '../public/fonts/BuildObjectsSans5-Light.woff2', weight: '300', style: 'normal' },
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
    'Construction materials for India — every price per unit with GST shown, every product viewable at true size in your own room, and an estimator that tells you what your house will cost. Delivering today across Andhra Pradesh and Telangana.',
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
    <html lang="en" className={`${ui.variable} ${figure.variable}`}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * Type — the Build Objects type program.
 *
 *   Display 2 (Audiowide)     — the wordmark, and nothing else (.wordmark). NO ₹ glyph: never a price.
 *   Sans 5    (Encode Sans)   — every figure (tabular-nums, a true ₹, static 300–700 cuts).
 *   Sans 3    (Arimo)         — every piece of body and UI text.
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
    'Construction products for Andhra Pradesh and Telangana — GST-stated prices per unit, every product viewable in your own room, and a house cost calculator built for AP and TS.',
  applicationName: 'Build Objects',
};

/** The mobile browser chrome takes the header colour; the page itself is light. */
export const viewport: Viewport = {
  themeColor: '#0b2a30',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // One appearance: light, no theme toggle and no prefers-color-scheme branch.
    <html lang="en" className={`${display.variable} ${ui.variable} ${figure.variable}`}>
      <body>{children}</body>
    </html>
  );
}

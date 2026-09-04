/**
 * The two numbers the splash's stylesheet and its controller have to agree on. Both read them from
 * here: components/Splash.tsx publishes them as custom properties for app/styles/splash.css, and
 * lib/splash.ts waits on them before it lets the overlay go.
 */

/** How long the ignition sequence runs — star, beam out, beam home, stems, bowl, settle. */
export const SPLASH_SEQUENCE_MS = 1560;

/** The fade that takes the overlay off once the page beneath it is ready. */
export const SPLASH_FADE_MS = 280;

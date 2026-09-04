import SplashSensor from '@/components/SplashSensor';

/**
 * The root loading boundary. It wraps everything under the root layout — the signed-in shell in
 * (app) and the front door — so the document can be sent the moment the root layout renders, with
 * the splash already painting, while the shell's own awaits (session, serviceability, categories)
 * are still running. Before this boundary existed the first byte of a hard load waited on all of
 * them and the first paint was the finished page.
 *
 * The fallback itself is nothing: the overlay is drawn by components/Splash.tsx in the root layout,
 * and this only tells it a route is pending. See lib/splash.ts.
 */
export default function Loading() {
  return <SplashSensor />;
}

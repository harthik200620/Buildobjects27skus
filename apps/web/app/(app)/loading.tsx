import SplashSensor from '@/components/SplashSensor';

/**
 * The shell's loading boundary: every page under (app) is pending inside it while its data loads.
 * A client navigation between two pages of the shell keeps the shell mounted, so the root
 * boundary never sees it change — this one does, and it holds the splash until the page arrives.
 * See lib/splash.ts.
 */
export default function Loading() {
  return <SplashSensor />;
}

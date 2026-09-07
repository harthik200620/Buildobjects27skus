'use client';

import React from 'react';
import { splash } from '@/lib/splash';

/**
 * What every loading.tsx renders: a hold on the overlay for as long as it is mounted, and a box
 * the height of a page. React mounts a loading boundary's fallback exactly while the route it
 * wraps is pending, which is the one signal "the page is loading" that is true for hard loads,
 * link clicks and router.push alike — see lib/splash.ts.
 *
 * IT USED TO RENDER NOTHING AT ALL, AND THAT COST THE STORE ITS WORST METRIC.
 *
 * On a cold route the server streams the shell first and the page body after it. With an empty
 * fallback, `<main>` had no height for that interval — so the FOOTER painted directly under the
 * header, at y 177, and was then shoved 500-odd pixels down the moment the real page arrived.
 * Measured under Lighthouse's throttling: a single layout shift of 0.529, which is five times the
 * 0.1 that counts as poor, and it alone held the home and category pages at a performance score
 * of 74 while every other number on them was good (LCP 1.2 s, TBT 59 ms).
 *
 * Nobody SAW it, because the splash is opaque and covering the screen for exactly that interval.
 * It was still real: the browser measured it, Lighthouse scored it, and Search ranks on it.
 *
 * So the fallback reserves the height a page will have. `.page-pending` is the same
 * `min-height` `.page` itself carries, and nothing is drawn in it.
 */
export default function SplashSensor() {
  React.useEffect(() => {
    const s = splash();
    s.hold();
    return () => s.release();
  }, []);
  return <div className="page-pending" aria-hidden="true" />;
}

'use client';

import React from 'react';
import { splash } from '@/lib/splash';

/**
 * What every loading.tsx renders: nothing visible, and a hold on the overlay for as long as it is
 * mounted. React mounts a loading boundary's fallback exactly while the route it wraps is pending,
 * which is the one signal "the page is loading" that is true for hard loads, link clicks and
 * router.push alike — see lib/splash.ts.
 */
export default function SplashSensor() {
  React.useEffect(() => {
    const s = splash();
    s.hold();
    return () => s.release();
  }, []);
  return null;
}

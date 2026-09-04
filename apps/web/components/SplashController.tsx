'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import React from 'react';
import { splash } from '@/lib/splash';

/**
 * Mounted once, in the root layout, after the page. Three jobs, all in lib/splash.ts's words:
 *
 *   · `settle` on hydration. On a hard load the overlay has been on since the first paint with
 *     nobody to tell it the page is there; this is that somebody. It runs after any SplashSensor
 *     in the same commit — children's effects run before their parents' — so a route still
 *     pending at hydration keeps its hold and the overlay stays.
 *   · `depart` on a click on any link to another page of the store. A page the router already
 *     holds in its cache mounts no loading boundary, so without this a second visit to the
 *     estimator would arrive with no sequence at all.
 *   · `arrive` when the URL changes, which is the one signal that whatever the click started has
 *     landed — a Link, a router.push, a redirect.
 *
 * useSearchParams needs a Suspense boundary above it on a statically rendered page (the front
 * door), which is what the wrapper is for.
 */
export default function SplashController() {
  return (
    <React.Suspense fallback={null}>
      <Controller />
    </React.Suspense>
  );
}

function Controller() {
  const pathname = usePathname();
  const search = useSearchParams();
  const url = `${pathname}?${search}`;

  React.useEffect(() => {
    splash().settle();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `url` is a re-run trigger, not a value — the effect fires once per committed navigation and reads nothing from it.
  React.useEffect(() => {
    splash().arrive();
  }, [url]);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      /* The same gestures Link leaves to the browser: new tabs, downloads, other origins, and a
         link back to the page already showing. */
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin) return;
      if (to.pathname + to.search === location.pathname + location.search) return;
      splash().depart();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}

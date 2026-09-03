'use client';

import Link from 'next/link';
import React from 'react';

/**
 * One toast for the whole app. `toast(message)` (or the `useToast()` hook) dispatches a window
 * event; `ToastHost`, mounted once in the app layout, shows it for 2.6 s as a `.toast` (ink on
 * white text) inside a polite live region. No provider, no context — any client component can
 * call it, and the host is the only thing that renders.
 *
 * A toast MAY carry one action, and exactly one. Telling somebody their basket now holds three
 * items and making them go and find it is half a message; "View cart" is the other half. It is a
 * real `<Link>`, so it prefetches and middle-clicks like any other, and the toast holds for its
 * full 2.6 s whether or not the action is taken — an offer, not a demand.
 */
const EVENT = 'bo-toast';

export interface ToastAction {
  label: string;
  href: string;
}
interface ToastDetail {
  message: string;
  action?: ToastAction;
}

export function toast(message: string, action?: ToastAction) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT, { detail: { message, action } }));
}

export const useToast = () => React.useCallback((message: string, action?: ToastAction) => toast(message, action), []);

export default function ToastHost() {
  const [detail, setDetail] = React.useState<ToastDetail | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const on = (e: Event) => {
      setDetail((e as CustomEvent<ToastDetail>).detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDetail(null), 2600);
    };
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener(EVENT, on);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return (
    <div role="status" aria-live="polite">
      {detail && (
        <div className="toast fade-in">
          <span className="toast-msg">{detail.message}</span>
          {detail.action && (
            <Link className="toast-action" href={detail.action.href} onClick={() => setDetail(null)}>
              {detail.action.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

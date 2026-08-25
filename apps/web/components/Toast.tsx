'use client';

import React from 'react';

/**
 * One toast for the whole app. `toast(message)` (or the `useToast()` hook) dispatches a window
 * event; `ToastHost`, mounted once in the app layout, shows it for 2.6 s as a `.toast` (ink on
 * white text) inside a polite live region. No provider, no context — any client component can
 * call it, and the host is the only thing that renders.
 */
const EVENT = 'bo-toast';

export function toast(message: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { message } }));
}

export function useToast() {
  return React.useCallback((message: string) => toast(message), []);
}

export default function ToastHost() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const on = (e: Event) => {
      setMsg((e as CustomEvent<{ message: string }>).detail.message);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 2600);
    };
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener(EVENT, on);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return (
    <div role="status" aria-live="polite">
      {msg && <div className="toast fade-in">{msg}</div>}
    </div>
  );
}

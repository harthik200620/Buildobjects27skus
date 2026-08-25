'use client';

import Link from 'next/link';
import React from 'react';
import { IconEstimate } from '@/components/icons';
import { readPicks } from '@/lib/picks';

/** The estimate action with the brand-coloured count pill — read from this device's picks after mount, kept live by `bo-picks` and cross-tab `storage`. */
export default function EstimateButton() {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    const read = () => setCount(readPicks().reduce((n, p) => n + p.qty, 0));
    read();
    window.addEventListener('bo-picks', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('bo-picks', read);
      window.removeEventListener('storage', read);
    };
  }, []);
  return (
    <Link
      href="/estimate"
      className="header-action header-action--estimate"
      aria-label={count > 0 ? `BO Estimator, ${count} ${count === 1 ? 'item' : 'items'}` : 'BO Estimator'}
    >
      <span className="header-action-icon">
        <IconEstimate size={22} />
      </span>
      <span className="header-action-label">BO Estimator</span>
    </Link>
  );
}

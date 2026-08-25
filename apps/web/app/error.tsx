'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="page shell">
      <div className="empty" style={{ minHeight: '60dvh' }}>
        <p className="caption">Something went wrong</p>
        <h1 className="h2">That page did not load</h1>
        <p>{error.digest ? `Reference ${error.digest}. ` : ''}Try again, or head back to the catalogue.</p>
        <div className="empty-actions">
          <button type="button" onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <Link href="/" className="btn btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page shell">
      <div className="empty" style={{ minHeight: '60dvh' }}>
        <p className="caption">404</p>
        <h1 className="h2">Nothing is built here yet</h1>
        <p>That address is not part of the store. The catalogue and the estimator are one tap away.</p>
        <div className="empty-actions">
          <Link href="/" className="btn btn-primary">
            Home
          </Link>
          <Link href="/search" className="btn btn-secondary">
            All products
          </Link>
          <Link href="/estimate" className="btn btn-secondary">
            BO Estimator
          </Link>
        </div>
      </div>
    </div>
  );
}

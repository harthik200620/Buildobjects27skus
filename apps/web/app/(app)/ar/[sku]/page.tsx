import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ArStage from '@/components/ar/ArStage';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadArProduct } from '@/lib/ar-data';

type Params = { sku: string };
type Search = { as?: string };
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { sku } = await params;
  const p = await loadArProduct(sku);
  return { title: p ? `${p.name} in your room` : 'View in your room' };
}

/**
 * /ar/[sku] — the hero surface. One engine, three tiers by device: Live AR (WebXR), AR Quick
 * Look (iOS), Photo Mode (everything else, incl. desktop). `?as=bathtub` loads the spec's
 * gate-demo product so the refusal path can be shown on any SKU page.
 */
export default async function ArPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { sku } = await params;
  const { as } = await searchParams;
  const product = await loadArProduct(sku, as ?? null);
  if (!product) notFound();

  return (
    <div className="page shell">
      <Breadcrumbs
        trail={[
          { label: 'Home', href: '/' },
          ...(product.pdpHref ? [{ label: `${product.brand} ${product.name}`, href: product.pdpHref }] : [{ label: product.name }]),
          { label: 'In your room' },
        ]}
      />
      <header className="page-head" style={{ paddingBottom: 'var(--s-4)' }}>
        <p className="kicker">View in your room</p>
        <h1 className="display page-title">{product.demo ? 'Gate demo — a bathtub' : product.categoryName}</h1>
        <p className="page-sub max-w-[64ch]">
          <span className="fig" style={{ color: 'var(--ink-2)' }}>
            {product.brand} {product.name}
          </span>{' '}
          at its true size, placed where it belongs — {product.rule.surfaceLabel}.
          {product.demo
            ? ' Point this at a living room and the engine refuses; point it at a bathroom floor and it places.'
            : ' The engine refuses surfaces the product does not belong on, then integrates light and shadow on request.'}
        </p>
      </header>
      <ArStage product={product} />
      {!product.demo && (
        <p className="note mt-6 no-print">
          Want to see the gate refuse?{' '}
          <Link href={`/ar/${product.code.toLowerCase()}?as=bathtub`} className="underline decoration-dotted underline-offset-2">
            Try placing a bathtub
          </Link>{' '}
          in the same photo.
        </p>
      )}
    </div>
  );
}

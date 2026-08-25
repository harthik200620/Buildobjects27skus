import { categoryName, categoryOf } from '@buildobjects/catalog';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import BrandStrip from '@/components/BrandStrip';
import Breadcrumbs from '@/components/Breadcrumbs';
import BrochureViewer from '@/components/BrochureViewer';
import BuyPanel from '@/components/BuyPanel';
import Gallery from '@/components/Gallery';
import Markdown from '@/components/Markdown';
import ProductCard from '@/components/ProductCard';
import SpecSheet from '@/components/SpecSheet';
import { loadSkuPage, similarSkus } from '@/lib/catalog';
import { loadSession } from '@/lib/data';

type Params = { sku: string };
export const revalidate = 300;
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { sku } = await params;
  const data = await loadSkuPage(sku);
  if (!data) return { title: 'Product' };
  const seo = data.sku.seo as { title?: string; meta_description?: string } | null;
  return {
    title: seo?.title ?? `${data.brand.name} ${data.product.name}`,
    description:
      seo?.meta_description ||
      data.sku.short ||
      `${data.brand.name} ${data.product.name} — price per ${data.sku.unit} incl. GST, specifications, datasheet and AR view.`,
  };
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { sku } = await params;
  const data = await loadSkuPage(sku);
  if (!data) notFound();
  const [session, similar] = await Promise.all([loadSession(), similarSkus(data.category.slug, data.brand.slug)]);
  const spec = data.sku.specJson;
  const coverage = data.sku.coverage as { images?: number; placeholders?: number } | null;

  return (
    <div className="page shell">
      {/* Home / Concreting / Cement / UltraTech — the whole tree, not the last two rungs of it.
          The trail used to jump from Home straight to the product's own row, so a reader who
          arrived from a search had no way back up to the category the item sits in. */}
      <Breadcrumbs
        trail={[
          { label: 'Home', href: '/' },
          { label: categoryName(categoryOf(data.category.slug)), href: `/c/${categoryOf(data.category.slug)}` },
          ...(categoryOf(data.category.slug) !== data.category.slug ? [{ label: data.category.name, href: `/c/${data.category.slug}` }] : []),
          { label: data.brand.name },
        ]}
      />

      <div className="pdp mt-4">
        <div>
          <Gallery images={data.images} name={`${data.brand.name} ${data.product.name}`} skuCode={data.sku.code} dims={data.dims} />

          {/* ── key details ────────────────────────────────────────────── */}
          <section className="sec" aria-labelledby="key-h" data-reveal>
            <div className="sec-head">
              <h2 id="key-h" className="sec-title">
                Key details
              </h2>
            </div>
            {data.sku.keySpecs.length ? (
              <table className="spec-table mt-2">
                <tbody>
                  {data.sku.keySpecs.map((k) => (
                    <tr key={k.key}>
                      <th scope="row">{k.label}</th>
                      <td className="fig">{k.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="note mt-2">Key details appear once the product has been ingested.</p>
            )}
          </section>

          {/* ── description ────────────────────────────────────────────── */}
          <section className="sec" aria-labelledby="desc-h" data-reveal>
            <div className="sec-head">
              <h2 id="desc-h" className="sec-title">
                Description
              </h2>
            </div>
            <div className="mt-2">{data.sku.long ? <Markdown text={data.sku.long} /> : <p className="prose">{data.sku.short}</p>}</div>
          </section>

          {/* ── brochure ───────────────────────────────────────────────── */}
          <section className="sec" aria-labelledby="doc-h" data-reveal>
            <div className="sec-head">
              <h2 id="doc-h" className="sec-title">
                Brochure & datasheet
              </h2>
            </div>
            <div className="mt-2">
              <BrochureViewer documents={data.documents} skuCode={data.sku.code} />
            </div>
          </section>

          {/* ── show more: the full sheet ──────────────────────────────── */}
          <section className="sec" aria-labelledby="sheet-h" data-reveal>
            <div className="sec-head">
              <h2 id="sheet-h" className="sec-title">
                Every figure we hold
              </h2>
            </div>
            <div className="mt-2">
              {spec?.groups.length ? <SpecSheet spec={spec} /> : <p className="note">The full sheet appears once the product has been ingested.</p>}
            </div>
          </section>

          {/* ── brand ──────────────────────────────────────────────────── */}
          <section className="sec" aria-labelledby="brand-h" data-reveal>
            <div className="sec-head">
              <h2 id="brand-h" className="sec-title">
                About {data.brand.name}
              </h2>
            </div>
            <div className="mt-2">
              <BrandStrip brand={data.brand} />
            </div>
          </section>
        </div>

        <aside className="pdp-sticky">
          <BuyPanel data={data} pincode={session?.pincode ?? '500001'} />
          {coverage && (coverage.placeholders ?? 0) > 0 && (
            <p className="note mt-3 px-1">
              {(coverage.images ?? 0) - (coverage.placeholders ?? 0)} of {coverage.images ?? 0} views are photographs from {data.brand.name}. The rest are
              marked placeholders — this product has no more images on the manufacturer&rsquo;s own page, and we do not fill the gap with someone else&rsquo;s.
            </p>
          )}
        </aside>
      </div>

      {/* ── similar products ───────────────────────────────────────────── */}
      {similar.length > 0 && (
        <section className="sec" aria-labelledby="sim-h">
          <div className="sec-head">
            <h2 id="sim-h" className="sec-title">
              Compare with other {data.category.name.toLowerCase()} brands
            </h2>
            <Link href={`/c/${data.category.slug}`} className="sec-more">
              All {data.category.name.toLowerCase()}
            </Link>
          </div>
          <div className="prod-grid mt-3">
            {similar.slice(0, 4).map((s) => (
              <ProductCard key={s.id} sku={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

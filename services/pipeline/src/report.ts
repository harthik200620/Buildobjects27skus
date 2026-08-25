import fs from 'node:fs';
import path from 'node:path';
import { brands, categories, getDb, products, skus } from '@buildobjects/db';
import { asc, eq, notLike } from 'drizzle-orm';
import { REPO_ROOT } from './config';

export interface CoverageRow {
  sku: string;
  brand: string;
  category: string;
  filled: number;
  total: number;
  pct: number;
  fetched: number;
  verified: number;
  ai_filled: number;
  images: number;
  placeholders: number;
  brochures: number;
  price: string;
  ar: boolean;
}

export async function coverageRows(): Promise<CoverageRow[]> {
  const db = getDb();
  const rows = await db
    .select({ sku: skus, brand: brands.name, category: categories.slug })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(brands, eq(products.brandId, brands.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(notLike(skus.skuCode, 'SYN-%'))
    .orderBy(asc(categories.displayOrder), asc(skus.skuCode)); // synthetic scale rows are never part of the coverage report
  return rows.map((r) => {
    const c = r.sku.coverage ?? { filled: 0, total: 0, by_provenance: {}, images: 0, placeholders: 0, brochures: 0 };
    const prov = (c.by_provenance ?? {}) as Record<string, number>;
    return {
      sku: r.sku.skuCode,
      brand: r.brand,
      category: r.category,
      filled: c.filled,
      total: c.total,
      pct: c.total ? Math.round((c.filled / c.total) * 100) : 0,
      fetched: prov.fetched ?? 0,
      verified: prov.verified ?? 0,
      ai_filled: prov.ai_filled ?? 0,
      images: c.images,
      placeholders: c.placeholders,
      brochures: c.brochures,
      price: `${r.sku.priceProvenance}${r.sku.sellingPrice ? ` ₹${Number(r.sku.sellingPrice)}` : ''}`,
      ar: false,
    };
  });
}

export function printCoverage(rows: CoverageRow[], notes: Record<string, string[]> = {}): string {
  const w = (s: string | number, n: number) => String(s).padEnd(n);
  const lines: string[] = [];
  lines.push(
    `${w('SKU', 18) + w('category', 19) + w('attrs', 10) + w('%', 5) + w('fetched', 8) + w('verif', 6) + w('ai', 5) + w('images', 8) + w('broch', 6)}price`,
  );
  for (const r of rows)
    lines.push(
      w(r.sku, 18) +
        w(r.category, 19) +
        w(`${r.filled}/${r.total}`, 10) +
        w(r.pct, 5) +
        w(r.fetched, 8) +
        w(r.verified, 6) +
        w(r.ai_filled, 5) +
        w(`${r.images - r.placeholders}/5${r.placeholders ? `+${r.placeholders}ph` : ''}`, 8) +
        w(r.brochures ? 'yes' : 'no', 6) +
        r.price,
    );
  const tot = rows.reduce(
    (a, r) => ({
      filled: a.filled + r.filled,
      total: a.total + r.total,
      f: a.f + r.fetched,
      v: a.v + r.verified,
      ai: a.ai + r.ai_filled,
      img: a.img + r.images - r.placeholders,
      ph: a.ph + r.placeholders,
      br: a.br + (r.brochures ? 1 : 0),
    }),
    { filled: 0, total: 0, f: 0, v: 0, ai: 0, img: 0, ph: 0, br: 0 },
  );
  lines.push('');
  lines.push(
    `${rows.length} SKUs · attributes ${tot.filled}/${tot.total} (${tot.total ? Math.round((tot.filled / tot.total) * 100) : 0}%) · fetched ${tot.f} · verified ${tot.v} · ai_filled ${tot.ai} · real images ${tot.img}, placeholders ${tot.ph} · brochures ${tot.br}/${rows.length}`,
  );
  for (const [sku, ns] of Object.entries(notes))
    if (ns.length) {
      lines.push(`  ${sku}:`);
      for (const n of ns) lines.push(`    - ${n}`);
    }
  return lines.join('\n');
}

export function writeReport(runId: number, rows: CoverageRow[], notes: Record<string, string[]>, meta: Record<string, unknown>) {
  const dir = path.join(REPO_ROOT, 'storage', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `coverage-${runId}.json`);
  fs.writeFileSync(file, JSON.stringify({ run_id: runId, generated_at: new Date().toISOString(), ...meta, rows, notes }, null, 2));
  fs.writeFileSync(
    path.join(dir, 'coverage-latest.json'),
    JSON.stringify({ run_id: runId, generated_at: new Date().toISOString(), ...meta, rows, notes }, null, 2),
  );
  return file;
}

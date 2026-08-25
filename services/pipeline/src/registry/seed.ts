/**
 * Seeds categories, brands, attribute groups and attributes from the specification workbook.
 *
 * Idempotent, and authoritative in both directions: rows the workbook declares are upserted,
 * and rows it no longer declares are removed along with their values. That second half
 * matters because the workbook is the only place a specification is defined — without it a
 * deleted row would linger in the attributes table forever, and it is how 906 attribute rows
 * accumulated for 509 live specifications.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CategorySeedSchema, DEPARTMENTS, defaultWidget, type Registry, RegistrySchema } from '@buildobjects/catalog';
import { attributeGroups, attributes, brands, categories, getDb, gstRates, skuAttributeValues } from '@buildobjects/db';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { REGISTRY_DIR } from '../config';
import { readCalendar, writeRegistries } from './from-sheet';

export function loadCategorySeeds() {
  const raw = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, 'categories.json'), 'utf8'));
  return (raw.categories as unknown[]).map((c) => CategorySeedSchema.parse(c));
}
export function loadRegistry(slug: string): Registry | null {
  const file = path.join(REGISTRY_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  return RegistrySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export interface TaxonomyDept {
  key: string;
  name: string;
  display_order: number;
}
export interface TaxonomyCategory {
  slug: string;
  department: string;
  status: 'live' | 'upcoming';
  name?: string;
  icon?: string;
}
export function loadTaxonomy(): { departments: TaxonomyDept[]; categories: TaxonomyCategory[] } {
  const raw = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, 'taxonomy.json'), 'utf8'));
  // DEPARTMENTS in @buildobjects/catalog is what the storefront renders from; a category
  // pointing anywhere else would seed a row the nav could never place.
  const known = new Set<string>(DEPARTMENTS.map((d) => d.key));
  const stray = (raw.categories as TaxonomyCategory[]).filter((c) => !known.has(c.department));
  if (stray.length) throw new Error(`taxonomy.json: unknown department on ${stray.map((c) => `${c.slug} → ${c.department}`).join(', ')}`);
  return { departments: raw.departments, categories: raw.categories };
}

export async function seedRegistry(log: (s: string) => void = console.log): Promise<void> {
  const db = getDb();
  // The workbook is the source: rewrite the nine registries from it before seeding anything.
  for (const line of writeRegistries()) log(`  sheet → ${line}`);
  const sheet = readCalendar();
  const cats = loadCategorySeeds();
  const taxonomy = loadTaxonomy();
  const placement = new Map(taxonomy.categories.map((t) => [t.slug, t]));
  const gst = Object.fromEntries((await db.select().from(gstRates)).map((g) => [g.categorySlug, Number(g.rate)]));

  for (const c of cats) {
    await db
      .insert(categories)
      .values({
        slug: c.slug,
        code: c.code,
        name: c.name,
        nameTe: c.name_te,
        nameHi: c.name_hi,
        icon: c.icon,
        displayOrder: c.display_order,
        unit: c.unit,
        department: placement.get(c.slug)?.department ?? 'construction-materials',
        status: 'live',
        heroImageKey: `categories/${c.slug}/hero-card.webp`,
      })
      .onDuplicateKeyUpdate({
        set: {
          code: c.code,
          name: c.name,
          nameTe: c.name_te,
          nameHi: c.name_hi,
          icon: c.icon,
          displayOrder: c.display_order,
          unit: c.unit,
          department: placement.get(c.slug)?.department ?? 'construction-materials',
          status: 'live',
        },
      });
    const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, c.slug));
    for (const b of c.brands) {
      await db
        .insert(brands)
        .values({ slug: b.slug, code: b.code, name: b.name, officialDomains: [b.domain] })
        .onDuplicateKeyUpdate({ set: { code: b.code, name: b.name } });
    }
    const reg = loadRegistry(c.slug);
    if (!reg) {
      log(`  ${c.slug}: no registry file yet (registry/${c.slug}.json) — category seeded without attributes`);
      continue;
    }
    // Only the headings this category actually has properties for, in its own order.
    const groups = sheet.get(c.slug)?.groups ?? [];
    const groupIds = new Map<string, number>();
    for (const g of groups) {
      await db
        .insert(attributeGroups)
        .values({ categoryId: cat.id, key: g.key, label: g.label, displayOrder: g.display_order, importance: g.importance })
        .onDuplicateKeyUpdate({ set: { label: g.label, displayOrder: g.display_order, importance: g.importance } });
      const [row] = await db
        .select({ id: attributeGroups.id })
        .from(attributeGroups)
        .where(and(eq(attributeGroups.categoryId, cat.id), eq(attributeGroups.key, g.key)));
      groupIds.set(g.key, row.id);
    }
    let n = 0;
    for (const a of reg.attributes) {
      const groupId = groupIds.get(a.group);
      if (!groupId) continue;
      const widget = a.is_filterable ? (a.filter_widget ?? defaultWidget(a.data_type)) : null;
      const values = {
        groupId,
        categoryId: cat.id,
        key: a.key,
        label: a.label,
        dataType: a.data_type,
        unit: a.unit ?? null,
        enumValues: a.enum_values ?? null,
        isFilterable: a.is_filterable,
        filterWidget: widget,
        filterOrder: a.filter_order ?? 100,
        importanceRank: a.importance_rank,
        showInKeySpecs: a.show_in_key_specs,
        showOnCard: a.show_on_card,
        compare: a.compare,
        synonyms: a.synonyms,
        displayOrder: a.display_order,
      };
      await db
        .insert(attributes)
        .values(values)
        .onDuplicateKeyUpdate({ set: { ...values } });
      n++;
    }
    const pruned = await pruneCategory(
      cat.id,
      reg,
      groups.map((g) => g.key),
    );
    const tail = pruned.attributes || pruned.groups ? ` · pruned ${pruned.attributes} attributes, ${pruned.groups} groups` : '';
    log(`  ${c.slug}: ${n} attributes across ${groups.length} groups · GST ${gst[c.slug] ?? c.gst_rate}% · ${c.brands.length} brands${tail}`);
  }

  await seedUpcoming(taxonomy, new Set(cats.map((c) => c.slug)), log);
}

/**
 * The twenty-eight categories the catalogue does not sell yet still get a row. They carry no
 * brands, no attributes and no products; what they carry is a place in the nav and an honest
 * zero, which is the difference between a shop that is growing and a shop that looks empty.
 */
async function seedUpcoming(taxonomy: ReturnType<typeof loadTaxonomy>, live: Set<string>, log: (s: string) => void): Promise<void> {
  const db = getDb();
  const order = new Map(taxonomy.departments.map((d) => [d.key, d.display_order]));
  let n = 0;
  for (const [i, t] of taxonomy.categories.filter((c) => !live.has(c.slug)).entries()) {
    const values = {
      slug: t.slug,
      // Upcoming categories never appear in a SKU code, so a deterministic stand-in is enough.
      code: t.slug
        .replace(/[^a-z]/g, '')
        .slice(0, 3)
        .toUpperCase()
        .padEnd(3, 'X'),
      name: t.name ?? t.slug,
      icon: t.icon ?? null,
      department: t.department,
      status: 'upcoming' as const,
      // After the nine live categories, ordered by department then by their order in the file.
      displayOrder: 100 + (order.get(t.department) ?? 99) * 100 + i,
      unit: null,
      // `pnpm pipeline art:categories` draws the tile; without the key the grid falls back
      // to a bare icon and thirty-seven tiles stop looking like one set.
      heroImageKey: `categories/${t.slug}/hero-card.webp`,
    };
    await db.insert(categories).values(values).onDuplicateKeyUpdate({ set: values });
    n++;
  }
  log(`  taxonomy: ${live.size} live + ${n} upcoming = ${live.size + n} categories in ${taxonomy.departments.length} departments`);
}

/** Drop attributes and groups this category no longer declares, and any values hanging off them. */
async function pruneCategory(categoryId: number, reg: Registry, groupKeys: string[]): Promise<{ attributes: number; groups: number }> {
  const db = getDb();
  const keep = reg.attributes.map((a) => a.key);
  const stale = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.categoryId, categoryId), notInArray(attributes.key, keep)));
  if (stale.length) {
    const ids = stale.map((r) => r.id);
    await db.delete(skuAttributeValues).where(inArray(skuAttributeValues.attributeId, ids));
    await db.delete(attributes).where(inArray(attributes.id, ids));
  }
  const staleGroups = await db
    .select({ id: attributeGroups.id })
    .from(attributeGroups)
    .where(and(eq(attributeGroups.categoryId, categoryId), notInArray(attributeGroups.key, groupKeys)));
  if (staleGroups.length)
    await db.delete(attributeGroups).where(
      inArray(
        attributeGroups.id,
        staleGroups.map((r) => r.id),
      ),
    );
  return { attributes: stale.length, groups: staleGroups.length };
}

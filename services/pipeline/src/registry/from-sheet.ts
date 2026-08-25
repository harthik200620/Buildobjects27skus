/**
 * Reads WHOLE_PRODUCT_LIST_BO_PRODUCT_CALENDAR.xlsx — the master specification workbook.
 *
 * One sheet per category, one row per specification, and the value each of the three
 * brands carries for it beside the definition. The workbook is what a person edits when a
 * specification changes; this is the only thing that reads it. Everything downstream —
 * the nine registries, the attribute rows, the EAV values, the PDP spec sheet — is derived.
 *
 *   row 1        title banner (ignored)
 *   row 2        header
 *   row 3..n     Group | Specification | Key | Type | Unit | Filter | Key spec | Card |
 *                Compare | Rank | (SKU code | Source) x brands | Notes
 *
 * Group is a label; registry/spec-groups.json maps it back to a key and fixes the order.
 * Facet widgets, enum values and search synonyms are not product specifications and are not
 * in the workbook; registry/attribute-overlay.json carries them and is merged in here.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  type AttributeDef,
  type AttributeValue,
  type DataType,
  defaultWidget,
  type FilterWidget,
  GROUP_KEYS,
  type GroupDef,
  type GroupKey,
  type Provenance,
  type Registry,
  RegistrySchema,
} from '@buildobjects/catalog';
import * as XLSXNS from 'xlsx';
import { REGISTRY_DIR, SHEET_PATH } from '../config';

/* xlsx ships a CJS build; under ESM the namespace may wrap it in `default`. */
const XLSX = ((XLSXNS as unknown as { read?: unknown }).read ? XLSXNS : (XLSXNS as unknown as { default: typeof XLSXNS }).default) as typeof XLSXNS;

/** Fixed left-hand columns, before the per-SKU value pairs. */
const COL = { group: 0, label: 1, key: 2, type: 3, unit: 4, filter: 5, keySpec: 6, card: 7, compare: 8, rank: 9 } as const;
const FIRST_SKU_COL = 10;
const HEADER_ROW = 1; // zero-based
const FIRST_DATA_ROW = 2;

export interface SheetSku {
  /** Column heading of the value column: the SKU code. */
  code: string;
  values: Record<string, AttributeValue>;
}
export interface SheetCategory {
  slug: string;
  sheet: string;
  groups: GroupDef[];
  registry: Registry;
  skus: SheetSku[];
}

interface Overlay {
  filter_widget?: FilterWidget;
  filter_order?: number;
  enum_values?: string[];
  synonyms?: string[];
}

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, file), 'utf8')) as T;
const text = (v: unknown): string => String(v ?? '').trim();
const yes = (v: unknown): boolean => /^(yes|true|1|y)$/i.test(text(v));

/**
 * Coerce a cell to the value the attribute's declared type wants. xlsx hands back numbers
 * and booleans as themselves and everything else as a string, so this only has to fix the
 * cases where a human typed "9 W" into a number column or "Yes" into a boolean one.
 */
function coerce(raw: unknown, type: DataType): string | number | boolean | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (type === 'number') {
    if (typeof raw === 'number') return raw;
    const m = /-?\d+(?:\.\d+)?/.exec(String(raw).replace(/,/g, ''));
    return m ? Number(m[0]) : String(raw).trim(); // keep "220-240 V AC" readable rather than lying with 220
  }
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    return /^(yes|true|1|y)$/i.test(String(raw).trim());
  }
  return String(raw).trim();
}

const PROVENANCES = new Set<Provenance>(['fetched', 'verified', 'ai_filled', 'derived']);
function provenance(raw: unknown): Provenance {
  const v = text(raw).toLowerCase() as Provenance;
  return PROVENANCES.has(v) ? v : 'ai_filled';
}

/**
 * Every category's sheet, keyed by category slug. Parsed once per process — a pipeline run
 * asks for values 27 times and the workbook does not change underneath it.
 */
export const readCalendar = memoiseByFile(readCalendarUncached);

function memoiseByFile<T>(fn: (file: string) => T): (file?: string) => T {
  const cache = new Map<string, T>();
  return (file = SHEET_PATH) => {
    const hit = cache.get(file);
    if (hit) return hit;
    const built = fn(file);
    cache.set(file, built);
    return built;
  };
}

function readCalendarUncached(file: string): Map<string, SheetCategory> {
  if (!fs.existsSync(file)) throw new Error(`specification workbook not found: ${file}`);
  const specGroups = readJson<{ labels: Record<string, string>; categories: Record<string, Record<string, string[]>> }>('spec-groups.json');
  const overlays = readJson<{ categories: Record<string, Record<string, Overlay>> }>('attribute-overlay.json').categories;
  const cats = readJson<{ categories: { slug: string; name: string }[] }>('categories.json').categories;

  const groupKeyByLabel = new Map(Object.entries(specGroups.labels).map(([key, label]) => [label, key as GroupKey]));
  const slugBySheet = new Map(cats.map((c) => [c.name, c.slug]));

  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  const out = new Map<string, SheetCategory>();

  for (const sheet of wb.SheetNames) {
    const slug = slugBySheet.get(sheet);
    if (!slug) throw new Error(`sheet "${sheet}" does not name a category in registry/categories.json`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
    const header = rows[HEADER_ROW] ?? [];

    // Value columns are the (code, "Source") pairs between the fixed columns and "Notes".
    const skus: SheetSku[] = [];
    const valueCols: number[] = [];
    for (let c = FIRST_SKU_COL; c < header.length; c += 2) {
      const code = text(header[c]);
      if (!code || code === 'Notes') break;
      skus.push({ code, values: {} });
      valueCols.push(c);
    }
    if (!skus.length) throw new Error(`sheet "${sheet}" declares no SKU value columns`);

    const order = specGroups.categories[slug];
    if (!order) throw new Error(`registry/spec-groups.json has no entry for category "${slug}"`);
    const groupOrder = new Map(Object.keys(order).map((k, i) => [k, i]));

    const attrs: AttributeDef[] = [];
    const overlay = overlays[slug] ?? {};
    let currentGroup: GroupKey | null = null;

    for (let r = FIRST_DATA_ROW; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const key = text(row[COL.key]);
      if (!key) continue;

      // The group cell is written once per run of rows, the way a person reads it.
      const label = text(row[COL.group]);
      if (label) {
        const g = groupKeyByLabel.get(label);
        if (!g) throw new Error(`sheet "${sheet}" row ${r + 1}: unknown group heading "${label}"`);
        currentGroup = g;
      }
      if (!currentGroup) throw new Error(`sheet "${sheet}" row ${r + 1}: a value appears before any group heading`);

      const type = text(row[COL.type]) as DataType;
      const o = overlay[key] ?? {};
      const filterable = yes(row[COL.filter]);
      attrs.push({
        key,
        group: currentGroup,
        label: text(row[COL.label]),
        data_type: type,
        unit: text(row[COL.unit]) || null,
        enum_values: o.enum_values,
        is_filterable: filterable,
        filter_widget: filterable ? (o.filter_widget ?? defaultWidget(type)) : undefined,
        filter_order: o.filter_order ?? 100,
        importance_rank: Number(row[COL.rank]) || 3,
        show_in_key_specs: yes(row[COL.keySpec]),
        show_on_card: yes(row[COL.card]),
        compare: yes(row[COL.compare]),
        synonyms: o.synonyms ?? [],
        display_order: attrs.length,
      });

      const note = text(row[header.length - 1]) || undefined;
      skus.forEach((sku, i) => {
        const value = coerce(row[valueCols[i]], type);
        if (value === null) return;
        sku.values[key] = { value, provenance: provenance(row[valueCols[i] + 1]), source_url: null, note };
      });
    }

    const groups: GroupDef[] = [...groupOrder.entries()]
      .filter(([key]) => attrs.some((a) => a.group === key))
      .map(([key, i]) => ({
        key: key as GroupKey,
        label: specGroups.labels[key],
        display_order: i + 1,
        importance: Math.min(5, i + 1),
      }));

    out.set(slug, { slug, sheet, groups, registry: RegistrySchema.parse({ category: slug, version: 2, attributes: attrs }), skus });
  }

  const missing = cats.filter((c) => !out.has(c.slug)).map((c) => c.name);
  if (missing.length) throw new Error(`the workbook has no sheet for: ${missing.join(', ')}`);
  return out;
}

/** Writes registry/{slug}.json for every category. Returns one report line per category. */
export function writeRegistries(): string[] {
  const report: string[] = [];
  for (const [slug, cat] of readCalendar()) {
    fs.writeFileSync(path.join(REGISTRY_DIR, `${slug}.json`), `${JSON.stringify(cat.registry, null, 2)}\n`);
    const a = cat.registry.attributes;
    const values = cat.skus.reduce((n, s) => n + Object.keys(s.values).length, 0);
    report.push(
      `${slug}: ${a.length} attributes in ${cat.groups.length} groups · ` +
        `${a.filter((x) => x.show_in_key_specs).length} key specs · ${a.filter((x) => x.is_filterable).length} filterable · ` +
        `${values} values across ${cat.skus.length} SKUs`,
    );
  }
  return report;
}

/** Spec values for one SKU as the pipeline's extract stage wants them, or null if the workbook has no column for it. */
export function sheetValues(skuCode: string): Record<string, AttributeValue> | null {
  for (const cat of readCalendar().values()) {
    const hit = cat.skus.find((s) => s.code === skuCode);
    if (hit) return hit.values;
  }
  return null;
}

/** Sanity check used by `pnpm pipeline sheet`: what the workbook contains, category by category. */
export function sheetReport(): string[] {
  const out: string[] = [];
  for (const [slug, cat] of readCalendar()) {
    const groups = cat.groups.map((g) => `${g.label} (${cat.registry.attributes.filter((a) => a.group === g.key).length})`);
    out.push(`${slug} — sheet "${cat.sheet}", ${cat.skus.length} SKUs: ${cat.skus.map((s) => s.code).join(', ')}`);
    out.push(`   ${groups.join(' · ')}`);
  }
  const sheets = readCalendar();
  const used = new Set([...sheets.values()].flatMap((c) => c.groups.map((g) => g.key)));
  out.push(`\n${used.size} of ${GROUP_KEYS.length} group headings in use across ${sheets.size} categories.`);
  return out;
}

import fs from 'node:fs';
import path from 'node:path';
import { type AttributeValue, type CuratedSku, CuratedSkuSchema } from '@buildobjects/catalog';
import { CURATED_DIR } from '../config';
import { sheetValues } from '../registry/from-sheet';
import type { Copy, DescribeInput, ExtractInput, FillInput, LlmProvider, VerifyInput } from './types';

const cache = new Map<string, CuratedSku | null>();

export function listCurated(category?: string): CuratedSku[] {
  const out: CuratedSku[] = [];
  if (!fs.existsSync(CURATED_DIR)) return out;
  for (const dir of fs.readdirSync(CURATED_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (category && dir.name !== category) continue;
    for (const f of fs.readdirSync(path.join(CURATED_DIR, dir.name))) {
      if (!f.endsWith('.json')) continue;
      const sku = loadCuratedFile(path.join(CURATED_DIR, dir.name, f));
      if (sku) out.push(sku);
    }
  }
  return out.sort((a, b) => a.sku_code.localeCompare(b.sku_code));
}

export function loadCuratedFile(file: string): CuratedSku | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const parsed = CuratedSkuSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(
        `  ! curated file rejected: ${path.basename(file)} — ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
      return null;
    }
    return parsed.data;
  } catch (e) {
    console.warn(`  ! curated file unreadable: ${file}: ${(e as Error).message}`);
    return null;
  }
}

export function findCurated(skuCode: string): CuratedSku | null {
  if (cache.has(skuCode)) return cache.get(skuCode)!;
  const hit = listCurated().find((s) => s.sku_code === skuCode) ?? null;
  cache.set(skuCode, hit);
  return hit;
}

/** The fixture provider: values come from the curated file with their own provenance, untouched. */
export class CuratedProvider implements LlmProvider {
  readonly name = 'curated' as const;
  curated(skuCode: string) {
    return findCurated(skuCode);
  }
  /**
   * Specifications come from the workbook — it is the document a person edits and the one
   * the registry was built from, so the two cannot disagree. The curated JSON is the
   * fallback for a SKU the workbook has no column for, and remains the source for price,
   * images, documents and copy.
   */
  async extract(input: ExtractInput): Promise<Record<string, AttributeValue>> {
    const known = new Set(input.registry.attributes.map((a) => a.key));
    const source = sheetValues(input.skuCode) ?? findCurated(input.skuCode)?.attributes;
    if (!source) throw new Error(`no workbook column and no curated fixture for ${input.skuCode}, and no ANTHROPIC_API_KEY for live extraction`);
    const out: Record<string, AttributeValue> = {};
    for (const [k, v] of Object.entries(source)) if (known.has(k) && v.value !== null && v.value !== '') out[k] = v;
    return out;
  }
  async verify(input: VerifyInput) {
    return { values: input.values, conflicts: [] };
  }
  async fill(input: FillInput) {
    return input.values;
  }
  async describe(input: DescribeInput): Promise<Copy> {
    const c = findCurated(input.skuCode);
    if (!c) throw new Error(`no curated fixture for ${input.skuCode}`);
    return { short_description: c.short_description, long_description: c.long_description, key_specs: c.key_specs, seo: c.seo };
  }
}

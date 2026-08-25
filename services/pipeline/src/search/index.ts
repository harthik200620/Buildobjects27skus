/**
 * Meilisearch index `skus`: settings, synonyms from the DB, documents in batches.
 * Typo tolerance opens at 4 characters so `bulp` → bulb and `cemet` → cement both resolve.
 */

import { SEARCH_INDEX, type SkuSearchDoc } from '@buildobjects/catalog';
import { getDb, searchSynonyms } from '@buildobjects/db';
import { MeiliSearch } from 'meilisearch';
import { env } from '../config';

let client: MeiliSearch | null = null;
export function meili(): MeiliSearch {
  if (!client) client = new MeiliSearch({ host: env.meiliHost, apiKey: env.meiliKey });
  return client;
}

export async function ensureIndex(filterable: string[]) {
  const m = meili();
  const task = await m.createIndex(SEARCH_INDEX, { primaryKey: 'id' }).catch(() => null);
  if (task) await m.tasks.waitForTask(task.taskUid);
  const index = m.index(SEARCH_INDEX);
  const rows = await getDb().select().from(searchSynonyms);
  const synonyms: Record<string, string[]> = {};
  for (const r of rows) {
    const group = [r.term, ...r.synonyms].map((s) => s.toLowerCase().trim()).filter(Boolean);
    for (const t of group) synonyms[t] = Array.from(new Set([...(synonyms[t] ?? []), ...group.filter((x) => x !== t)]));
  }
  const t = await index.updateSettings({
    searchableAttributes: [
      'name',
      'brand',
      'category_name',
      'category_name_te',
      'category_name_hi',
      'model_no',
      'variant_label',
      'sku_code',
      'short_description',
      'synonyms',
      'spec_text',
    ],
    filterableAttributes: Array.from(new Set(['category', 'brand', 'brand_slug', 'selling_price', 'in_stock', 'stock', 'ar', ...filterable])),
    sortableAttributes: ['selling_price', 'created_at'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
    displayedAttributes: ['*'],
    synonyms,
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
    pagination: { maxTotalHits: 100_000 },
    faceting: { maxValuesPerFacet: 100 },
    searchCutoffMs: 150,
  });
  await m.tasks.waitForTask(t.taskUid);
  return index;
}

export async function indexDocs(docs: SkuSearchDoc[], batch = 1000) {
  const index = meili().index(SEARCH_INDEX);
  for (let i = 0; i < docs.length; i += batch) {
    const t = await index.addDocuments(docs.slice(i, i + batch), { primaryKey: 'id' });
    await meili().tasks.waitForTask(t.taskUid, { timeout: 600_000 });
  }
}

export async function deleteDocs(ids: number[]) {
  if (!ids.length) return;
  const t = await meili().index(SEARCH_INDEX).deleteDocuments(ids);
  await meili().tasks.waitForTask(t.taskUid);
}

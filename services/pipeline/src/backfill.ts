/**
 * Curated backfill: live extraction never drops below curated coverage. Every curated attribute a
 * human recorded as `fetched` / `verified` (with its own source) that the live pass did not read
 * is kept, with the curated provenance and source, and a note saying so.
 */
import type { AttributeValue, CuratedSku, Registry } from '@buildobjects/catalog';

export function curatedBackfill(
  values: Record<string, AttributeValue>,
  curated: CuratedSku | null,
  registry: Registry,
): { values: Record<string, AttributeValue>; added: string[] } {
  if (!curated) return { values, added: [] };
  const known = new Set(registry.attributes.map((a) => a.key));
  const out = { ...values };
  const added: string[] = [];
  for (const [k, v] of Object.entries(curated.attributes)) {
    if (!known.has(k) || k in out) continue;
    if (v.value === null || v.value === undefined || v.value === '') continue;
    if (v.provenance !== 'fetched' && v.provenance !== 'verified') continue;
    out[k] = { ...v, note: [v.note, 'kept from the curated file — not read by the live pass'].filter(Boolean).join(' · ') };
    added.push(k);
  }
  return { values: out, added };
}

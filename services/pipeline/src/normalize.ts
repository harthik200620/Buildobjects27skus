/**
 * Canonical values. `normalizeValues(registry, values)` is pure and idempotent and runs on every
 * provider's output (curated fixtures included) before anything is persisted or compared:
 *   1. numbers / booleans are re-validated with `coerceByDataType` (first number of a range, yes/no …);
 *   2. enum attributes get the registry token (exact → ci → squashed → single word-bounded hit);
 *   3. key-family rules (energy_rating → "BEE 3 Star", ip_rating → "IP67", base_type, is_standard,
 *      country_of_origin, warranty_*, colour temperature) extract the token the family wants;
 *   4. long free text (> 40 chars) is split on ` — ` / `: ` / ` (` … when the head is a usable token;
 *   5. what is still > 40 chars is returned in `residual` for the provider's `canonicalize` (an LLM
 *      call) — never truncated, never dropped.
 * Every transformation is explained in `AttributeValue.note` ("was: …"). `verified` comparisons
 * always run on normalised values, so a sentence and its token compare equal.
 */
import type { AttributeValue, Registry } from '@buildobjects/catalog';
import { coerceByDataType } from '@buildobjects/llm';
import { enumMatch, genericSplit, MAX_TOKEN, RULES } from './normalize-rules';

export interface NormalizeResult {
  values: Record<string, AttributeValue>;
  /** key → the long string no rule could shorten (queued for the provider's canonicalize). */
  residual: Record<string, string>;
  /** keys whose stored value changed in this pass. */
  changed: string[];
}

const NOTE_MAX = 512;
function joinNote(existing: string | undefined, add: string): string | undefined {
  const parts = [existing?.trim(), add.trim()].filter((p): p is string => !!p);
  if (!parts.length) return undefined;
  const joined = parts.join(' · ');
  return joined.length > NOTE_MAX ? `${joined.slice(0, NOTE_MAX - 1)}…` : joined;
}

export function normalizeValues(registry: Registry, values: Record<string, AttributeValue>): NormalizeResult {
  const byKey = new Map(registry.attributes.map((a) => [a.key, a]));
  const out: Record<string, AttributeValue> = {};
  const residual: Record<string, string> = {};
  const changed: string[] = [];
  for (const [key, v] of Object.entries(values)) {
    const attr = byKey.get(key);
    if (!attr) {
      out[key] = v;
      continue;
    }
    if (v.value === null || v.value === undefined || v.value === '') {
      out[key] = v;
      continue;
    }
    const ctx = { key, dataType: attr.data_type, unit: attr.unit ?? null };
    let next: AttributeValue = { ...v };

    /* 1. typed attributes: re-validate through the shared coercion (handles "9 W", "Yes", ranges …) */
    if (attr.data_type === 'number' || attr.data_type === 'boolean') {
      if (attr.data_type === 'number' && typeof v.value === 'string') {
        const rule = RULES.find((r) => r.test(key));
        const hit = rule?.apply(v.value, ctx);
        if (hit && typeof hit.value === 'number') {
          next = { ...next, value: hit.value, note: joinNote(v.note, hit.note) };
          out[key] = next;
          changed.push(key);
          continue;
        }
      }
      const c = coerceByDataType({ data_type: attr.data_type, enum_values: attr.enum_values, unit: attr.unit }, v.value);
      if (c.value === null) {
        out[key] = v;
        continue;
      } // nothing interpretable — keep the row as it was; the report shows it
      if (c.value !== v.value) {
        next = { ...next, value: c.value, note: joinNote(v.note, c.note ?? `was: "${String(v.value).slice(0, 200)}"`) };
        if (typeof next.confidence === 'number' && c.confidencePenalty)
          next.confidence = Math.max(0, Math.round((next.confidence - c.confidencePenalty) * 100) / 100);
        changed.push(key);
      }
      out[key] = next;
      continue;
    }

    const raw = String(v.value).replace(/\s+/g, ' ').trim();
    if (raw !== String(v.value)) next = { ...next, value: raw };

    /* 2. enums: the registry token */
    if (attr.data_type === 'enum' && attr.enum_values?.length) {
      const m = enumMatch(raw, attr.enum_values);
      if (m) {
        if (m.value !== raw) {
          next = { ...next, value: m.value, note: joinNote(v.note, m.note) };
          changed.push(key);
        }
        out[key] = next;
        continue;
      }
      // no token in the text: keep the value (never drop data), explain, queue the long ones for the LLM
      if (raw.length > MAX_TOKEN) residual[key] = raw;
      out[key] = {
        ...next,
        note: joinNote(v.note, `not one of the registry values (${attr.enum_values.slice(0, 8).join(' | ')}${attr.enum_values.length > 8 ? ' …' : ''})`),
      };
      continue;
    }

    /* 3. key-family rules */
    const rule = RULES.find((r) => r.test(key));
    if (rule) {
      const hit = rule.apply(raw, ctx);
      if (hit) {
        if (hit.value !== raw) {
          next = { ...next, value: hit.value, note: joinNote(v.note, hit.note) };
          changed.push(key);
        }
        out[key] = next;
        continue;
      }
    }

    /* 4. generic split, 5. residual */
    if (raw.length > MAX_TOKEN) {
      const split = genericSplit(raw);
      if (split) {
        next = { ...next, value: split.value, note: joinNote(v.note, split.note) };
        changed.push(key);
      } else residual[key] = raw;
    }
    out[key] = next;
  }
  return { values: out, residual, changed };
}

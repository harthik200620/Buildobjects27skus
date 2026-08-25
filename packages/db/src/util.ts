import { sql } from 'drizzle-orm';

/** DECIMAL columns come back as numbers (decimalNumbers: true) but may be null/strings from JSON — normalise. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const nowSql = sql`CURRENT_TIMESTAMP`;

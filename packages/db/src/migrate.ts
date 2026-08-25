/**
 * Applies ./drizzle migrations, then the two indexes drizzle cannot express:
 *   sku_attribute_values (attribute_id, value_text(64))  — prefix index for enum/text facet scans
 *   skus FULLTEXT(variant_label)                         — not used for search (Meilisearch is), kept for admin grep
 */
import './env';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { closeDb, getDb } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));

async function ensureIndex(table: string, name: string, ddl: string) {
  const db = getDb();
  const [rows] = (await db.execute(
    sql.raw(`SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '${table}' AND index_name = '${name}'`),
  )) as unknown as [{ n: number }[]];
  if (Number(rows[0]?.n ?? 0) > 0) return;
  await db.execute(sql.raw(ddl));
  console.log(`  + index ${table}.${name}`);
}

async function main() {
  const db = getDb();
  console.log('migrating…');
  await migrate(db, { migrationsFolder: path.join(here, '..', 'drizzle') });
  await ensureIndex('sku_attribute_values', 'sav_attr_text_idx', 'CREATE INDEX sav_attr_text_idx ON sku_attribute_values (attribute_id, value_text(64))');
  console.log('migrations applied');
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

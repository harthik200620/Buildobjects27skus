/** Drops every table (dev only) so `migrate` starts from a clean schema. Refuses outside localhost. */
import './env';
import { sql } from 'drizzle-orm';
import { closeDb, databaseUrl, getDb } from './client';

async function main() {
  const url = databaseUrl();
  if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error('reset refuses to run against a non-local DATABASE_URL');
  const db = getDb();
  const [rows] = (await db.execute(sql.raw('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()'))) as unknown as [
    { t: string }[],
  ];
  await db.execute(sql.raw('SET FOREIGN_KEY_CHECKS = 0'));
  for (const r of rows) await db.execute(sql.raw(`DROP TABLE IF EXISTS \`${r.t}\``));
  await db.execute(sql.raw('SET FOREIGN_KEY_CHECKS = 1'));
  console.log(`dropped ${rows.length} tables`);
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

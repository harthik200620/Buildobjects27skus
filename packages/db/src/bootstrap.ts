/**
 * `pnpm db:bootstrap` — make the database usable, then get out of the way.
 *
 * A managed host gives you an empty database and a start command. Nothing in between runs, so
 * this does the in-between: wait for the server to answer, restore the catalogue if the database
 * is empty, apply any migrations that are newer than the restore, and exit. It is idempotent —
 * on every deploy after the first it is two queries and a no-op.
 *
 * It exits 0 when there is no database configured at all. That is deliberate: the storefront
 * falls back to `apps/web/data/catalogue`, so a deployment without a database is a smaller
 * store, not a broken one, and the boot sequence should not be the thing that decides otherwise.
 */
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { databaseUrl } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..');
const DUMP = path.join(REPO_ROOT, 'infra', 'seed', 'buildobjects.sql.gz');
const MIGRATIONS = path.join(here, '..', 'drizzle');

/** A cold Postgres-shaped container answers in a second; a cold MySQL one can take forty. */
const WAIT_MS = Number(process.env.DB_WAIT_MS || 120_000);
const LOCK = 'buildobjects_bootstrap';

const log = (m: string) => process.stdout.write(`[bootstrap] ${m}\n`);

async function connect(uri: string): Promise<mysql.Connection> {
  const deadline = Date.now() + WAIT_MS;
  let last = '';
  for (;;) {
    try {
      const conn = await mysql.createConnection({ uri, multipleStatements: true, charset: 'utf8mb4_0900_ai_ci' });
      await conn.ping();
      return conn;
    } catch (e) {
      last = (e as Error).message;
      if (Date.now() > deadline) throw new Error(`database never answered in ${WAIT_MS / 1000}s: ${last}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Seeded means the catalogue is there — an empty `skus` is as unusable as a missing one. */
async function isSeeded(conn: mysql.Connection): Promise<boolean> {
  const [t] = (await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'skus'")) as [
    { n: number }[],
    unknown,
  ];
  if (!Number(t[0]?.n ?? 0)) return false;
  const [rows] = (await conn.query('SELECT COUNT(*) AS n FROM skus')) as [{ n: number }[], unknown];
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * The dump carries the schema for every table and the data for the catalogue ones only.
 *
 * Users, sessions, OTP challenges, saved estimates and the pipeline's ingest log are structure
 * without rows — that data belongs to whoever ran the pipeline, and none of it belongs in a
 * public repository. It also carries `__drizzle_migrations`, so the migrator that runs next
 * knows the restored schema is current instead of trying to create it a second time.
 */
async function restore(conn: mysql.Connection): Promise<void> {
  if (!fs.existsSync(DUMP)) {
    log(`no catalogue dump at ${path.relative(REPO_ROOT, DUMP)} — leaving the database as it is`);
    return;
  }
  const statements = zlib.gunzipSync(fs.readFileSync(DUMP)).toString('utf8');
  log(`restoring the catalogue (${(statements.length / 1024 / 1024).toFixed(1)} MB of SQL)`);
  await conn.query(statements);
  const [rows] = (await conn.query('SELECT COUNT(*) AS n FROM skus')) as [{ n: number }[], unknown];
  log(`restored — ${rows[0]?.n ?? 0} SKUs`);
}

async function main(): Promise<void> {
  let uri: string;
  try {
    uri = databaseUrl();
  } catch {
    log('no database configured — the storefront will serve the frozen catalogue');
    return;
  }
  log(`database ${uri.replace(/:\/\/([^:]*):[^@]*@/, '://$1:***@')}`);

  const conn = await connect(uri);
  try {
    /* One deploy at a time. Two instances booting together would otherwise race the restore. */
    const [lock] = (await conn.query('SELECT GET_LOCK(?, 180) AS ok', [LOCK])) as [{ ok: number }[], unknown];
    if (Number(lock[0]?.ok ?? 0) !== 1) throw new Error('another instance holds the bootstrap lock');

    if (await isSeeded(conn)) log('catalogue already present');
    else await restore(conn);

    await migrate(drizzle(conn), { migrationsFolder: MIGRATIONS });
    log('migrations up to date');
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {});
    await conn.end().catch(() => {});
  }
}

/*
 * A database that cannot be reached is reported and survived, not fatal. The alternative is a
 * host that refuses to start the web server because a restore failed, which turns a degraded
 * store into no store at all.
 */
main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write(`[bootstrap] ${(e as Error).message}\n`);
    process.stderr.write('[bootstrap] continuing — the storefront falls back to the frozen catalogue\n');
    process.exit(0);
  });

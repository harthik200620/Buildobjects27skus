/**
 * The runtime store, on Postgres.
 *
 * The catalogue does not live here. Thirty-seven categories and twenty-seven SKUs ship as a
 * 1 MB snapshot (`apps/web/data/catalogue`) that every loader already falls back to, and a
 * read-only catalogue that small is better served from a file next to the code than from a
 * network hop — it cannot be down, it cannot be slow, and it cannot be paused for inactivity
 * the way a free database can.
 *
 * What genuinely needs a database is the part a deployment writes: who signed in, which sessions
 * exist, which one-time codes were issued, and which estimates were saved. Four tables. They are
 * defined here rather than ported from `schema.ts` because that schema is MySQL — it is the
 * pipeline's authoring database, it stays MySQL, and dragging twenty tables and six migrations
 * across dialects to persist four of them would be a large change to make a small thing work.
 *
 * Connection strings come from whatever the host provides. Vercel's Supabase integration sets
 * `POSTGRES_URL` (pooled, pgbouncer) and `POSTGRES_URL_NON_POOLING` (direct); a plain Postgres
 * host sets `DATABASE_URL`. Any of them will do.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { bigserial, index, integer, jsonb, numeric, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const pgUsers = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    phone: varchar('phone', { length: 16 }).notNull(),
    createdAt: now(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_phone_uq').on(t.phone)],
);

export const pgSessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: integer('user_id').notNull(),
    regionId: varchar('region_id', { length: 24 }),
    pincode: varchar('pincode', { length: 6 }),
    createdAt: now(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const pgOtpChallenges = pgTable(
  'otp_challenges',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    phone: varchar('phone', { length: 16 }).notNull(),
    code: varchar('code', { length: 8 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (t) => [index('otp_phone_idx').on(t.phone)],
);

export const pgEstimates = pgTable(
  'estimates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    publicId: varchar('public_id', { length: 16 }).notNull(),
    inputs: jsonb('inputs').notNull(),
    outputs: jsonb('outputs').notNull(),
    tier: varchar('tier', { length: 12 }).notNull(),
    city: varchar('city', { length: 48 }).notNull(),
    grandTotal: numeric('grand_total', { precision: 14, scale: 2 }),
    createdAt: now(),
  },
  (t) => [uniqueIndex('estimates_public_uq').on(t.publicId)],
);

export type PgDb = PostgresJsDatabase<Record<string, never>>;

/** Pooled first: a serverless function that opens its own direct connection per invocation is how a free Postgres runs out of connections. */
function url(): string | null {
  const candidates = [process.env.POSTGRES_URL, process.env.POSTGRES_URL_NON_POOLING, process.env.SUPABASE_DB_URL, process.env.DATABASE_URL];
  for (const c of candidates) {
    const v = c?.trim();
    if (v && /^postgres(ql)?:\/\//.test(v)) return v;
  }
  return null;
}

export const hasPg = (): boolean => url() !== null;

let client: postgres.Sql | null = null;
let db: PgDb | null = null;

export function getPg(): PgDb {
  if (db) return db;
  const u = url();
  if (!u) throw new Error('no Postgres connection string (POSTGRES_URL / DATABASE_URL)');
  client = postgres(u, {
    /* pgbouncer in transaction mode cannot hold a prepared statement across a checkout. */
    prepare: false,
    max: Number(process.env.PG_POOL_SIZE || 3),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: u.includes('localhost') || u.includes('127.0.0.1') ? undefined : 'require',
  });
  db = drizzle(client);
  return db;
}

/**
 * Create the four tables if they are not there yet.
 *
 * A managed Postgres arrives empty and nothing runs between provisioning it and the first
 * request, so the first request creates what it needs. Four `IF NOT EXISTS` statements are a
 * smaller and more honest mechanism than a migration runner for a schema that is not going to
 * grow — and they cost one round trip, once per process.
 */
let ready: Promise<void> | null = null;
export function ensurePgSchema(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const d = getPg();
    await d.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        phone VARCHAR(16) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      )`);
    await d.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq ON users (phone)`);
    await d.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id BIGINT NOT NULL,
        region_id VARCHAR(24),
        pincode VARCHAR(6),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )`);
    await d.execute(sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`);
    await d.execute(sql`
      CREATE TABLE IF NOT EXISTS otp_challenges (
        id BIGSERIAL PRIMARY KEY,
        phone VARCHAR(16) NOT NULL,
        code VARCHAR(8) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await d.execute(sql`CREATE INDEX IF NOT EXISTS otp_phone_idx ON otp_challenges (phone)`);
    await d.execute(sql`
      CREATE TABLE IF NOT EXISTS estimates (
        id BIGSERIAL PRIMARY KEY,
        public_id VARCHAR(16) NOT NULL,
        inputs JSONB NOT NULL,
        outputs JSONB NOT NULL,
        tier VARCHAR(12) NOT NULL,
        city VARCHAR(48) NOT NULL,
        grand_total NUMERIC(14,2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await d.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS estimates_public_uq ON estimates (public_id)`);
  })().catch((e) => {
    /* One failed attempt must not poison the process — the next request tries again. */
    ready = null;
    throw e;
  });
  return ready;
}

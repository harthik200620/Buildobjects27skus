import './env';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

export type Db = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let db: Db | null = null;

/**
 * The connection string, from `DATABASE_URL` or assembled from parts.
 *
 * The parts exist for Render. A Blueprint can hand one service another service's hostname and
 * another service's generated password, but it cannot concatenate them into a URL — so a managed
 * deployment has to either compose the URL here or ask a person to paste a secret by hand. It
 * composes it here. `DATABASE_URL` still wins wherever it is set, which is everywhere else.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;

  const host = process.env.DB_HOST?.trim();
  if (host) {
    const port = process.env.DB_PORT?.trim() || '3306';
    const user = encodeURIComponent(process.env.DB_USER?.trim() || 'root');
    const password = encodeURIComponent(process.env.DB_PASSWORD ?? process.env.MYSQL_ROOT_PASSWORD ?? '');
    const name = process.env.DB_NAME?.trim() || process.env.MYSQL_DATABASE?.trim() || 'buildobjects';
    return `mysql://${user}:${password}@${host}:${port}/${name}`;
  }

  throw new Error('DATABASE_URL is not set (see .env.example)');
}

/** One pool per process. `connectionLimit` sized for a web worker; the pipeline raises it via env. */
export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: databaseUrl(),
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
      maxIdle: 10,
      idleTimeout: 60_000,
      enableKeepAlive: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
      decimalNumbers: true,
      timezone: 'Z',
      charset: 'utf8mb4_0900_ai_ci',
    });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) db = drizzle(getPool(), { schema, mode: 'default' });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

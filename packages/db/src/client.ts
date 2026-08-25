import './env';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

export type Db = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let db: Db | null = null;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return url;
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

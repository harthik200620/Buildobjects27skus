#!/usr/bin/env node
/**
 * `pnpm db:dump` — regenerate infra/seed/buildobjects.sql.gz from the local database.
 *
 * This is what a fresh deployment restores, so what it contains is a decision, not an export:
 *
 *   · schema for every table — the store needs somewhere to write sessions and estimates;
 *   · data for the catalogue tables only — categories, brands, SKUs, specifications, images;
 *   · `__drizzle_migrations` rows, so the migrator that runs after the restore knows the schema
 *     it just received is current and does not try to create it again.
 *
 * Users, sessions, OTP challenges, saved estimates and the pipeline's ingest log are dumped as
 * empty structure. They are one developer's rows, they include phone numbers, and the file is
 * committed to a public repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'infra', 'seed');
const SQL = path.join(OUT_DIR, 'buildobjects.sql');
const GZ = `${SQL}.gz`;

/** Tables whose rows ship. Everything else in the schema is created empty. */
const DATA = [
  '__drizzle_migrations',
  'attribute_groups',
  'attributes',
  'brands',
  'categories',
  'filter_configs',
  'gst_rates',
  'products',
  'regions',
  'search_synonyms',
  'sku_attribute_values',
  'sku_documents',
  'sku_images',
  'skus',
];

function mysqldump() {
  const local = path.join(ROOT, 'infra', 'bin', 'mysql', 'bin', process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump');
  return fs.existsSync(local) ? local : 'mysqldump';
}

/** Parse the connection out of DATABASE_URL; the local default is the one infra/local.mjs sets up. */
function target() {
  const url = new URL(process.env.DATABASE_URL || 'mysql://root:buildo@127.0.0.1:3306/buildobjects');
  return {
    host: url.hostname,
    port: url.port || '3306',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

const t = target();
const common = [
  `-h${t.host}`,
  `-P${t.port}`,
  `-u${t.user}`,
  ...(t.password ? [`-p${t.password}`] : []),
  '--default-character-set=utf8mb4',
  '--no-tablespaces',
  '--single-transaction',
  '--skip-add-locks',
  /* Without this every regeneration rewrites the timestamp line and the file churns in git. */
  '--skip-dump-date',
  '--set-gtid-purged=OFF',
];

const run = (args) => execFileSync(mysqldump(), args, { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });

fs.mkdirSync(OUT_DIR, { recursive: true });
const head = [
  '-- Build Objects catalogue — schema for every table, data for the catalogue only.',
  '-- Regenerate: pnpm db:dump',
  'SET NAMES utf8mb4; SET FOREIGN_KEY_CHECKS=0;',
  '',
].join('\n');
const schema = run([...common, '--no-data', '--add-drop-table', t.database]);
const data = run([...common, '--no-create-info', '--hex-blob', '--extended-insert', t.database, ...DATA]);
const sql = `${head}${schema}${data}\nSET FOREIGN_KEY_CHECKS=1;\n`;

fs.writeFileSync(SQL, sql);
fs.writeFileSync(GZ, zlib.gzipSync(Buffer.from(sql, 'utf8'), { level: 9 }));

const tables = (sql.match(/CREATE TABLE/g) || []).length;
const inserts = (sql.match(/INSERT INTO/g) || []).length;
const phones = (sql.match(/\b[6-9]\d{9}\b/g) || []).length;
process.stdout.write(`${tables} tables · rows for ${inserts} of them · ${(fs.statSync(GZ).size / 1024).toFixed(0)} KB gzipped\n`);
if (phones) process.stdout.write(`WARNING: ${phones} strings look like Indian mobile numbers — check what got dumped before committing\n`);

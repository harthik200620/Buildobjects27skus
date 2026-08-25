#!/usr/bin/env node
/**
 * Local infra without Docker (Windows): MySQL 8.4 portable, Meilisearch binary, Redis in WSL Ubuntu.
 *   node infra/local.mjs up      start everything (initialises MySQL on first run)
 *   node infra/local.mjs down    stop everything
 *   node infra/local.mjs status  port check
 * With Docker available, `docker compose -f infra/docker-compose.yml up -d` is the equivalent.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'infra', 'bin');
const DATA = path.join(ROOT, 'infra', 'data');
const RUN = path.join(ROOT, 'infra', 'run');
const MYSQL_HOME = path.join(BIN, 'mysql');
const MYSQL_DATA = path.join(DATA, 'mysql');
const MEILI_DATA = path.join(DATA, 'meili');
const MYSQL_PORT = 3306,
  MEILI_PORT = 7700,
  REDIS_PORT = 6379;
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'buildo';
const MEILI_KEY = process.env.MEILI_MASTER_KEY || 'buildo-local';
const DB = 'buildobjects';
const WSL_DISTRO = process.env.WSL_DISTRO || 'Ubuntu';

for (const d of [DATA, RUN]) fs.mkdirSync(d, { recursive: true });

const portOpen = (port, host = '127.0.0.1') =>
  new Promise((res) => {
    const s = createConnection({ port, host });
    const done = (v) => {
      try {
        s.destroy();
      } catch {}
      res(v);
    };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(800, () => done(false));
  });
async function waitPort(port, label, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not open port ${port} within ${ms} ms — see infra/run/*.log`);
}
function detach(name, cmd, args = [], opts = {}) {
  if (process.platform === 'win32') {
    const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(', ');
    const psCmd = `(Start-Process -FilePath '${cmd}' ${argList ? `-ArgumentList ${argList}` : ''} -WindowStyle Hidden -PassThru).Id`;
    const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { encoding: 'utf8' });
    const pid = Number(res.stdout.trim().split(/\r?\n/).pop());
    fs.writeFileSync(path.join(RUN, `${name}.pid`), String(pid));
    return pid;
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
  child.unref();
  fs.writeFileSync(path.join(RUN, `${name}.pid`), String(child.pid));
  return child.pid;
}
const pidOf = (name) => {
  try {
    return Number(fs.readFileSync(path.join(RUN, `${name}.pid`), 'utf8'));
  } catch {
    return null;
  }
};
const mysqlBin = (exe) => path.join(MYSQL_HOME, 'bin', exe);
const myIni = path.join(DATA, 'my.ini');

function writeMyIni() {
  const p = (s) => s.replace(/\\/g, '/');
  fs.writeFileSync(
    myIni,
    `[mysqld]
basedir=${p(MYSQL_HOME)}
datadir=${p(MYSQL_DATA)}
port=${MYSQL_PORT}
bind-address=127.0.0.1
mysqlx=0
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
innodb_buffer_pool_size=1G
innodb_redo_log_capacity=64M
innodb_flush_log_at_trx_commit=2
max_allowed_packet=256M
local_infile=1
sql_mode=STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION
log_error=${p(path.join(RUN, 'mysqld-error.log'))}
[client]
port=${MYSQL_PORT}
`,
  );
}

async function upMysql() {
  if (await portOpen(MYSQL_PORT)) {
    console.log(`mysql     already listening on ${MYSQL_PORT}`);
    return;
  }
  if (!fs.existsSync(mysqlBin('mysqld.exe'))) throw new Error(`MySQL not found at ${MYSQL_HOME} — extract infra/bin/mysql-8.4.x-winx64.zip to infra/bin/mysql`);
  const fresh = !fs.existsSync(path.join(MYSQL_DATA, 'mysql'));
  writeMyIni();
  if (fresh) {
    console.log('mysql     initialising data directory (first run)…');
    fs.mkdirSync(MYSQL_DATA, { recursive: true });
    const r = spawnSync(mysqlBin('mysqld.exe'), [`--defaults-file=${myIni}`, '--initialize-insecure', '--console'], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(r.stdout, r.stderr);
      throw new Error('mysqld --initialize-insecure failed');
    }
  }
  detach('mysqld', mysqlBin('mysqld.exe'), [`--defaults-file=${myIni}`]);
  await waitPort(MYSQL_PORT, 'MySQL');
  if (fresh) {
    const sql = `ALTER USER 'root'@'localhost' IDENTIFIED BY '${MYSQL_PASSWORD}'; CREATE DATABASE IF NOT EXISTS ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`;
    const r = spawnSync(mysqlBin('mysql.exe'), ['-uroot', '--skip-password', '-h127.0.0.1', `-P${MYSQL_PORT}`, '-e', sql], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(r.stdout, r.stderr);
      throw new Error('could not set root password / create database');
    }
    console.log(`mysql     created database ${DB}, root password set`);
  }
  console.log(`mysql     up on ${MYSQL_PORT}  (mysql://root:${MYSQL_PASSWORD}@localhost:${MYSQL_PORT}/${DB})`);
}

async function upMeili() {
  if (await portOpen(MEILI_PORT)) {
    console.log(`meili     already listening on ${MEILI_PORT}`);
    return;
  }
  const exe = path.join(BIN, 'meilisearch.exe');
  if (!fs.existsSync(exe)) throw new Error(`Meilisearch not found at ${exe}`);
  fs.mkdirSync(MEILI_DATA, { recursive: true });
  detach('meilisearch', exe, [
    '--master-key',
    MEILI_KEY,
    '--db-path',
    MEILI_DATA,
    '--http-addr',
    `127.0.0.1:${MEILI_PORT}`,
    '--env',
    'development',
    '--no-analytics',
  ]);
  await waitPort(MEILI_PORT, 'Meilisearch');
  console.log(`meili     up on ${MEILI_PORT}  (http://127.0.0.1:${MEILI_PORT}, key ${MEILI_KEY})`);
}

function wsl(args, opts = {}) {
  return spawnSync('wsl', ['-d', WSL_DISTRO, '-u', 'root', '--', ...args], { encoding: 'utf8', ...opts });
}
async function upRedis() {
  if (await portOpen(REDIS_PORT)) {
    console.log(`redis     already listening on ${REDIS_PORT}`);
    return;
  }
  const probe = wsl(['bash', '-lc', 'command -v redis-server']);
  if (probe.status !== 0 || !probe.stdout.trim()) {
    console.warn('redis     not available: WSL Ubuntu with redis-server not found. Pipeline falls back to QUEUE_DRIVER=local.');
    return;
  }
  // Try loopback first; WSL2 forwards localhost. Fall back to 0.0.0.0 (NAT-only reachability) if Windows cannot see it.
  for (const bind of ['127.0.0.1', '0.0.0.0']) {
    wsl([
      'bash',
      '-lc',
      `redis-cli -p ${REDIS_PORT} shutdown nosave >/dev/null 2>&1; redis-server --daemonize yes --bind ${bind} --protected-mode no --port ${REDIS_PORT} --save "" --appendonly no --logfile /tmp/redis-buildo.log`,
    ]);
    try {
      await waitPort(REDIS_PORT, 'Redis', 6000);
      console.log(`redis     up on ${REDIS_PORT} (WSL ${WSL_DISTRO}, bind ${bind})`);
      return;
    } catch {}
  }
  console.warn('redis     started in WSL but Windows cannot reach it. Pipeline falls back to QUEUE_DRIVER=local.');
}

async function down() {
  if (await portOpen(MYSQL_PORT)) {
    const r = spawnSync(mysqlBin('mysqladmin.exe'), ['-uroot', `-p${MYSQL_PASSWORD}`, '-h127.0.0.1', `-P${MYSQL_PORT}`, 'shutdown'], { encoding: 'utf8' });
    console.log(r.status === 0 ? 'mysql     shut down' : `mysql     shutdown: ${r.stderr || 'sent'}`);
  }
  const myp = pidOf('mysqld');
  if (myp) {
    try {
      spawnSync('taskkill', ['/PID', String(myp), '/F', '/T'], { encoding: 'utf8' });
    } catch {}
  }
  const mp = pidOf('meilisearch');
  if (mp) {
    spawnSync('taskkill', ['/PID', String(mp), '/F', '/T'], { encoding: 'utf8' });
    console.log('meili     stopped');
  }
  wsl(['bash', '-lc', `redis-cli -p ${REDIS_PORT} shutdown nosave`]);
  console.log('redis     stopped (if it was running)');
}

async function status() {
  for (const [label, port] of [
    ['mysql', MYSQL_PORT],
    ['meili', MEILI_PORT],
    ['redis', REDIS_PORT],
  ]) {
    console.log(`${label.padEnd(9)} ${(await portOpen(port)) ? 'UP  ' : 'DOWN'} :${port}`);
  }
}

const cmd = process.argv[2] || 'status';
try {
  if (cmd === 'up') {
    await upMysql();
    await upMeili();
    await upRedis();
    await status();
  } else if (cmd === 'down') await down();
  else await status();
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(1);
}

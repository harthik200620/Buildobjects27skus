/**
 * pnpm --filter @buildobjects/web lighthouse [--base http://localhost:3000] [--mobile]
 * Lighthouse on home, PLP and PDP with a demo session cookie (the pages sit behind the door).
 * Budgets (§9): performance ≥ 95, accessibility ≥ 95. Writes storage/reports/lighthouse-latest.json.
 * Uses CHROME_PATH if set, else Playwright's bundled Chromium.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionCookie as demoCookie } from './session-cookie';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = flag('base', 'http://localhost:3000');
const MOBILE = args.includes('--mobile');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const sessionCookie = () => demoCookie({ sid: 'lighthouse' });
function findChrome(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pw = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  try {
    const dirs = fs
      .readdirSync(pw)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) {
      const exe = path.join(pw, d, 'chrome-win', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
      const exe2 = path.join(pw, d, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe2)) return exe2;
    }
  } catch {
    /* no playwright browsers */
  }
  return undefined;
}

async function main() {
  const lighthouse = (await import('lighthouse')).default;
  const chromeLauncher = await import('chrome-launcher');
  const cookie = sessionCookie();
  const first = (await fetch(`${BASE}/api/skus?limit=1`, { headers: { cookie } })
    .then((r) => r.json())
    .catch(() => null)) as { items?: { sku_code: string }[] } | null;
  const code = first?.items?.[0]?.sku_code?.toLowerCase() ?? 'cem-ult-ppc50';
  const pages = [
    { key: 'home', url: '/' },
    { key: 'plp', url: '/c/bulbs' },
    { key: 'pdp', url: `/p/${code}` },
  ];
  const chrome = await chromeLauncher.launch({ chromePath: findChrome(), chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
  const out: Record<string, { performance: number; accessibility: number; bestPractices: number; seo: number; lcp: number; tbt: number; cls: number }> = {};
  try {
    for (const p of pages) {
      const r = await lighthouse(`${BASE}${p.url}`, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        extraHeaders: { Cookie: cookie },
        formFactor: MOBILE ? 'mobile' : 'desktop',
        screenEmulation: MOBILE
          ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
          : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
        throttling: MOBILE
          ? undefined
          : { rttMs: 40, throughputKbps: 10_240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
      });
      const lhr = r?.lhr;
      if (!lhr) throw new Error(`no result for ${p.url}`);
      const s = (k: string) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
      const a = (k: string) => Number(lhr.audits[k]?.numericValue ?? 0);
      out[p.key] = {
        performance: s('performance'),
        accessibility: s('accessibility'),
        bestPractices: s('best-practices'),
        seo: s('seo'),
        lcp: Math.round(a('largest-contentful-paint')),
        tbt: Math.round(a('total-blocking-time')),
        cls: Math.round(a('cumulative-layout-shift') * 1000) / 1000,
      };
      console.log(
        `  ${p.key.padEnd(5)} ${p.url.padEnd(26)} perf ${String(out[p.key].performance).padStart(3)}  a11y ${String(out[p.key].accessibility).padStart(3)}  bp ${String(out[p.key].bestPractices).padStart(3)}  seo ${String(out[p.key].seo).padStart(3)}  LCP ${out[p.key].lcp} ms  TBT ${out[p.key].tbt} ms  CLS ${out[p.key].cls}`,
      );
      // name every failing audit so a budget miss is actionable
      for (const cat of ['accessibility', 'performance', 'seo'] as const) {
        const refs = new Set((lhr.categories[cat]?.auditRefs ?? []).map((r) => r.id));
        const failing = Object.values(lhr.audits).filter(
          (au) => refs.has(au.id) && au.score !== null && au.score < 0.9 && au.scoreDisplayMode !== 'informative',
        );
        for (const au of failing) {
          const items = ((au.details as { items?: { node?: { selector?: string; snippet?: string } }[] } | undefined)?.items ?? [])
            .slice(0, 3)
            .map((it) => it.node?.selector ?? it.node?.snippet ?? '')
            .filter(Boolean);
          console.log(
            `        ${cat.slice(0, 4)} ✗ ${au.id} (${Math.round((au.score ?? 0) * 100)}) — ${au.title}${items.length ? ` → ${items.join(' | ').slice(0, 240)}` : ''}`,
          );
        }
      }
    }
  } finally {
    try {
      await chrome.kill();
    } catch {
      /* temp-dir cleanup on Windows can throw EPERM after Chrome has exited */
    }
  }
  const ok = Object.values(out).every((o) => o.performance >= 95 && o.accessibility >= 95);
  fs.mkdirSync(path.join(ROOT, 'storage', 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'storage', 'reports', 'lighthouse-latest.json'),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        base: BASE,
        formFactor: MOBILE ? 'mobile' : 'desktop',
        pages: out,
        budgets: { performance: 95, accessibility: 95 },
        ok,
      },
      null,
      2,
    ),
  );
  console.log(`\n${ok ? '✓' : '✗'} budgets performance ≥ 95 and accessibility ≥ 95 on home, PLP, PDP · report → storage/reports/lighthouse-latest.json`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

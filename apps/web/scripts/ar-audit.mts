/**
 * DOES THE PRODUCT ACTUALLY APPEAR, AT EVERY ANGLE A PHONE IS HELD AT?
 *
 * pnpm --filter @buildobjects/web ar:audit [--base http://localhost:3000] [--only cem-ult-ppc50,...]
 *                                          [--strict] [--shots] [--out dir]
 *
 * Every "I opened the camera and there is no product" report so far was found by a person opening
 * the view and looking at it. That is not a regression test, and the proof is that the bug shipped
 * three times, in three different forms, and was reported the same way each time. The engine-side
 * maths is covered by packages/ar-engine/test/framing.test.ts; this covers the half that maths
 * cannot: three.js, the GLB, the cover map, the DOM and the render loop, all running together.
 *
 * -- HOW IT DRIVES A PHONE FROM A DESKTOP ----------------------------------------------------
 * Two pieces of Chromium plumbing make this possible without a phone in someone's hand:
 *
 *   · `--use-fake-device-for-media-stream` gives getUserMedia a synthetic camera, so the live view
 *     reaches its streaming state and the whole placement path runs for real.
 *   · Synthetic `deviceorientation` events drive the pose. The view derives its pitch from nothing
 *     else, so dispatching alpha/beta/gamma IS tilting the phone — which is what finally makes the
 *     reported top-down case testable rather than a thing to be checked by hand.
 *
 * -- HOW IT COUNTS THE PRODUCT ---------------------------------------------------------------
 * The stage is photographed twice: once as it is, and once with the WebGL canvas hidden. Every
 * pixel that differs is a pixel of product. That works whatever the camera happens to be pointed
 * at, needs no test hook inside the app, and measures the thing the user is complaining about —
 * whether there is a product on the screen — rather than a proxy for it.
 *
 * A frame-time sample runs alongside, because "the website is being lagged" was reported in the
 * same breath, and the render loop is where the cost was.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { sessionCookieFor } from './session-cookie';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const BASE = flag('base', 'http://localhost:3000').replace(/\/$/, '');
const STRICT = args.includes('--strict');
const SHOTS = args.includes('--shots');
const ONLY = flag('only', '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.resolve(flag('out', path.join(ROOT, 'storage', 'reports', 'ar')));

/**
 * The angles. -75 is a phone held nearly flat over a floor, which is the reported case; +25 is one
 * tilted up at a ceiling. Everything between is somebody standing in a room holding a phone.
 */
const PITCHES = [25, 5, -15, -40, -75];

/**
 * At least this many pixels of product, out of a 390 x 780 stage, before the view can be said to be
 * showing anything. Around 1500 px is a thumbnail-sized object — small, but unmistakably present,
 * and far below anything a working placement produces. The failure this guards against is zero.
 */
const MIN_PRODUCT_PX = 1500;

interface Debug {
  pitch: number | null;
  fit: string | null;
  video: string | null;
  anchor: string | null;
}

interface Result {
  sku: string;
  category: string;
  pitch: number;
  productPx: number;
  stagePx: number;
  nudge: string | null;
  ok: boolean;
  debug?: Debug | null;
}

/** Every SKU with a mesh, straight from the catalogue the site serves. */
async function skus(): Promise<{ code: string; category: string }[]> {
  const file = path.join(ROOT, 'apps', 'web', 'data', 'catalogue', 'skus.json');
  const rows: Record<string, { sku: { code: string }; category?: { slug?: string } | null }> = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.values(rows)
    .filter((r) => !!r.category?.slug)
    .map((r) => ({ code: r.sku.code.toLowerCase(), category: r.category?.slug as string }))
    .filter((r) => !ONLY.length || ONLY.includes(r.code));
}

/**
 * Hold the phone at a pitch, continuously, the way a phone does.
 *
 * A burst of events and then silence is not what a device orientation feed looks like, and the view
 * knows it: `useOrientation` marks the sensor dead after 1500 ms without a sample and falls back to
 * an assumed pitch. Dispatching twenty events and then waiting 1600 ms therefore measured the
 * fallback about half the time — which showed up as a flaky harness rather than as a wrong answer,
 * and a flaky harness is how a real bug gets dismissed as noise.
 *
 * So this installs a 100 ms ticker on the page once, and tilting is just changing the number it
 * sends. `beta` is the front-to-back tilt in the DeviceOrientation spec: 0 is a phone lying face up,
 * 90 is upright, so a camera pitch of p is beta = 90 + p.
 */
async function startTiltFeed(page: Page): Promise<void> {
  /*
   * Passed as source text, not as a function. tsx compiles this file with esbuild's `keepNames`,
   * which rewrites every function into a `__name(...)` call — and `__name` does not exist inside the
   * page, so an ordinary arrow function throws ReferenceError the moment Playwright serialises it.
   */
  await page.evaluate(`(() => {
    window.__tiltBeta = 80;
    if (window.__tiltTimer) clearInterval(window.__tiltTimer);
    window.__tiltTimer = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: window.__tiltBeta, gamma: 0 }));
    }, 100);
  })()`);
}

async function tilt(page: Page, pitchDeg: number): Promise<{ ok: boolean; why: string }> {
  await page.evaluate(`(() => { window.__tiltBeta = 90 + (${pitchDeg}); })()`);
  /* Long enough for the feed's slerp to converge and for the off-screen check to run even on
     software GL, where this harness gets single-digit frame rates. */
  await page.waitForTimeout(1600);

  /*
   * DID THE PHONE ACTUALLY TILT?
   *
   * It is the whole premise of this harness, and for one round it silently was not true: the view
   * had a stale closure over the "sensors are alive" flag, threw every sample away, and ran on a
   * constant assumed pitch of -10 degrees. Five angles were measured, five identical answers came
   * back, and nothing said anything was wrong. A harness that quietly stops exercising the thing it
   * claims to exercise is worse than none, so this reads the pose back and complains.
   */
  const read = async () => (await page.evaluate('(() => { const d = window.__arDebug; return d && d.pose ? d.pose.pitchDeg : null; })()')) as number | null;
  let actual = await read();
  if (actual !== null && Math.abs(actual - pitchDeg) > 8) {
    /* Screenshots pause the page, and a paused page throttles the ticker below the view's 1500 ms
       silence timeout, which drops it back to the assumed pitch. Give the feed another second to
       be believed before calling it a failure. */
    await page.waitForTimeout(1200);
    actual = await read();
  }
  if (actual === null) return { ok: false, why: 'no pose reported — is ?debug=1 on the URL?' };
  if (Math.abs(actual - pitchDeg) > 8) return { ok: false, why: `asked for ${pitchDeg} deg, camera is at ${actual.toFixed(1)}` };
  return { ok: true, why: '' };
}

/**
 * Pixels that change when the 3D canvas is hidden — i.e. pixels of product.
 *
 * THE VIDEO IS HIDDEN FOR BOTH SHOTS, and that is not a detail. Chromium's fake camera is a rolling
 * animation, so two screenshots a tenth of a second apart differ in every pixel of the feed:
 * measured against the live feed this reported 92 % of the stage as "product" for a placement that
 * was showing a sliver. A measurement that agrees with whatever it is asked to confirm is worse
 * than no measurement at all.
 *
 * Hidden, the backdrop is the stage's own flat colour in both frames, so the only thing that can
 * differ is the product. Pausing was the first attempt and does not work: a video element backed by
 * a MediaStream keeps painting.
 */
async function productPixels(page: Page): Promise<{ productPx: number; stagePx: number }> {
  const stage = page.locator('.ar-camera').first();
  const setVis = (sel: string, v: string) => page.evaluate(`(() => { const e = document.querySelector('${sel}'); if (e) e.style.visibility = '${v}'; })()`);
  /*
   * Playwright's screenshot pauses the page, and a paused page throttles the ticker in
   * `startTiltFeed` past the view's 1500 ms silence timeout — at which point it decides the sensor
   * is dead and drops back to the assumed pitch, so the frame being photographed is at the wrong
   * angle. A burst either side of each capture keeps the feed believed across the pause.
   */
  const keepAlive = () =>
    page.evaluate(
      `(() => { for (let i = 0; i < 8; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: window.__tiltBeta, gamma: 0 })); })()`,
    );
  await setVis('video.ar-camera-video', 'hidden');
  await keepAlive();
  await page.waitForTimeout(150);
  const withIt = await stage.screenshot();
  await keepAlive();
  await setVis('canvas.ar-camera-webgl', 'hidden');
  await page.waitForTimeout(150);
  const withoutIt = await stage.screenshot();
  await keepAlive();
  await setVis('canvas.ar-camera-webgl', '');
  await setVis('video.ar-camera-video', '');

  const a = await sharp(withIt).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(withoutIt).raw().toBuffer({ resolveWithObject: true });
  const ch = a.info.channels;
  const n = Math.min(a.data.length, b.data.length) / ch;
  let diff = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    /* 24 per channel: above any compositing noise, below any real product edge. */
    if (Math.abs(a.data[o] - b.data[o]) > 24 || Math.abs(a.data[o + 1] - b.data[o + 1]) > 24 || Math.abs(a.data[o + 2] - b.data[o + 2]) > 24) diff++;
  }
  return { productPx: diff, stagePx: a.info.width * a.info.height };
}

/** Frame times of the live render loop, in the page, with the camera running. */
async function frameTimes(page: Page): Promise<{ fps: number; medianMs: number; p95Ms: number; canvasReallocs: number }> {
  /* Source text, for the `__name` reason in `tilt` above. */
  return page.evaluate(`(async () => {
    const canvas = document.querySelector('canvas.ar-camera-webgl');
    let reallocs = 0;
    if (canvas) {
      const w = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
      const h = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
      Object.defineProperty(canvas, 'width', { get: () => w.get.call(canvas), set: (v) => { reallocs++; w.set.call(canvas, v); }, configurable: true });
      Object.defineProperty(canvas, 'height', { get: () => h.get.call(canvas), set: (v) => { reallocs++; h.set.call(canvas, v); }, configurable: true });
    }
    const times = [];
    await new Promise((res) => {
      let last = performance.now();
      let n = 0;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (++n < 150) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    const sorted = times.slice().sort((x, y) => x - y);
    const secs = times.reduce((s, t) => s + t, 0) / 1000;
    return {
      fps: Math.round((times.length / secs) * 10) / 10,
      medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
      p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
      canvasReallocs: reallocs,
    };
  })()`) as Promise<{ fps: number; medianMs: number; p95Ms: number; canvasReallocs: number }>;
}

async function main() {
  const list = await skus();
  if (!list.length) {
    console.error('No SKUs matched.');
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser: Browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['camera'],
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addCookies([sessionCookieFor(BASE)]);

  const results: Result[] = [];
  let perf: Awaited<ReturnType<typeof frameTimes>> | null = null;

  for (const { code, category } of list) {
    const page = await ctx.newPage();
    try {
      /* ?debug=1 turns on window.__arDebug, which is how this reads the pose, the anchor and the
         framing decision instead of inferring them from pixels. */
      await page.goto(`${BASE}/ar/${code}?debug=1`, { waitUntil: 'domcontentloaded' });
      /*
       * Getting into the live view is two clicks on some products and one on others, so try both
       * labels and then WAIT for the canvas rather than assuming a click landed. A fixed sleep
       * reported four SKUs as "no stage" that were only slower to mount.
       */
      for (const name of [/start live camera/i, /turn the camera on/i]) {
        const b = page.getByRole('button', { name }).first();
        if (await b.count()) await b.click({ timeout: 4000 }).catch(() => {});
      }
      await page.waitForSelector('canvas.ar-camera-webgl', { timeout: 30000 }).catch(() => {});
      /* And for the mesh: SceneRenderer.create awaits the whole file before there is anything to
         place, and the view says so while it does. */
      await page.waitForFunction(`!document.body.innerText.includes('Loading ')`, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await startTiltFeed(page);

      if (!(await page.locator('canvas.ar-camera-webgl').count())) {
        results.push({ sku: code, category, pitch: 0, productPx: 0, stagePx: 0, nudge: 'no-stage', ok: false });
        continue;
      }

      for (const pitch of PITCHES) {
        const tilted = await tilt(page, pitch);
        if (!tilted.ok) {
          results.push({ sku: code, category, pitch, productPx: 0, stagePx: 0, nudge: `pose did not follow: ${tilted.why}`, ok: false });
          continue;
        }
        const { productPx, stagePx } = await productPixels(page);
        /* textContent, collapsed HERE rather than inside the page: every attempt to put a
           whitespace regex into the evaluated string was mangled by one escaping layer or another,
           first silently (it stripped the letter s from every message) and then loudly. */
        const rawNudge = (await page.evaluate(`(() => { const n = document.querySelector('.arv-nudge'); return n ? n.textContent : null; })()`)) as
          | string
          | null;
        const nudge = rawNudge ? rawNudge.split(/\s+/).join(' ').trim() : null;
        /* The contract, and it is the same one the engine test asserts: you can see it, or the view
           is telling you where it went. Never neither. */
        const dbg = (await page.evaluate(
          '(() => { const d = window.__arDebug; return d ? { pitch: d.pose && Math.round(d.pose.pitchDeg), fit: d.fit && d.fit.reason, video: d.video && (d.video.W + "x" + d.video.H), anchor: d.anchor && (d.anchor.surface + " @" + Math.round(d.anchor.u) + "," + Math.round(d.anchor.v)) } : null; })()',
        )) as Debug | null;
        const ok = productPx >= MIN_PRODUCT_PX || !!nudge;
        results.push({ sku: code, category, pitch, productPx, stagePx, nudge, ok, debug: dbg });
        if (SHOTS)
          await page
            .locator('.ar-camera')
            .first()
            .screenshot({ path: path.join(OUT, `${code}-${pitch}.png`) });
      }

      if (!perf) perf = await frameTimes(page);
    } catch (e) {
      results.push({ sku: code, category, pitch: 0, productPx: 0, stagePx: 0, nudge: `error: ${(e as Error).message.slice(0, 120)}`, ok: false });
    } finally {
      await page.close();
    }
  }
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  const blank = results.filter((r) => r.productPx === 0);
  for (const r of results) {
    const pct = r.stagePx ? ((r.productPx / r.stagePx) * 100).toFixed(1) : '0.0';
    console.log(
      `  ${r.ok ? 'ok  ' : 'FAIL'} ${r.sku.padEnd(26)} pitch ${String(r.pitch).padStart(4)}  ${String(r.productPx).padStart(7)} px (${pct.padStart(5)} % of stage)${r.nudge ? `  nudge: ${r.nudge}` : ''}`,
    );
  }
  console.log(`\n${results.length} placements  ·  ${failed.length} failed  ·  ${blank.length} rendered nothing at all`);
  if (perf)
    console.log(
      `render loop: ${perf.fps} fps, median ${perf.medianMs} ms, p95 ${perf.p95Ms} ms, ${perf.canvasReallocs} drawing-buffer reallocations over 150 frames`,
    );

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, results, perf }, null, 2));
  console.log(`report: ${path.join(OUT, 'report.json')}`);
  if (STRICT && failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

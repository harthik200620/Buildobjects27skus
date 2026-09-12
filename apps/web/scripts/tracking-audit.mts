/**
 * The delivery tracker, measured against Blinkit at 100.
 *
 * Seven areas, weighted to a hundred: the map is real, the truck moves like a truck, the ETA
 * is honest and only falls, the phases arrive in order, the partner is a person you can call,
 * the layout holds on a phone, and a refresh mid-road resumes instead of restarting. Every
 * check is a measurement taken from the running page — frame gaps, per-frame displacement,
 * heading deltas, layout-shift entries — not an opinion about a screenshot.
 *
 *   pnpm --filter @buildobjects/web tracking:audit          against next start on 3001
 *
 * Probes are STRINGS (see harness.ts): tsx compiles a named inner arrow to esbuild's __name
 * helper, which the page does not have, and the store's CSP forbids the eval a string
 * predicate in waitForFunction would need — but a string handed to page.evaluate runs through
 * the devtools protocol, outside the page's policy.
 */
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { plan, snapshot } from '../lib/tracking/simulate';
import { BASE, flags, openPage } from './harness';

type Check = { area: string; name: string; weight: number; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (area: string, name: string, weight: number, ok: boolean, detail = '') => checks.push({ area, name, weight, ok, detail });

const ORDER_ID = 'BO-AUDIT1';
const LINES = "[{sku:'CEM-ULT-PPC50',name:'UltraTech PPC 50 kg',qty:12,unit:'bag'},{sku:'TIL-KAJ-GP00215',name:'Kajaria GP00215 tile',qty:4,unit:'box'}]";
/** An order at `simMin` into its trip, running at `speed`. */
const seed = (speed: number, simMin = 0) =>
  `localStorage.setItem('bo_orders', JSON.stringify([{id:'${ORDER_ID}',regionId:'hyd',placedAt:Date.now(),lines:${LINES},total:6240,coins:120,clock:{simMs:${simMin * 60000},wallMs:Date.now(),speed:${speed}}}]))`;

const STATE =
  "(function(){var tk=document.querySelector('.tk');var m=tk?tk.className.match(/tk--([a-z_]+)/):null;var eta=document.querySelector('.tk-eta-fig');" +
  "return {phase:m?m[1]:null,eta:eta?eta.textContent:(document.querySelector('.tk-eta-mark')?'Delivered':null),done:document.querySelectorAll('.tk-steps li.is-done').length," +
  "partner:!!document.querySelector('.tk-partner-name'),title:(document.querySelector('.tk-title')||{}).textContent||''," +
  "road:((document.querySelector('path.tk-road')||{}).getAttribute?document.querySelector('path.tk-road').getAttribute('d'):'').split(/[ML]/).length-1};})()";

/* 180 frames of the truck: rAF gaps, translation from the marker's matrix, rotation from the body's. */
const SAMPLE =
  "new Promise(function(done){var el=document.querySelector('.tk-truck');var body=el&&el.firstElementChild;var out={gaps:[],xy:[],deg:[]},last=0,n=0;" +
  'function step(t){if(last)out.gaps.push(t-last);last=t;var m=new DOMMatrix(getComputedStyle(el).transform);out.xy.push([m.m41,m.m42]);' +
  'var r=new DOMMatrix(getComputedStyle(body).transform);out.deg.push(Math.atan2(r.b,r.a)*180/Math.PI);if(++n<180)requestAnimationFrame(step);else done(out);}' +
  'requestAnimationFrame(step);})';

const CLS =
  "new Promise(function(done){var s=0;new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)s+=e.value;});}).observe({type:'layout-shift',buffered:true});setTimeout(function(){done(s);},800);})";

interface State {
  phase: string | null;
  eta: string | null;
  done: number;
  partner: boolean;
  title: string;
  road: number;
}
const state = (page: Page) => page.evaluate(STATE) as Promise<State>;
const etaOf = (s: State) => (s.eta && /^(\d+) min$/.exec(s.eta) ? Number(RegExp.$1) : s.eta === 'Arriving now' ? 0.5 : s.eta === 'Delivered' ? 0 : null);

async function open(page: Page, speed: number, simMin = 0, path = `/order/${ORDER_ID}`) {
  await page.context().addInitScript(seed(speed, simMin));
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] ?? 0;
const arc = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const expect = plan({ regionId: 'hyd', placedAt: Date.now() });
  try {
    /* ── 1. frozen at minute eight: the map, the partner, the layout ── */
    {
      const { page, ctx } = await openPage(browser, { viewport: 'desktop', motion: 'no-preference' });
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await open(page, 0, 8);
      await page.waitForSelector('.tk-truck', { timeout: 20_000 });
      await page.waitForFunction(() => document.querySelectorAll('img.leaflet-tile-loaded').length >= 4, null, { timeout: 20_000 }).catch(() => {});
      /*
       * TILES THAT ARE ACTUALLY MAPS.
       *
       * `leaflet-tile-loaded` only means the image decoded. CARTO's keyless tiles decode
       * perfectly and carry "API KEY REQUIRED" stamped across them — an HTTP 200 that no status
       * check can catch and that only looking at the page reveals. So the pixels are measured,
       * the way scripts/image-audit.mts measures a blank product frame: a street map is full of
       * detail, a watermark plate is nearly flat. Measured on the same tile, OSM scores a channel
       * stdev of 67 and the CARTO watermark 18, so 35 separates them with room either side.
       *
       * Fetched in Node rather than read off the canvas: cross-origin tiles taint it, and
       * getImageData on a tainted canvas throws.
       */
      const srcs = (await page.evaluate("Array.from(document.querySelectorAll('img.leaflet-tile-loaded')).map(function(i){return i.src})")) as string[];
      let stdev = 0;
      if (srcs.length) {
        const buf = Buffer.from(await (await fetch(srcs[Math.floor(srcs.length / 2)])).arrayBuffer());
        stdev = Math.max(...(await sharp(buf).stats()).channels.slice(0, 3).map((c) => c.stdev));
      }
      check('map', 'real road tiles, not a watermark plate', 6, srcs.length >= 4 && stdev >= 35, `${srcs.length} tiles · stdev ${stdev.toFixed(1)}`);
      const s = await state(page);
      /* Leaflet clips a polyline to the viewport and simplifies it, so the drawn path is always
         shorter than the 131-point leg. Ten segments is far more than a straight line and far
         less than the raw geometry — it proves a road was drawn, not a ruler. */
      check('map', 'the route is drawn as road geometry, not a straight line', 4, s.road >= 10, `${s.road} segments drawn`);
      const labels = (await page.evaluate(
        "Array.from(document.querySelectorAll('.leaflet-tooltip.tk-tip')).map(function(e){return e.textContent})",
      )) as string[];
      check('map', 'both pins carry their labels', 3, labels.includes('Kondapur yard') && labels.includes('Your site'), labels.join(' / '));
      check(
        'map',
        'OpenStreetMap is credited, as its licence requires',
        2,
        await page.evaluate("/OpenStreetMap/.test((document.querySelector('.leaflet-control-attribution')||{}).textContent||'')"),
      );

      const want = snapshot(expect, 8).etaMin;
      check('eta', 'the head shows the plan’s own minutes', 4, etaOf(s) === want, `page ${s.eta} · plan ${want} min`);
      check('eta', 'the figure reads as minutes', 2, /^\d+ min$/.test(s.eta ?? ''), s.eta ?? 'none');

      const partner = (await page.evaluate(
        "(function(){var q=function(s){return (document.querySelector(s)||{}).textContent||''};return {name:q('.tk-partner-name'),facts:q('.tk-partner-facts'),tel:(document.querySelector('.tk-partner a[href^=\"tel:\"]')||{}).getAttribute?document.querySelector('.tk-partner a[href^=\"tel:\"]').getAttribute('href'):''};})()",
      )) as { name: string; facts: string; tel: string };
      check('partner', 'a named partner', 2, partner.name.trim().length > 3, partner.name);
      check('partner', 'the phone is masked, not printed', 3, /•••/.test(partner.facts) && !/\d{10}/.test(partner.facts));
      check('partner', 'the truck has a registration', 2, /[A-Z]{2} \d{2} [A-Z]{2} \d{4}/.test(partner.facts));
      check('partner', 'Call is a real tel: link', 3, /^tel:\+91\d{10}$/.test(partner.tel), partner.tel);

      const lay = (await page.evaluate(
        "(function(){var m=document.querySelector('.tk-map').getBoundingClientRect();var f=getComputedStyle(document.querySelector('.tk-eta-fig'));return {over:document.documentElement.scrollWidth-window.innerWidth,map:m.height,fig:parseFloat(f.fontSize)};})()",
      )) as { over: number; map: number; fig: number };
      check('layout', 'desktop: nothing wider than the viewport', 2, lay.over <= 0, `${lay.over}px over`);
      check('layout', 'the ETA is the biggest thing on the page', 2, lay.fig >= 24 && lay.map >= 300, `${lay.fig}px figure, ${Math.round(lay.map)}px map`);
      const cls = (await page.evaluate(CLS)) as number;
      check('layout', 'no layout shift while the map arrives', 3, cls < 0.05, `CLS ${cls.toFixed(3)}`);
      await ctx.close();
    }

    /* ── 2. the whole trip at 40×: phases, ETA, and the truck in motion ── */
    {
      const { page, ctx } = await openPage(browser, { viewport: 'desktop', motion: 'no-preference' });
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await open(page, 40);
      await page.waitForSelector('.tk-head', { timeout: 20_000 });
      const phases: string[] = [];
      const etas: number[] = [];
      let dones = 0;
      let railOk = true;
      let partnerAt: string | null = null;
      let sample: { gaps: number[]; xy: number[][]; deg: number[] } | null = null;
      let roadBefore = 0;
      let roadAfter = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 60_000) {
        const s = await state(page);
        if (s.phase && phases.at(-1) !== s.phase) phases.push(s.phase);
        const e = etaOf(s);
        if (e !== null) etas.push(e);
        if (s.done < dones) railOk = false;
        dones = s.done;
        if (s.partner && !partnerAt) partnerAt = s.phase;
        if (s.phase === 'on_the_way' && !sample) {
          roadBefore = s.road;
          sample = (await page.evaluate(SAMPLE)) as typeof sample;
          roadAfter = (await state(page)).road;
        }
        if (s.phase === 'delivered') break;
        await page.waitForTimeout(200);
      }
      check('phases', 'six phases, in order', 8, phases.join('>') === 'confirmed>assigned>at_yard>on_the_way>arriving>delivered', phases.join(' › '));
      check('phases', 'the rail only ever advances', 4, railOk && dones === 3, `${dones} of 3 done`);
      check('phases', 'the partner appears the moment one is assigned', 3, partnerAt === 'assigned', `first seen at ${partnerAt}`);
      const falls = etas.every((e, i) => i === 0 || e <= etas[i - 1]);
      check('eta', 'the ETA never goes up', 6, falls, `${etas[0]} → ${etas.at(-1)} over ${etas.length} reads`);
      check('eta', 'it ends on Delivered', 3, phases.at(-1) === 'delivered' && etas.at(-1) === 0);

      if (sample) {
        const gaps = sample.gaps;
        const steps = sample.xy.slice(1).map(([x, y], i) => Math.hypot(x - sample.xy[i][0], y - sample.xy[i][1]));
        const turns = sample.deg.slice(1).map((d, i) => arc(sample.deg[i], d));
        const path = steps.reduce((a, b) => a + b, 0);
        /*
         * DROPPED FRAMES, NOT FRAME RATE. Headless Chromium drives rAF off a software compositor
         * that commonly ticks at 30 Hz — measured here at a median of 33.3 ms where the same
         * build in a real browser gives 16.7. An absolute "under 20 ms" threshold therefore fails
         * the harness and tells you nothing about the page. What a stuttering page actually looks
         * like is a p95 far above its own median: most frames on time, some very late. So the
         * check is consistency against whatever rate the display is running at.
         */
        check(
          'motion',
          'no dropped frames at the display’s own rate',
          6,
          p95(gaps) <= median(gaps) * 1.5 + 4,
          `median ${median(gaps).toFixed(1)}ms · p95 ${p95(gaps).toFixed(1)}ms`,
        );
        check(
          'motion',
          'no jumps: every frame moves about as far as the last',
          7,
          Math.max(...steps) <= Math.max(8, 4 * median(steps)),
          `max ${Math.max(...steps).toFixed(2)}px · median ${median(steps).toFixed(2)}px`,
        );
        check('motion', 'turns are turned, not snapped', 7, Math.max(...turns) <= 15, `max ${Math.max(...turns).toFixed(1)}° in one frame`);
        check('motion', 'it actually goes somewhere', 3, path >= 40, `${path.toFixed(0)}px over 180 frames`);
        check('motion', 'the road ahead shortens as it drives', 2, roadAfter < roadBefore, `${roadBefore} → ${roadAfter} segments`);
      } else {
        check('motion', 'the truck was seen on the way', 25, false, 'never reached on_the_way');
      }
      await ctx.close();
    }

    /* ── 3. resilience: refresh, a bad id, the speed control ── */
    {
      const { page, ctx } = await openPage(browser, { viewport: 'desktop', motion: 'no-preference' });
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await open(page, 12, 6);
      await page.waitForSelector('.tk-truck', { timeout: 20_000 });
      const before = await state(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-truck', { timeout: 20_000 });
      const after = await state(page);
      const e1 = etaOf(before) ?? -1;
      const e2 = etaOf(after) ?? -1;
      check(
        'resilience',
        'a refresh resumes mid-road instead of restarting',
        4,
        before.phase === after.phase && Math.abs(e1 - e2) <= 1,
        `${before.phase} ${e1}m → ${after.phase} ${e2}m`,
      );

      /*
       * THE TRIP DOES NOT JUMP WHEN THE CLOCK IS REBASED — measured as phase and ETA, not pixels.
       *
       * The first version of this check compared the truck's on-screen transform and reported a
       * 168px move. The truck had not moved: the CAMERA had. Changing speed can carry the trip
       * across a phase boundary, the map reframes onto the next leg, and every pixel on it
       * shifts. Screen position is the wrong instrument for a question about the simulation, so
       * this asks the simulation: the same minute of the same phase, either side of the click.
       */
      const before2 = await state(page);
      await page.click('.tk-speed');
      await page.waitForTimeout(80);
      const after2 = await state(page);
      const pill = await page.textContent('.tk-speed');
      check(
        'resilience',
        'changing the demo speed rebases the clock instead of jumping the trip',
        3,
        before2.phase === after2.phase && Math.abs((etaOf(before2) ?? -1) - (etaOf(after2) ?? -9)) <= 1 && /40×/.test(pill ?? ''),
        `${before2.phase} ${before2.eta} → ${after2.phase} ${after2.eta} · ${pill}`,
      );

      await page.goto(`${BASE}/order/NOPE`, { waitUntil: 'domcontentloaded' });
      const missing = await page.textContent('.cart-state-h').catch(() => '');
      check('resilience', 'an unknown order is a page, not a crash', 3, /can't find/.test(missing ?? ''), missing ?? '');
      await ctx.close();
    }

    /* ── 4. the phone ── */
    {
      const { page, ctx } = await openPage(browser, { viewport: 'mobile', motion: 'no-preference' });
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await open(page, 0, 8);
      await page.waitForSelector('.tk-truck', { timeout: 20_000 });
      const m = (await page.evaluate(
        "(function(){var r=function(s){var e=document.querySelector(s);return e?e.getBoundingClientRect():{top:9999,height:0}};return {over:document.documentElement.scrollWidth-window.innerWidth,eta:r('.tk-eta-fig').top,map:r('.tk-map').height,call:r('.tk-partner a').height};})()",
      )) as { over: number; eta: number; map: number; call: number };
      check(
        'layout',
        'phone: nothing wider than the screen, ETA above the fold, map tall, Call tappable',
        3,
        m.over <= 0 && m.eta < 700 && m.map >= 300 && m.call >= 44,
        `over ${m.over}px · eta y ${Math.round(m.eta)} · map ${Math.round(m.map)}px · call ${Math.round(m.call)}px`,
      );
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  /* ── the score ── */
  const areas = [...new Set(checks.map((c) => c.area))];
  for (const a of areas) {
    const cs = checks.filter((c) => c.area === a);
    const got = cs.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0);
    const max = cs.reduce((n, c) => n + c.weight, 0);
    console.log(`\n${a.toUpperCase()}  ${got}/${max}`);
    for (const c of cs) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  const score = checks.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0);
  const total = checks.reduce((n, c) => n + c.weight, 0);
  console.log(`\nconsole errors: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`);
  console.log(`\nTRACKING  ${score}/${total}  (Blinkit = 100)`);
  if (flags.strict && (score < total || errors.length)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

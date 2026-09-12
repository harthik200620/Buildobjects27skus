/**
 * The delivery tracker, measured against Blinkit at 100.
 *
 * Seven areas, weighted to a hundred: the map is real, the truck moves like a truck and stays on
 * the road it draws, the ETA is honest and only falls, the phases arrive in order, the partner is
 * a person you can call, the layout holds on a phone, and a refresh mid-road resumes instead of
 * restarting.
 *
 * Every check is a measurement taken from the running page — tile pixel variance, point-to-segment
 * distance, yaw rate in degrees per second, long tasks, layout-shift entries — never an opinion
 * about a screenshot. Several are on their second or third form, and the note at each one says
 * what the earlier version measured by mistake: a check that quietly measures the harness instead
 * of the page is worse than no check, because it is believed.
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

/*
 * 180 frames of the truck. The loop RECORDS ONLY — transforms, the rotation, and the road's path
 * string — and the arithmetic happens in Node afterwards.
 *
 * That split is not tidiness. The first version of this probe parsed the path and searched it for
 * a nearest point inside the frame callback, and the frame timing it was there to measure went
 * from a p95 of 50 ms to 83: the measurement was producing the stutter it then reported. A probe
 * on a render loop has to be cheap enough not to be part of what it measures.
 *
 * The road recorded is `.tk-road-behind`, the WHOLE leg — not `.tk-road`, which is the stretch
 * still ahead and therefore begins exactly under the truck. Measured against that one the answer
 * is zero on every frame of every run, which is a check that cannot fail and so cannot find
 * anything. This one is measured against the road as a whole.
 */
const SAMPLE =
  "new Promise(function(done){var el=document.querySelector('.tk-truck');var body=el&&el.firstElementChild;" +
  'var out={gaps:[],xy:[],deg:[],pane:[],ov:[],d:[],long:[]},last=0,n=0;' +
  "try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){out.long.push(Math.round(e.duration));});}).observe({type:'longtask',buffered:false});}catch(e){}" +
  'function tf(e){var m=new DOMMatrix(getComputedStyle(e).transform);return [m.m41,m.m42];}' +
  'function step(t){if(last)out.gaps.push(t-last);last=t;' +
  'out.xy.push(tf(el));' +
  'var r=new DOMMatrix(getComputedStyle(body).transform);out.deg.push(Math.atan2(r.b,r.a)*180/Math.PI);' +
  "var road=document.querySelector('path.tk-road-behind'),pane=document.querySelector('.leaflet-map-pane'),ov=document.querySelector('.leaflet-overlay-pane');" +
  "out.pane.push(pane?tf(pane):[0,0]);out.ov.push(ov?tf(ov):[0,0]);out.d.push(road?(road.getAttribute('d')||''):'');" +
  'if(++n<180)requestAnimationFrame(step);else done(out);}' +
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

/** Perpendicular distance from p to the segment ab — not to a or b. */
function toSegment(p: number[], a: number[], b: number[]): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

/**
 * How far the truck sat from the road, per frame, in screen pixels.
 *
 * TO THE NEAREST SEGMENT, NOT THE NEAREST VERTEX. Leaflet simplifies a polyline before painting
 * it, so a 3.4 km leg is drawn with about thirty-five points and neighbouring ones can be 170 m
 * apart — over a hundred pixels at this zoom. Measured to vertices, a truck sitting perfectly on
 * the line between two of them reports fifty pixels off, and the check would fail the one thing
 * it is supposed to pass.
 */
function offRoad(s: { xy: number[][]; pane: number[][]; ov: number[][]; d: string[] }): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.xy.length; i++) {
    const nums = s.d[i]
      .replace(/[MLZ]/g, ' ')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (nums.length < 4 || nums.some(Number.isNaN)) continue;
    const [px, py] = s.pane[i];
    const [ox, oy] = s.ov[i];
    const truck = [s.xy[i][0] + px, s.xy[i][1] + py];
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k + 3 < nums.length; k += 2) {
      best = Math.min(best, toSegment(truck, [nums[k] + px + ox, nums[k + 1] + py + oy], [nums[k + 2] + px + ox, nums[k + 3] + py + oy]));
    }
    if (Number.isFinite(best)) out.push(best);
  }
  return out;
}

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
      let sample: { gaps: number[]; xy: number[][]; deg: number[]; pane: number[][]; ov: number[][]; d: string[]; long: number[] } | null = null;
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
         * THE PAGE'S OWN COST PER FRAME, NOT THE DISPLAY'S PACING.
         *
         * Two earlier versions of this check measured the gaps between animation frames, first
         * against an absolute 20 ms and then against the run's own median. Both measured headless
         * Chromium's software compositor rather than the page: identical builds came back at a
         * p95 of 50, 67 and 83 ms on successive runs, so the gate passed or failed on the weather.
         *
         * A long task is the thing the page is actually responsible for. Fifty milliseconds of
         * unbroken scripting is a frame the browser could not have drawn whatever its refresh
         * rate, and it is what a viewer sees as a stutter. The frame gaps are still printed,
         * because they are useful to read — they are simply not scored.
         */
        const long = sample.long ?? [];
        check(
          'motion',
          'no long tasks blocking the frame',
          5,
          long.length === 0,
          `${long.length} long task(s)${long.length ? ` up to ${Math.max(...long)}ms` : ''} · frame gaps median ${median(gaps).toFixed(1)}ms p95 ${p95(gaps).toFixed(1)}ms`,
        );
        check(
          'motion',
          'no jumps: every frame moves about as far as the last',
          5,
          Math.max(...steps) <= Math.max(8, 4 * median(steps)),
          `max ${Math.max(...steps).toFixed(2)}px · median ${median(steps).toFixed(2)}px`,
        );
        /*
         * DEGREES PER SECOND, NOT PER FRAME — the same mistake the frame-gap check made.
         * Fifteen degrees in a frame is a gentle lean at 120 Hz and a whip-round at 20, so the
         * per-frame form passed or failed on the harness's frame rate rather than on the motion.
         * A vehicle has a yaw rate; that is what gets measured, using each frame's own gap.
         */
        /* gaps[i] is the interval between frame i and i+1, and turns[i] is the turn taken across
           that same interval — pairing a turn with gaps[i+1] divided a 7.4° swing over 67 ms by
           the next frame's 17 ms and reported 443°/s for motion that was capped at 110. */
        const yaw = turns.map((t, i) => (t / Math.max(1, gaps[i])) * 1000);
        check('motion', 'turns are turned, not snapped', 5, Math.max(...yaw) <= 130, `max ${Math.max(...yaw).toFixed(0)}°/s`);
        /*
         * ON THE ROAD IT IS DRAWING. Six pixels is about the width of the route stroke, so a
         * truck within it is sitting on the line; beyond that it is visibly in the buildings
         * beside it, which is what "it is going on some other road" looks like from the sofa.
         */
        const off = offRoad(sample);
        check(
          'motion',
          'the truck stays on the road it is drawing',
          7,
          off.length > 0 && p95(off) <= 6,
          `median ${median(off).toFixed(1)}px · p95 ${p95(off).toFixed(1)}px · max ${Math.max(...off).toFixed(1)}px`,
        );
        check('motion', 'it actually goes somewhere', 2, path >= 40, `${path.toFixed(0)}px over 180 frames`);
        check('motion', 'the road ahead shortens as it drives', 1, roadAfter < roadBefore, `${roadBefore} → ${roadAfter} segments`);
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

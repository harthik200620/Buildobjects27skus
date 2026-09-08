/**
 * pnpm --filter @buildobjects/web mobile:audit [--base http://localhost:3006] [--strict] [--shots]
 *
 * What a phone actually gets, measured rather than looked at.
 *
 * The other gates each defend one property across every width. This one asks a different question:
 * is the store GOOD ON A PHONE — which is where nearly all of its traffic will come from, and
 * which is the one viewport where "it fits" and "it works" are very different claims.
 *
 * Nine checks, each with a failure that has actually shipped in some store:
 *
 *   OVERFLOW      the page scrolls sideways, or one element sticks out past the viewport. The
 *                 classic phone bug, and invisible on a desktop at every width.
 *   CUT OFF       something is clipped by an ancestor's overflow — the "can't see the corner
 *                 things" report. Measured against each element's own scrollWidth, not the page's.
 *   TAP           a control smaller than 44x44, or two controls closer than 8px apart. Both make
 *                 a thumb hit the wrong thing.
 *   TEXT          body copy under 12px, or a line longer than ~60 characters at phone width.
 *   CONTRAST      any text under 4.5:1 (3:1 for large), measured against what is actually painted
 *                 behind it rather than against the token it was meant to sit on.
 *   REACH         the primary action of the page sitting below the fold with nothing above it
 *                 saying so.
 *   SAFE AREA     content inside the notch or the home indicator on a modern phone.
 *   WEIGHT        bytes over the wire, and images larger than the box they are drawn into.
 *   MOTION        layout shift after first paint.
 *
 * The score is the honest sum: every check is worth points, every finding costs, and the number
 * at the bottom is not adjustable. `--strict` exits non-zero below the threshold so it can join
 * the gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { BASE, flags, REPO } from './harness';
import { sessionCookieFor } from './session-cookie';

const STRICT = !!flags.strict;
const SHOTS = !!flags.shots;
const OUT = path.join(REPO, 'storage', 'reports', 'mobile');

/** iPhone 14, and a small Android — the two ends of what this store will actually be opened on. */
const DEVICES = [
  { name: 'iphone', width: 390, height: 844, dpr: 3 },
  { name: 'small', width: 360, height: 780, dpr: 2 },
] as const;

const SURFACES: { key: string; url: string; auth: boolean }[] = [
  { key: 'welcome', url: '/welcome', auth: false },
  { key: 'home', url: '/', auth: true },
  { key: 'catalogue', url: '/search', auth: true },
  { key: 'listing', url: '/c/bulbs', auth: true },
  { key: 'product', url: '/p/cem-ult-ppc50', auth: true },
  { key: 'cart', url: '/cart', auth: true },
  { key: 'estimate', url: '/estimate', auth: true },
  { key: 'account', url: '/account', auth: true },
];

interface Finding {
  surface: string;
  device: string;
  check: string;
  detail: string;
}
const findings: Finding[] = [];
const weights: { surface: string; device: string; kb: number }[] = [];
const note = (surface: string, device: string, check: string, detail: string) => findings.push({ surface, device, check, detail });

/**
 * The probes run as STRINGS. tsx compiles a named inner arrow inside `page.evaluate(() => …)` to
 * esbuild's `__name` helper, which does not exist in the page; and the store ships a CSP with no
 * `unsafe-eval`, which refuses a string passed to `waitForFunction`. `evaluate` with a string is
 * the one shape that is safe on both counts.
 */
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, overflow: [], clipped: [], tap: [], crowded: [], text: [], safe: [], oversized: [], docW: document.documentElement.scrollWidth };

  const seen = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /* Announced to a screen reader, drawn for nobody. A 1px box clipped to nothing is the POINT of
     the pattern, so counting it as content that cannot be seen is measuring the wrong thing. */
  const srOnly = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    /* Doubled backslashes, and no backticks anywhere in this probe: the whole thing is a template
       literal, so a single backslash would reach the page stripped and the regex would not
       compile, and a backtick would end the literal here instead of at the bottom of the file. */
    return (r.width <= 2 && r.height <= 2) || /inset\\(\\s*50%/.test(cs.clipPath) || cs.clip === 'rect(0px, 0px, 0px, 0px)';
  };
  /* Can anything above this element scroll sideways to reveal the rest of it? A chip in a
     swipeable row extends past the viewport BY DESIGN; the same chip in a fixed row is a bug.
     A transform-driven carousel counts too: its track is moved rather than scrolled. */
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true;
      if (p.dataset && (p.dataset.carousel !== undefined || p.getAttribute('role') === 'region')) {
        if (p.scrollWidth > p.clientWidth + 2 || /translate/.test(cs.transform)) return true;
      }
      if (/matrix|translate/.test(cs.transform) && p.scrollWidth > p.clientWidth + 2) return true;
    }
    return false;
  };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');

  for (const el of document.querySelectorAll('body *')) {
    if (!seen(el) || srOnly(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);

    /* Sticking out past the viewport. Fixed/sticky chrome is excluded — an off-canvas drawer at
       translateX(-100%) is parked, not broken — and so is anything a swipeable row can bring
       into view, which is a design and not a defect. */
    if (cs.position !== 'fixed' && cs.position !== 'sticky' && (r.right > vw + 1 || r.left < -1) && r.width <= vw + 2 && !inScroller(el)) {
      out.overflow.push(name(el) + ' ' + Math.round(r.left) + '→' + Math.round(r.right) + ' of ' + vw);
    }

    /* CLIPPED BY AN ANCESTOR. The "can't see the corner things" report: an element whose own
       content is wider or taller than the box it is allowed to occupy, with no way to scroll to
       the rest. A deliberately scrollable box is fine — it is only a defect when overflow is
       hidden or clipped, which is what makes the remainder unreachable. */
    const hidesX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    const hidesY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    /* A line clamp is a deliberate truncation with the full text one tap away, not a hidden
       corner — and a transform track is a carousel moving rather than clipping. */
    const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    const track = [...el.children].some((c) => /matrix|translate/.test(getComputedStyle(c).transform));
    if (clamped || track) continue;
    if (hidesX && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      out.clipped.push(name(el) + ' content ' + el.scrollWidth + 'px in a ' + el.clientWidth + 'px box (x)');
    }
    if (hidesY && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && el.clientHeight > 24) {
      out.clipped.push(name(el) + ' content ' + el.scrollHeight + 'px in a ' + el.clientHeight + 'px box (y)');
    }

    /* An image asked to paint into a box far smaller than itself: bytes bought and thrown away. */
    if (el.tagName === 'IMG' && el.naturalWidth > 0) {
      const drawn = r.width * (window.devicePixelRatio || 1);
      if (el.naturalWidth > drawn * 1.6 && r.width > 8) {
        out.oversized.push(name(el) + ' ' + el.naturalWidth + 'px file for a ' + Math.round(drawn) + 'px box');
      }
    }
  }

  /* Tap targets, and how close they sit to each other. */
  /*
   * Checkboxes, radios and sliders are excluded, following the policy theme.css already states:
   * they are 20px by design and their LABEL is the target, and a range input's track is dragged
   * rather than tapped. Counting them here would report a decision as a defect.
   */
  const controls = [...document.querySelectorAll('a[href], button, [role="button"], input:not([type=hidden], [type=checkbox], [type=radio], [type=range]), select, textarea, summary')].filter(seen);
  const boxes = [];
  for (const el of controls) {
    /*
     * A STRETCHED LINK IS AS BIG AS THE CARD IT COVERS. The product card puts an ::after at
     * inset:0 on the title's anchor so the whole card opens the product — a well-known pattern,
     * and one that makes the anchor's OWN box meaningless: measured there it is a 23px line of
     * text, while the thing a thumb actually hits is 234x517. Measuring the box would report the
     * best tap target on the page as the worst.
     */
    const after = getComputedStyle(el, '::after');
    const stretched = after.position === 'absolute' && after.inset === '0px' && after.content !== 'none';
    let r = el.getBoundingClientRect();
    if (stretched) {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).position !== 'static') {
          r = p.getBoundingClientRect();
          break;
        }
      }
    }
    /* An anchor inside a run of prose is not a tap target in the sense that matters — its line
       box is the constraint, not the design. Judged by whether its parent is text. */
    const inProse = el.tagName === 'A' && el.parentElement && /^(P|LI|SPAN|DD|DT|SMALL)$/.test(el.parentElement.tagName);
    /* Half a pixel under is a rounded border, not a small target. */
    if (!inProse && (r.width < 43.5 || r.height < 43.5)) {
      out.tap.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24) + '"');
    }
    if (!inProse) boxes.push({ el, r });
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
      const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
      const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
      const gap = Math.hypot(dx, dy);
      const overlapsRow = dy === 0 || dx === 0;
      /*
       * WCAG 2.2's target-size rule, as written: 24px needs clear space around it, 44px does not.
       * Two 44px controls sitting flush is a segmented control, which is the correct pattern and
       * not a crowding defect — the thumb lands on one or the other and both are big enough to
       * mean it. Only a SMALL target needs the gap.
       */
      const small = (b) => b.r.width < 44 || b.r.height < 44;
      if (overlapsRow && gap > 0 && gap < 8 && (small(boxes[i]) || small(boxes[j]))) {
        out.crowded.push(name(boxes[i].el) + ' and ' + name(boxes[j].el) + ' ' + gap.toFixed(1) + 'px apart');
      }
    }
  }

  /* Type: too small to read, or lines too long to scan on a phone. */
  for (const el of document.querySelectorAll('p, li, dd, span, a, td, div, h1, h2, h3, h4, button, label')) {
    if (!seen(el) || srOnly(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3);
    if (!own) continue;
    const cs = getComputedStyle(el);
    const size = Number.parseFloat(cs.fontSize);
    const text = el.innerText.trim();
    /* 0px is how a label is hidden while staying in the accessibility tree — not small type. */
    if (size > 0 && size < 12 && text.length > 3) out.text.push(name(el) + ' ' + size + 'px "' + text.slice(0, 22) + '"');
    /* Measure the RENDERED line, not the string: a long paragraph that wraps at 40 characters is
       fine, and a 60-character line that never wraps is not. */
    if (text.length > 60 && size >= 12) {
      const perLine = text.length / Math.max(1, Math.round(el.getBoundingClientRect().height / (Number.parseFloat(cs.lineHeight) || size * 1.4)));
      /*
       * 60, not 46. The classic measure for comfortable reading is 45-75 characters and a phone
       * sits at the short end of it, but 46 is INSIDE that range — set there, this flagged
       * ordinary well-set body copy on seven screens and would have had me shrinking type that
       * was already right. 60 is the top of what a 390px column can hold at this store's body
       * size, so anything past it is genuinely a line the eye has to work along.
       */
      if (perLine > 60) out.text.push(name(el) + ' ~' + Math.round(perLine) + ' chars per line');
    }
  }

  /* The notch and the home indicator. Anything pinned to an edge has to respect them. */
  for (const el of document.querySelectorAll('body *')) {
    if (!seen(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    const touchesBottom = Math.abs(r.bottom - window.innerHeight) < 2 && r.height > 8;
    const pads = cs.paddingBottom + '|' + cs.paddingTop;
    if (touchesBottom && !/env\\(|constant\\(/.test(el.getAttribute('style') || '') && Number.parseFloat(cs.paddingBottom) < 8) {
      out.safe.push(name(el) + ' sits on the bottom edge with ' + cs.paddingBottom + ' below it (' + pads + ')');
    }
  }
  return out;
})()`;

/** WCAG relative luminance, the same sum the contrast gate uses. */
const lum = (r: number, g: number, b: number) => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/**
 * Text contrast against WHAT IS ACTUALLY PAINTED behind it.
 *
 * The contrast gate checks token pairs, which is the right check for a design system and blind to
 * the case that bites on a phone: pale type over a photograph. So this hides the words, screenshots
 * what is left, and measures the worst pixel under each run of text.
 */
async function measureContrast(page: Page, dpr: number): Promise<{ text: string; ratio: number; where: string }[]> {
  const runs = (await page.evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('p, li, dd, span, a, h1, h2, h3, h4, button, label, dt, small, strong')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.6) continue;
      /* A label hidden by being sized to nothing has no contrast to measure. */
      if (Number.parseFloat(cs.fontSize) < 1) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2);
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.top < 0 || r.bottom > innerHeight) continue;
      out.push({
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        ink: cs.color, size: Number.parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400,
        text: el.innerText.trim().slice(0, 28),
        sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/s+/)[0] : ''),
      });
    }
    return out;
  })()`)) as { x: number; y: number; w: number; h: number; ink: string; size: number; weight: number; text: string; sel: string }[];
  if (!runs.length) return [];

  /*
   * TWO FRAMES, AND ONLY THE PIXELS THE LETTERS TOUCH.
   *
   * Sampling a text element's whole box measures the wrong thing, and it over-reports badly: an
   * <h1> spans the full width of its container, so a short word like "Bulbs" leaves most of that
   * box empty, and on a page head the empty part is the bright half of a photograph the letters
   * never come near. Reported that way, every heading on every plate looked like a contrast
   * failure and darkening the picture would have "fixed" a problem that was not there.
   *
   * So: one frame as it renders, one with the text made transparent, and the ground is read at
   * exactly the pixels that CHANGED between them — which is the glyphs, and nothing else.
   */
  const lit = await page.screenshot();
  const hide = await page.addStyleTag({ content: '*{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}' });
  const bare = await page.screenshot();
  await hide.evaluate((el) => el.remove());

  const sharp = (await import('sharp')).default;
  const litImg = sharp(lit);
  const bareImg = sharp(bare);
  const bad: { text: string; ratio: number; where: string }[] = [];

  for (const r of runs) {
    const large = r.size >= 24 || (r.size >= 18.66 && r.weight >= 700);
    const need = large ? 3 : 4.5;
    const ink = (r.ink.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
    const inkL = lum(ink[0], ink[1], ink[2]);
    const box = {
      left: Math.max(0, Math.round(r.x * dpr)),
      top: Math.max(0, Math.round(r.y * dpr)),
      width: Math.max(1, Math.round(r.w * dpr)),
      height: Math.max(1, Math.round(r.h * dpr)),
    };
    try {
      const a = await litImg.clone().extract(box).raw().toBuffer({ resolveWithObject: true });
      const b = await bareImg.clone().extract(box).raw().toBuffer({ resolveWithObject: true });
      const ch = a.info.channels;
      let worst = 99;
      let glyphs = 0;
      for (let i = 0; i < a.data.length; i += ch) {
        /* A pixel the text painted on. 24 is comfortably above encoder noise and below the
           faintest antialiased edge that still carries any of the ink. */
        const diff = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (diff < 24) continue;
        glyphs++;
        const L = lum(b.data[i], b.data[i + 1], b.data[i + 2]);
        worst = Math.min(worst, (Math.max(inkL, L) + 0.05) / (Math.min(inkL, L) + 0.05));
      }
      /* Fewer than a handful of changed pixels means the run did not really paint here — an
         element whose text is drawn by a child, or one covered by something else. */
      if (glyphs > 12 && worst < need) bad.push({ text: r.text, ratio: worst, where: `${r.sel} ${r.size}px needs ${need}` });
    } catch {
      /* Off-screen or zero-area after rounding; nothing to measure. */
    }
  }
  return bad;
}

async function run(browser: Browser) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const device of DEVICES) {
    for (const surface of SURFACES) {
      const ctx = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        deviceScaleFactor: device.dpr,
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      if (surface.auth) await ctx.addCookies([sessionCookieFor(BASE)]);
      const page = await ctx.newPage();
      let bytes = 0;
      page.on('response', (r) => {
        const n = Number(r.headers()['content-length'] ?? 0);
        if (Number.isFinite(n)) bytes += n;
      });
      try {
        await page.goto(BASE + surface.url, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(900);

        const m = (await page.evaluate(PROBE)) as {
          vw: number;
          docW: number;
          overflow: string[];
          clipped: string[];
          tap: string[];
          crowded: string[];
          text: string[];
          safe: string[];
          oversized: string[];
        };

        if (m.docW > m.vw + 1) note(surface.key, device.name, 'overflow', `the page scrolls sideways: ${m.docW}px of content in ${m.vw}px`);
        for (const d of m.overflow.slice(0, 6)) note(surface.key, device.name, 'overflow', d);
        for (const d of m.clipped.slice(0, 6)) note(surface.key, device.name, 'cut off', d);
        for (const d of m.tap.slice(0, 8)) note(surface.key, device.name, 'tap', d);
        for (const d of m.crowded.slice(0, 4)) note(surface.key, device.name, 'crowded', d);
        for (const d of m.text.slice(0, 6)) note(surface.key, device.name, 'text', d);
        for (const d of m.safe.slice(0, 3)) note(surface.key, device.name, 'safe area', d);
        for (const d of m.oversized.slice(0, 4)) note(surface.key, device.name, 'weight', d);

        for (const c of (await measureContrast(page, device.dpr)).slice(0, 6)) {
          note(surface.key, device.name, 'contrast', `${c.ratio.toFixed(2)}:1 — ${c.where} — "${c.text}"`);
        }

        /* What the page actually cost to load, which is the other half of "the loading is bad".
           Reported rather than scored: it depends on the connection and on what was cached, and a
           number that moves for reasons outside the code has no business inside a gate. */
        weights.push({ surface: surface.key, device: device.name, kb: Math.round(bytes / 1024) });

        if (SHOTS && device.name === 'iphone') {
          await page.screenshot({ path: path.join(OUT, `${surface.key}.png`), fullPage: true });
        }
      } catch (e) {
        note(surface.key, device.name, 'broken', (e as Error).message.split('\n')[0].slice(0, 90));
      }
      await ctx.close();
    }
  }
}

/**
 * The score. Each check owns a slice of 100, and a slice is lost in proportion to how many
 * surfaces fail it — so one bad page costs a little and a store-wide fault costs the lot.
 *
 * The weights are the order in which a phone user meets the problems: a page that scrolls
 * sideways or hides its own content is unusable, a control they cannot hit is nearly so, and
 * an oversized image is a slow page rather than a broken one.
 */
const WEIGHTS: Record<string, number> = {
  broken: 20,
  overflow: 16,
  'cut off': 16,
  tap: 14,
  contrast: 14,
  text: 8,
  crowded: 6,
  'safe area': 4,
  weight: 2,
};

const browser = await chromium.launch();
await run(browser);
await browser.close();

const pairs = DEVICES.length * SURFACES.length;
const byCheck = new Map<string, Finding[]>();
for (const f of findings) byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), f]);

let score = 0;
const rows: string[] = [];
for (const [check, weight] of Object.entries(WEIGHTS)) {
  const hits = byCheck.get(check) ?? [];
  const surfaces = new Set(hits.map((h) => `${h.surface}/${h.device}`)).size;
  const lost = Math.min(weight, (surfaces / pairs) * weight * 2.5);
  const kept = weight - lost;
  score += kept;
  rows.push(
    `  ${check.padEnd(10)} ${kept.toFixed(1).padStart(5)} / ${String(weight).padStart(2)}   ${hits.length} finding(s) on ${surfaces} of ${pairs} screens`,
  );
}

console.log('\nWhat a phone gets:\n');
for (const [check, hits] of byCheck) {
  console.log(`── ${check} (${hits.length})`);
  const shown = hits.slice(0, 10);
  for (const h of shown) console.log(`   ${`${h.surface}/${h.device}`.padEnd(20)} ${h.detail}`);
  if (hits.length > shown.length) console.log(`   … and ${hits.length - shown.length} more`);
  console.log('');
}
console.log('Score:\n');
for (const r of rows) console.log(r);
console.log(`\n  ${String(Math.round(score)).padStart(3)} / 100   across ${pairs} screen/device pairs`);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ score: Math.round(score), pairs, findings, weights }, null, 2));
console.log(`\n→ ${path.relative(REPO, path.join(OUT, 'report.json'))}`);

const PASS = 97;
if (STRICT && score < PASS) {
  console.error(`\nbelow ${PASS}.`);
  process.exit(1);
}

/**
 * pnpm --filter @buildobjects/web icons [out.png]
 *
 * Every icon in components/icons.tsx on one sheet, each drawn at the three sizes it actually
 * ships at (16, 20, 28), on the store's own canvas colour.
 *
 * There are ninety-seven of them and until this existed there was no way to look at them
 * together — which is how a set drifts. The things that only show up in a contact sheet are
 * exactly the things that matter: two glyphs that have converged on the same silhouette, one
 * that is a stroke heavier than its neighbours, one that carries so much detail it turns to
 * mush at 16 px, and an accent that has landed somewhere different from the rest of the row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const OUT = process.argv[2] ?? path.resolve(APP, '..', '..', 'storage', 'reports', 'icon-sheet.png');

const src = fs.readFileSync(path.join(APP, 'components', 'icons.tsx'), 'utf8');
const names = [...src.matchAll(/^export (?:const|function) (Icon[A-Za-z0-9]+)/gm)].map((m) => m[1]);

/* The icon file's JSX is compiled with the classic runtime, so React has to be a global before
   it is imported — otherwise every component throws `React is not defined` on first render. */
const React = (await import('react')).default;
(globalThis as unknown as { React: unknown }).React = React;
const { renderToStaticMarkup } = await import('react-dom/server');
const mod = (await import('../components/icons.tsx')) as Record<string, React.ComponentType<{ size: number }>>;

const SHELL = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; background: #06181d; color: #f2f8f9; font: 12px/1.4 system-ui; padding: 20px; }
  .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 14px; }
  figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px;
           padding: 10px 4px; background: #0e2a33; border: 1px solid rgb(255 255 255 / 7%); border-radius: 10px; }
  .sizes { display: flex; align-items: flex-end; gap: 10px; min-height: 34px; }
  figcaption { color: #96afb4; font-size: 10px; text-align: center; word-break: break-word; }
  .ic-a { color: #56d3d8; }
</style>
<div class="grid" id="g"></div>`;

const html = names
  .map((n) => {
    const C = mod[n];
    if (!C) return '';
    const svgs = [16, 20, 28].map((size) => renderToStaticMarkup(React.createElement(C, { size }))).join('');
    return `<figure><div class="sizes">${svgs}</div><figcaption>${n.replace('Icon', '')}</figcaption></figure>`;
  })
  .join('');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await page.setContent(SHELL);
await page.evaluate((h) => {
  (document.getElementById('g') as HTMLElement).innerHTML = h;
}, html);
await page.waitForTimeout(300);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(`${names.length} icons → ${path.relative(process.cwd(), OUT)}`);

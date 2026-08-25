/**
 * The welcome illustration — a drawn skyline for the sign-in screen, in the store's own line
 * vocabulary. Patina tokens only. Re-runnable.
 *   pnpm --filter @buildobjects/pipeline media:generate
 *
 * Category tiles used to be generated here too, from a per-category blueprint motif drawn for
 * a dark ground. `pnpm pipeline art:categories` owns them now and builds each one from the
 * best real photograph in the category, so this file no longer writes `categoryHeroKey` —
 * two generators producing the same key is a drift waiting to happen.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { REPO_ROOT } from '../config';

function welcomeSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
  <defs>
    <radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#0e3a47"/><stop offset="1" stop-color="#04141a"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#5ce1e6" stroke-opacity=".08" stroke-width="1"/></pattern>
  </defs>
  <rect width="1200" height="600" fill="url(#g)"/><rect width="1200" height="600" fill="url(#grid)"/>
  <g fill="none" stroke="#5ce1e6" stroke-opacity=".8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M120 470h960"/><path d="M220 470V250l160-90 160 90v220"/><path d="M380 470V330h80v140"/><path d="M540 470V210l200-110 200 110v260"/><path d="M640 470V320h60v150M800 470V320h60v150"/>
    <path d="M980 470V300l60-34 60 34v170"/><rect x="1010" y="360" width="50" height="60"/><path d="M120 520h960" stroke-dasharray="10 14" stroke-opacity=".5"/>
    <circle cx="880" cy="150" r="34" stroke-opacity=".5"/><path d="M880 92v20M880 188v20M822 150h20M918 150h20" stroke-opacity=".5"/>
  </g>
</svg>`;
}

async function main() {
  const pub = path.join(REPO_ROOT, 'apps', 'web', 'public', 'img');
  fs.mkdirSync(pub, { recursive: true });
  await sharp(Buffer.from(welcomeSvg())).webp({ quality: 80 }).toFile(path.join(pub, 'welcome-art.webp'));
  console.log('  welcome art → apps/web/public/img/welcome-art.webp');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

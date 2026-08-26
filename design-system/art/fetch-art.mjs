/**
 * Downloads the generated cinematic backplates into this folder.
 *
 * They were generated with nano-banana-pro at 2K and live on a CDN the build
 * sandbox could not reach, so they are fetched here rather than committed.
 * Run once:  node design-system/art/fetch-art.mjs
 *
 * LOOK AT EACH ONE before you ship it. They were generated but never reviewed.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://d8j0ntlcm91z4.cloudfront.net/user_39eQlKaHxYNVVhyh821jPqdH2fq';
const STAMP = 'hf_20260826_051233';

/** name → generation id. 16:9 unless noted. */
const ART = {
  'site-materials':  'deedcf31-33e0-4fe3-8c81-d013f20b558d', // cement + rebar, golden hour
  'catalogue-aisle': '731e1c6a-660e-4808-b10a-2b79185bb49c', // dark warehouse aisle
  'construct-frame': 'e5bb941d-8edf-409e-a660-22549c6f21ee', // RCC frame under construction
  'blueprint-field': 'f6ba0966-4307-414c-8552-8761688cc154', // tileable drafting field, 1:1
  'coins-field':     '23d04a10-52aa-4158-9840-5299da00d62d', // amber dial field
  'bo-coin-hero':    'c0e44242-8b06-4b1a-b444-6327580d8c56', // coin, three-quarter, 1:1
  'bo-coin-edge':    'e09b821f-e774-4231-ba5b-59aabf2c9547', // coin, edge-on, 1:1
};

/* Not generated — the account ran out of credits mid-batch. The artboards draw
   these sections in CSS and SVG instead, which is why they still look finished.
   Regenerate with the prompts in ART_PROMPTS.md if you want photographs. */
const MISSING = ['home-hero (21:9)', 'pdp-stage', 'cart-yard', 'interior-warm', 'estimator-iso'];

for (const [name, id] of Object.entries(ART)) {
  const url = `${BASE}/${STAMP}_${id}.png`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`✗ ${name}: HTTP ${res.status}`); continue; }
  await writeFile(join(HERE, `${name}.png`), Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${name}.png`);
}
console.log(`\nNot generated: ${MISSING.join(', ')} — see ART_PROMPTS.md`);

/**
 * Cut the type families down to the glyphs this store actually sets.
 *
 * The faces ship as Google's full releases — 1,515 and 1,214 glyphs across Latin, Greek, Cyrillic
 * and Vietnamese — which measured 408 KB of webfont on the home page, 54% of the document, to
 * render a store written in English.
 *
 * It derives the coverage rather than guessing: every character the app can put on screen, from
 * the source, the catalogue JSON and the registry, unioned with the ranges below. Deliberately
 * generous — the derived set is a floor, so a product name arriving tomorrow with an i-diaeresis
 * still renders. What it drops is Greek, Cyrillic, Vietnamese and several hundred symbols.
 *
 * Originals are kept under assets/fonts-full/, so the cut can be widened and redone rather than
 * re-downloaded. Needs Python with fontTools and brotli; it says so and exits 0 without them, so
 * a machine that lacks them can still build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const fontsDir = join(web, 'public', 'fonts');
/*
 * The originals live OUTSIDE public/. They were briefly kept in public/fonts/full, which meant
 * 450 KB of full-coverage faces were being copied into the deployment and served on a public URL
 * to nobody — the subsets beside them are what the app actually links. They are build inputs, so
 * they belong with the other build inputs.
 */
const fullDir = resolve(web, 'assets', 'fonts-full');

/**
 * Ranges kept whole, whatever the scan finds. Anything outside them that the app can put on screen
 * still survives — the scan's character list is passed alongside.
 *
 * U+0000-00FF   ASCII and Latin-1, including the multiplication sign at U+00D7 that dimensions use
 * U+0100-017F   Latin Extended-A, for the rest of Europe's accents in brand names
 * U+0300-036F   combining marks — without these a decomposed e-acute loses its accent entirely
 * U+2000-206F   general punctuation: the dashes, the real quotes, the ellipsis, and the middle dot
 *               the whole catalogue separates specifications with
 * U+20A0-20BF   currency, here for exactly one glyph: the rupee at U+20B9
 *
 * NOT kept: Greek, Cyrillic, Vietnamese, the arrow and mathematical blocks (every arrow in the
 * store is a drawn icon), and box drawing, which appears only inside source comments.
 */
const KEEP_RANGES = ['U+0000-00FF', 'U+0100-017F', 'U+0300-036F', 'U+2000-206F', 'U+20A0-20BF'].join(',');

/**
 * The OpenType features to keep.
 *
 * `*` keeps every table the face ships, which on Arimo means the Greek and Cyrillic positioning
 * rules survive a subset that dropped their glyphs. These six are the ones the store's own CSS
 * asks for: kerning, standard and contextual ligatures, the tabular and lining figures every
 * price and specification is set in, and the mark-attachment tables that make U+0300-036F work.
 */
/**
 * Faces that carry a script of their own, and must NOT be given the app-wide character set.
 *
 * The Telugu face sets exactly two words, on one screen, after sign-in. Cut with everybody else it
 * came out at 45.6 KB, because the app-wide set is almost entirely Latin and the ranges above are
 * kept whatever the scan finds — so it was carrying a second, unused copy of the alphabet the
 * other four faces already draw better. Its own block and the two Indic joiners are the whole job:
 * the block rather than just the glyphs in `lib/greeting.ts`, so that adding a city tomorrow is a
 * line of data and not a silently missing conjunct.
 *
 * U+0C00-0C7F   Telugu
 * U+200C-200D   zero-width non-joiner and joiner, which Indic shaping needs and which are
 *               invisible in a source file — easy to drop, and impossible to notice until a
 *               conjunct renders as two letters
 */
const OWN_SCRIPT: Record<string, string> = {
  /*
   * U+0020 and U+00A0 are in here because the greeting is two words. Without the space the
   * browser falls back for it — a different face, a different advance — and the line measured
   * three pixels wider than the same string in the untouched font, which is the sort of thing
   * nobody sees and everybody feels. U+25CC is the dotted circle a shaper draws around an
   * orphaned mark; if it is ever needed the alternative is a missing-glyph box.
   */
  'BuildObjectsTelugu-Variable.woff2': 'U+0020,U+00A0,U+0C00-0C7F,U+200C-200D,U+25CC',
};

/**
 * AND THEY KEEP EVERY LAYOUT FEATURE, which is not a nicety.
 *
 * KEEP_FEATURES below is a Latin list, and a Latin list applied to Telugu produced a font with no
 * GSUB and no GPOS at all — every one of `akhn blwf blws haln rphf abvs psts` and the mark tables
 * gone. Those are not decoration in an Indic script, they are how it is written: `akhn` and `blwf`
 * are what turn స + ◌్ + క into the conjunct స్క, and without them the browser draws the pieces
 * side by side with a visible halant, which is not a spelling of the word. It shipped that way and
 * was reported as "the Telugu is broken", correctly.
 *
 * `*` on a face cut to a hundred glyphs costs almost nothing and cannot be wrong the way a list
 * can. lib/greeting.test.ts asserts the tables survive.
 */

const KEEP_FEATURES = ['kern', 'liga', 'clig', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'tnum', 'lnum'].join(',');

/** Where user-visible text can come from. Everything here is scanned character by character. */
const SCAN_DIRS = [
  join(web, 'app'),
  join(web, 'components'),
  join(web, 'lib'),
  join(web, 'data'),
  resolve(web, '..', '..', 'packages', 'catalog', 'src'),
  resolve(web, '..', '..', 'packages', 'estimator', 'src'),
  resolve(web, '..', '..', 'services', 'pipeline', 'registry'),
];
const SCAN_EXT = new Set(['.ts', '.tsx', '.json', '.css', '.md']);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (SCAN_EXT.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

function derivedCharacters(): string {
  const seen = new Set<string>();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const ch of text) if (ch.codePointAt(0)! > 31) seen.add(ch);
    }
  }
  return [...seen].join('');
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

function python(): string | null {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      execFileSync(cmd, ['-c', 'import fontTools, brotli'], { stdio: 'ignore' });
      return cmd;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const py = python();
if (!py) {
  console.log('font subsetting skipped: needs Python with fontTools and brotli (pip install fonttools brotli)');
  process.exit(0);
}

/* The originals are the source of truth. Once they are safely aside, the working copies in
   public/fonts can be replaced as often as the coverage needs widening. */
mkdirSync(fullDir, { recursive: true });
const faces = readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));
for (const face of faces) {
  const original = join(fullDir, face);
  if (!existsSync(original)) writeFileSync(original, readFileSync(join(fontsDir, face)));
}

const chars = derivedCharacters();
const charFile = join(fullDir, '.characters.txt');
writeFileSync(charFile, chars, 'utf8');
console.log(`scanned the app: ${chars.length} distinct characters in use`);

let before = 0;
let after = 0;
for (const face of faces) {
  const source = join(fullDir, face);
  const target = join(fontsDir, face);
  const wasBytes = statSync(source).size;
  const own = OWN_SCRIPT[face];
  execFileSync(
    py,
    [
      '-m',
      'fontTools.subset',
      source,
      `--unicodes=${own ?? KEEP_RANGES}`,
      /* A face with a script of its own takes the range and nothing else; passing the app's
         character list as well would hand it back the Latin the range deliberately leaves out. */
      ...(own ? [] : [`--text-file=${charFile}`]),
      `--layout-features=${own ? '*' : KEEP_FEATURES}`,
      '--flavor=woff2',
      '--notdef-outline',
      `--output-file=${target}`,
    ],
    { stdio: 'inherit' },
  );
  const nowBytes = statSync(target).size;
  before += wasBytes;
  after += nowBytes;
  console.log(`  ${face.padEnd(34)} ${kb(wasBytes).padStart(9)} → ${kb(nowBytes).padStart(9)}  (−${Math.round((1 - nowBytes / wasBytes) * 100)}%)`);
}

console.log(`\nwebfont payload ${kb(before)} → ${kb(after)}  (−${kb(before - after)}, ${Math.round((1 - after / before) * 100)}% smaller)`);
console.log(`originals kept in ${fullDir}`);

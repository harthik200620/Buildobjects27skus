/**
 * Fetch the upstream type releases this store subsets from.
 *
 * `subset-fonts.mts` cuts the faces down to the glyphs the app actually sets and reads its inputs
 * from `assets/fonts-full/`. Those inputs used to arrive by hand, which meant the four faces in the
 * repository had no recorded provenance, no version, and no way to be widened or replaced without
 * somebody remembering where they came from.
 *
 * This is that record, executable: each face is pulled from the Google Fonts repository at a pinned
 * path, converted from the release TTF to woff2 with fontTools, and written into `assets/fonts-full/`
 * under the store's own generic name. The generic names matter — the app links `BuildObjectsSans3`,
 * not `Schibsted Grotesk`, so replacing the UI face is a change to this file and the licence note
 * rather than a rename across forty stylesheets.
 *
 * Run it when a face changes, then `fonts:subset`, which is what writes `public/fonts`. Neither is
 * part of `next build`; both are deliberate, occasional acts.
 *
 *   pnpm --filter @buildobjects/web fonts:fetch
 *   pnpm --filter @buildobjects/web fonts:subset
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const fullDir = resolve(web, 'assets', 'fonts-full');
const tmpDir = join(fullDir, '.download');

const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl/';

/**
 * The type programme. Four faces, four jobs.
 *
 * Display 1 and Sans 3 are new. Display 2 (Audiowide) and Sans 5 (Encode Sans) are already in the
 * repository and are NOT re-fetched — Encode Sans in particular carries a true ₹ and correct
 * tabular figures, and its cut here is known good.
 *
 * Sans 3 is a single variable file rather than four static cuts. Arimo, which it replaces, shipped
 * as four separate weights; a variable face covers 400–800 continuously in one request, which is
 * three fewer round trips on first paint and lets a control ask for 550 if it ever needs to.
 */
interface Face {
  /** The name the app links, without extension. */
  out: string;
  /** Path under google/fonts/ofl/. */
  from: string;
  /** Licence file beside it. */
  licence: string;
  /** What it actually is, for the licence note. */
  family: string;
  role: string;
}

const FACES: Face[] = [
  {
    out: 'BuildObjectsDisplay1-Regular',
    from: 'instrumentserif/InstrumentSerif-Regular.ttf',
    licence: 'instrumentserif/OFL.txt',
    family: 'Instrument Serif',
    role: 'Display 1 — headlines and section titles',
  },
  {
    out: 'BuildObjectsDisplay1-Italic',
    from: 'instrumentserif/InstrumentSerif-Italic.ttf',
    licence: 'instrumentserif/OFL.txt',
    family: 'Instrument Serif Italic',
    role: 'Display 1 italic — emphasis inside a headline',
  },
  {
    out: 'BuildObjectsSans3-Variable',
    from: 'schibstedgrotesk/SchibstedGrotesk[wght].ttf',
    licence: 'schibstedgrotesk/OFL.txt',
    family: 'Schibsted Grotesk (variable, 400–800)',
    role: 'Sans 3 — every control, label, body and nav',
  },
];

function python(): string {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      execFileSync(cmd, ['-c', 'import fontTools, brotli'], { stdio: 'ignore' });
      return cmd;
    } catch {
      /* try the next one */
    }
  }
  console.error('needs Python with fontTools and brotli (pip install fonttools brotli)');
  process.exit(1);
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const py = python();
mkdirSync(fullDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const notes: string[] = [];

for (const face of FACES) {
  /* encodeURI leaves the [wght] brackets alone, which is what the raw host expects. */
  const url = RAW + face.from.replace('[', '%5B').replace(']', '%5D');
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`  ${face.out}: ${response.status} fetching ${url}`);
    process.exit(1);
  }
  const ttf = join(tmpDir, `${face.out}.ttf`);
  writeFileSync(ttf, Buffer.from(await response.arrayBuffer()));

  /*
   * TTF → woff2, with nothing dropped. This is a format conversion and not a subset: the cut
   * happens in subset-fonts.mts, which derives its character set from the app and would have no
   * way to widen the coverage again if it had already been narrowed here.
   */
  const target = join(fullDir, `${face.out}.woff2`);
  execFileSync(py, ['-m', 'fontTools.subset', ttf, '--unicodes=*', '--layout-features=*', '--glyph-names', '--flavor=woff2', `--output-file=${target}`], {
    stdio: 'inherit',
  });

  console.log(`  ${face.out.padEnd(30)} ${kb(statSync(ttf).size).padStart(9)} ttf → ${kb(statSync(target).size).padStart(9)} woff2   ${face.family}`);
  notes.push(`${face.out}.woff2\n  ${face.family}\n  ${face.role}\n  SIL Open Font License 1.1 — google/fonts/ofl/${face.from.split('/')[0]}`);
}

rmSync(tmpDir, { recursive: true, force: true });

/*
 * The licence text lives beside the served files, because that is where anyone looking for it
 * will look. Each family's own OFL comes down with the face — a licence that has to be fetched
 * separately by hand is a licence that eventually is not.
 */
const licenceDir = join(web, 'public', 'fonts', 'LICENSES');
mkdirSync(licenceDir, { recursive: true });
const seenLicences = new Set<string>();
for (const face of FACES) {
  const family = face.from.split('/')[0];
  if (seenLicences.has(family)) continue;
  seenLicences.add(family);
  const response = await fetch(RAW + face.licence);
  if (!response.ok) {
    console.error(`  licence for ${family}: ${response.status}`);
    process.exit(1);
  }
  const name = `OFL-${face.family.split(' ')[0]}${face.family.includes('Grotesk') ? 'Grotesk' : 'Serif'}.txt`;
  writeFileSync(join(licenceDir, name), await response.text(), 'utf8');
  console.log(`  licence ${name}`);
}

/* The provenance note. Only the block this script owns is rewritten; anything a human wrote
   above the marker survives. */
const sourcesPath = join(licenceDir, 'SOURCES.md');
const existing = existsSync(sourcesPath) ? readFileSync(sourcesPath, 'utf8') : '';
const marker = '<!-- fetch-fonts.mts owns everything below this line -->';
const kept = existing.split(marker)[0].trimEnd();
writeFileSync(sourcesPath, `${kept}\n\n${marker}\n\n${notes.join('\n\n')}\n`, 'utf8');

console.log(`\n${FACES.length} faces written to ${fullDir}`);
console.log('now run: pnpm --filter @buildobjects/web fonts:subset');

/**
 * Stage the media the storefront serves into `public/`, so a CDN can serve it.
 *
 * The store reads product photographs from `storage/media` and 3D models from `assets/3d` through
 * two route handlers that hit the filesystem. That works anywhere the repository is on disk — a
 * laptop, a container, Render — and it does not work on Vercel: a serverless function only ships
 * the files Next can trace, a dynamic `fs.readFile` traces nothing, and the bundle is capped at
 * 250 MB anyway. So every image and every model 404'd in production while the pages around them
 * rendered perfectly.
 *
 * Copying them into `public/` before the build moves them out of the function and onto the CDN,
 * where files of this size belong. The route handlers stay as the fallback for anything not staged.
 *
 * What ships is a subset, on purpose:
 *   · every rendition the storefront can request — card, thumb, gallery, zoom, cut-outs, in webp
 *     and avif — plus category art, brand marks, the estimator's house renders and the brochures;
 *   · not the originals (`*-orig.jpg|png|webp`, 71 MB), which the pipeline keeps so it can
 *     re-derive renditions and which no page has ever asked for;
 *   · not `.stale`, `.bak` or `meshy-input` files, which are working notes.
 *
 * Hard links where the filesystem allows them, so staging costs no disk and no time on a rebuild.
 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, '..', '..', '..');
const PUBLIC = path.resolve(HERE, '..', 'public');

/** Working files the pipeline leaves behind, and the originals it keeps to re-derive from. */
const SKIP = [/-orig\.(jpe?g|png|webp)$/i, /\.(stale|bak|tmp)$/i, /meshy-input/i];

interface Job {
  from: string;
  to: string;
  label: string;
  /** `null` means take the whole tree. */
  pick?: (rel: string) => boolean;
}

const JOBS: Job[] = [
  { from: path.join(REPO, 'storage', 'media'), to: path.join(PUBLIC, 'media'), label: 'media' },
  {
    from: path.join(REPO, 'assets', '3d'),
    to: path.join(PUBLIC, '3d'),
    label: '3d',
    /* Only the delivered models and the manifest. `photoreal/` holds what the provider returned
       before normalisation — 724 MB that nothing reads back. */
    pick: (rel) => !rel.includes('/') && (rel.endsWith('.glb') || rel === 'manifest.json'),
  },
];

function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else if (entry.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

/** A hard link is free; a copy is the fallback for filesystems and volumes that refuse one. */
function place(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
}

let staged = 0;
let bytes = 0;
let unchanged = 0;
let removed = 0;

for (const job of JOBS) {
  const wanted = walk(job.from).filter((rel) => !SKIP.some((re) => re.test(rel)) && (job.pick?.(rel) ?? true));
  const want = new Set(wanted);

  for (const rel of wanted) {
    const from = path.join(job.from, rel);
    const to = path.join(job.to, rel);
    const src = fs.statSync(from);
    /* Same size and no older than the source means the staged copy is already right. */
    const dst = fs.existsSync(to) ? fs.statSync(to) : null;
    if (dst && dst.size === src.size && dst.mtimeMs >= src.mtimeMs) {
      unchanged++;
      continue;
    }
    if (dst) fs.rmSync(to);
    place(from, to);
    staged++;
    bytes += src.size;
  }

  /* Anything staged by an earlier run that the source no longer has would otherwise be served
     forever — a deleted photograph that stays live is worse than a missing one. */
  for (const rel of walk(job.to)) {
    if (want.has(rel)) continue;
    fs.rmSync(path.join(job.to, rel));
    removed++;
  }

  const total = wanted.reduce((n, rel) => n + fs.statSync(path.join(job.from, rel)).size, 0);
  process.stdout.write(`  ${job.label.padEnd(6)} ${String(wanted.length).padStart(5)} files  ${(total / 1048576).toFixed(1).padStart(7)} MB\n`);
}

process.stdout.write(`staged ${staged} file(s), ${(bytes / 1048576).toFixed(1)} MB · ${unchanged} already current${removed ? ` · ${removed} removed` : ''}\n`);

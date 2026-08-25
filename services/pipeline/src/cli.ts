#!/usr/bin/env tsx
/**
 * pnpm pipeline <command> [flags]
 *   registry                      parse the calendar sheet + seed categories/brands/registries
 *   run [--category c] [--sku CODE] [--stage s1,s2] [--resume] [--driver auto|bullmq|local] [--concurrency n]
 *   derive [--category c] [--sku CODE]   rebuild read-models + Meilisearch + filters (scoped or everything)
 *   facets                        recompute filter_configs only
 *   report                        print the latest coverage report
 *   sheet                         show the calendar sheet's heading system
 *   validate                      validate every curated file against the contract
 */
import { closeDb } from '@buildobjects/db';
import { buildAllFacets } from './facets/build';
import { generateCategoryArt } from './media/category-art';
import { printResourceSummary, resourceImages } from './media/resource-images';
import { listCurated } from './providers';
import { sheetReport } from './registry/from-sheet';
import { seedRegistry } from './registry/seed';
import { coverageRows, printCoverage } from './report';
import { deriveAll, runPipeline } from './run';

function flags(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) {
        out[k] = v;
        i++;
      } else out[k] = true;
    }
  }
  return out;
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const t0 = Date.now();
  switch (cmd) {
    case 'registry': {
      console.log('registry: reading the specification workbook…');
      await seedRegistry();
      break;
    }
    case 'run': {
      await runPipeline({
        category: f.category as string | undefined,
        sku: f.sku as string | undefined,
        stage: f.stage as string | undefined,
        resume: !!f.resume,
        driver: f.driver as 'auto' | 'bullmq' | 'local' | undefined,
        concurrency: f.concurrency ? Number(f.concurrency) : undefined,
      });
      break;
    }
    case 'derive':
      await deriveAll(console.log, { category: f.category as string | undefined, sku: f.sku as string | undefined });
      break;
    case 'images:resource': {
      console.log('re-sourcing photographs from each brand’s own product page…');
      const reports = await resourceImages(console.log, {
        sku: f.sku as string | undefined,
        category: f.category as string | undefined,
        write: !!f.write,
      });
      console.log(`\n${printResourceSummary(reports)}`);
      if (!f.write) console.log('\nnothing written — pass --write to update the curated files');
      break;
    }
    case 'art:categories':
      await generateCategoryArt(console.log);
      break;
    case 'facets':
      await buildAllFacets(console.log);
      break;
    case 'report':
      console.log(printCoverage(await coverageRows()));
      break;
    case 'sheet':
      for (const l of sheetReport()) console.log(`  ${l}`);
      break;
    case 'validate': {
      const all = listCurated();
      console.log(`${all.length} valid curated files: ${all.map((c) => c.sku_code).join(', ')}`);
      break;
    }
    default:
      console.log(
        'usage: pnpm pipeline <registry|run|derive|facets|report|sheet|validate|images:resource|art:categories> [--category c] [--sku CODE] [--stage fetch,extract,…] [--resume] [--write] [--driver auto|bullmq|local] [--concurrency 6]',
      );
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await closeDb();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});

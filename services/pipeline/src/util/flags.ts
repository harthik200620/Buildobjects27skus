import { parseArgs } from 'node:util';

/**
 * The flags every generator tool in here takes, read once.
 *
 * `--only a,b` picks the slugs to work on, `--force` overwrites what is already on disk, and
 * `--sheet` writes a contact sheet to look at afterwards. Three tools wanted the same three, and
 * each had its own `parseArgs` call spelling them out — which is how `--only` came to mean a
 * comma-separated list in two of them and a single slug in the third for a while.
 *
 * `strict: false` because these are run by hand and an unrecognised flag should be ignored rather
 * than kill a job that costs money to restart.
 */
export function toolFlags(): { only: string[]; force: boolean; sheet: boolean } {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: false,
    options: { only: { type: 'string' }, force: { type: 'boolean' }, sheet: { type: 'boolean' } },
  });
  return {
    only: String(values.only ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    force: !!values.force,
    sheet: !!values.sheet,
  };
}

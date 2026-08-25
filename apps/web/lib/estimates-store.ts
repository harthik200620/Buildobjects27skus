import 'server-only';
import { randomBytes } from 'node:crypto';
import { estimates, getDb, num } from '@buildobjects/db';
import { type EstimateInputs, type EstimateResult, estimate, normalizeInputs } from '@buildobjects/estimator';
import { eq } from 'drizzle-orm';
import { loadCalculatorCatalog } from './estimator';
import { ensurePgSchema, getPg, hasPg, pgEstimates } from './pg-store';

/**
 * What a saved estimate keeps: the inputs (re-runnable — `inputs.adjustments` travel here, via
 * `normalizeInputs`) and a summary of the outputs (auditable — `outputs.adjustments` records how
 * many were applied and which were ignored). `/estimate?e=<id>` re-hydrates the calculator from
 * the inputs, so accepted AI suggestions and manual overrides survive a reload / share.
 */
export type SavedOutputs = Pick<
  EstimateResult,
  'version' | 'derived' | 'ledgers' | 'grandTotal' | 'perSqft' | 'groups' | 'phases' | 'tiers' | 'accuracy' | 'storeLinks' | 'needsVerification' | 'adjustments'
> & { lines: EstimateResult['lines'] };

export async function saveEstimate(rawInputs: unknown): Promise<{ id: string; grandTotal: number; tier: string; city: string }> {
  const inputs = normalizeInputs(rawInputs as Partial<EstimateInputs>);
  const catalog = await loadCalculatorCatalog(inputs.picks?.map((p) => p.sku_code) ?? []);
  const r = estimate(inputs, catalog);
  const outputs: SavedOutputs = {
    version: r.version,
    derived: r.derived,
    ledgers: r.ledgers,
    grandTotal: r.grandTotal,
    perSqft: r.perSqft,
    groups: r.groups,
    phases: r.phases,
    tiers: r.tiers,
    accuracy: r.accuracy,
    storeLinks: r.storeLinks,
    needsVerification: r.needsVerification,
    adjustments: r.adjustments,
    lines: r.lines,
  };
  const id = randomBytes(6).toString('base64url');
  const row = { publicId: id, inputs, outputs, tier: inputs.tier, city: inputs.city, grandTotal: String(r.grandTotal) };
  try {
    if (hasPg()) {
      await ensurePgSchema();
      await getPg().insert(pgEstimates).values(row);
    } else {
      await getDb().insert(estimates).values(row);
    }
  } catch {
    /*
     * No database: the estimate is still fully described by its own URL.
     *
     * `inputsToQuery` round-trips every input, so a shared link reproduces the estimate exactly
     * without a stored row — what is lost is the short id, not the estimate. Failing the whole
     * save because there is nowhere to write a convenience copy would be the wrong trade.
     */
  }
  return { id, grandTotal: r.grandTotal, tier: inputs.tier, city: inputs.city };
}

export async function loadSavedEstimate(
  publicId: string,
): Promise<{ id: string; inputs: EstimateInputs; outputs: SavedOutputs; grandTotal: number | null; createdAt: Date } | null> {
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(publicId)) return null;
  try {
    const [row] = hasPg()
      ? await (async () => {
          await ensurePgSchema();
          return getPg().select().from(pgEstimates).where(eq(pgEstimates.publicId, publicId)).limit(1);
        })()
      : await getDb().select().from(estimates).where(eq(estimates.publicId, publicId)).limit(1);
    if (!row) return null;
    // Rows saved before the v2 engine carry no outputs.adjustments — backfill an empty record.
    const outputs: SavedOutputs = Object.assign({ adjustments: { applied: 0, ignored: [] } }, row.outputs as SavedOutputs);
    return {
      id: row.publicId,
      inputs: normalizeInputs(row.inputs as Partial<EstimateInputs>),
      outputs,
      grandTotal: num(row.grandTotal),
      createdAt: row.createdAt,
    };
  } catch {
    return null;
  }
}

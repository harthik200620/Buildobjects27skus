/**
 * `pnpm assets:3d:photoreal --assist services/pipeline/tools/photoreal-assist.mts`
 *
 * The vision assist the photoreal runner has always had a seam for and never had an
 * implementation of. Every model in `assets/3d/manifest.json` built by a provider carries the
 * same note — `judge skipped — no vision assist wired (@buildobjects/llm judgeModelMatch)` — and
 * that is not a missing feature, it is the reason a cardboard carton shipped as the 3D model of a
 * bulb. Nothing ever compared the render with the photograph.
 *
 * `@buildobjects/llm` does implement `judgeModelMatch`, and it speaks only to Gemini, which this
 * account cannot reach (`429 RESOURCE_EXHAUSTED — prepayment credits depleted`). So the judge
 * here runs the same comparison against Claude through BO_CHAT_BASE_URL.
 *
 * Only `judge` is wired. Segmentation stays with the providers, which remove backgrounds
 * themselves and do it well; a cut-out step that guesses would take quality away, not add it.
 *
 * The runner rejects anything scoring below `JUDGE_MIN` (0.6) and retries with another provider,
 * so a bad reconstruction now costs a retry instead of shipping.
 */
import { loadEnv } from '@buildobjects/db';
import { hasVision, judgeModelMatch } from '../src/media/vision';

loadEnv();

if (!hasVision()) throw new Error('photoreal-assist: no vision key — set BO_CHAT_API_KEY (or ANTHROPIC_API_KEY) in .env');

export const assist = {
  async judge(hero: Buffer, preview: Buffer, ctx: { sku: string; name: string; brand: string; category: string }) {
    const m = await judgeModelMatch(hero, preview, { sku: ctx.sku, brand: ctx.brand, name: ctx.name, category: ctx.category });
    return {
      overall: m.overall,
      defects: m.defects,
      same_product: m.same_product,
      silhouette: m.silhouette,
      colour: m.colour,
      branding: m.branding,
    };
  },
};

export default assist;

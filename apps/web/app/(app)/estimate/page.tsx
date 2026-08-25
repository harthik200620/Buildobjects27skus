import { DEFAULT_INPUTS, type EstimateInputs, inputsFromQuery, RATES_VERSION } from '@buildobjects/estimator';
import type { Metadata } from 'next';
import Calculator from '@/components/estimate/Calculator';
import { loadSavedEstimate } from '@/lib/estimates-store';
import { loadCalculatorCatalog } from '@/lib/estimator';

type Search = Record<string, string | string[] | undefined>;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'BO Cost Calculator — Build Objects',
  description:
    'BO house-construction cost estimate for any city in Andhra Pradesh and Telangana — structure and interiors ledgered separately, at three quality tiers, priced from the store.',
};

export default async function EstimatePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const shareId = typeof sp.e === 'string' ? sp.e : null;
  let initial: EstimateInputs = DEFAULT_INPUTS;
  let resolvedShare: string | null = null;
  if (shareId) {
    const saved = await loadSavedEstimate(shareId);
    if (saved) {
      initial = saved.inputs;
      resolvedShare = saved.id;
    }
  } else {
    const fromQuery = inputsFromQuery(sp);
    if (fromQuery) initial = fromQuery;
  }
  const catalog = await loadCalculatorCatalog(initial.picks?.map((p) => p.sku_code) ?? []);

  return (
    <div className="page shell">
      <header className="page-head">
        <p className="kicker">BO Intelligence · Andhra Pradesh & Telangana</p>
        <h1 className="display page-title">BO House Construction Cost Calculator</h1>
        <p className="page-sub max-w-[64ch]">
          Plan your construction budget with confidence in three simple steps: your city, plot dimensions, and quality tier. Civil structure and interior
          finishes are calculated with transparent material-labour splits, with cement, steel, tiles, lighting, and solar verified against live BO market rates
          (Rate Card v{RATES_VERSION}).
        </p>
      </header>
      <Calculator initialInputs={initial} catalog={catalog} shareId={resolvedShare} />
    </div>
  );
}

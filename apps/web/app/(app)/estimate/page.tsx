import { DEFAULT_INPUTS, type EstimateInputs, inputsFromQuery, RATES_VERSION } from '@buildobjects/estimator';
import type { Metadata } from 'next';
import Estimator from '@/components/estimate/Estimator';
import { loadSavedEstimate } from '@/lib/estimates-store';
import { loadCalculatorCatalog } from '@/lib/estimator';

type Search = Record<string, string | string[] | undefined>;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'What will my house cost?',
  description:
    'See what your house will cost to build — answer three simple questions and get a full material and labour estimate at today\u2019s rates, priced from the store.',
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
        {/*
         * The line under the heading used to run to fifty-five words and claimed rates "verified
         * against live BO market rates". They are not verified: several of the prices this page
         * builds on carry `price_provenance: 'estimated'`, and the product pages say so on the
         * price itself. A summary line that quietly upgrades "estimated" to "verified" is the
         * store contradicting its own product pages, on the page where the number matters most.
         */}
        <p className="kicker">Plan your build</p>
        <h1 className="display page-title">What will your house cost?</h1>
        <p className="page-sub estimate-lede">
          Three questions — where you are building, how big, and how it should be finished — and this returns the whole bill: civil and interior, material and
          labour, split stage by stage. Cement, steel, tiles, lighting and solar are priced from the same catalogue the rest of the store sells from, so the
          figure moves when the shelf does.
        </p>
        <p className="estimate-rates">
          Rate card <span className="fig">v{RATES_VERSION}</span> · every line shows whether its price was read from the brand or estimated for the class
        </p>
      </header>
      <Estimator initialInputs={initial} catalog={catalog} shareId={resolvedShare} />
    </div>
  );
}

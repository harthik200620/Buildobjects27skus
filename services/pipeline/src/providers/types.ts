import type { AttributeValue, CuratedSku, Registry } from '@buildobjects/catalog';

export interface SkuContext {
  skuCode: string;
  category: string;
  brand: string;
  productName: string;
  variant: string;
  officialUrl: string;
}

/** The largest datasheet captured by `stageFetch` — sent inline to the extraction model when small enough. */
export interface PdfFile {
  path: string;
  url: string;
  bytes: number;
  pages: number;
}

export interface ExtractInput extends SkuContext {
  registry: Registry;
  pageText: string;
  pdfText: string;
  sourceUrl: string;
  pdfUrl: string | null;
  pdfFile?: PdfFile | null;
}
export interface VerifyInput extends SkuContext {
  registry: Registry;
  values: Record<string, AttributeValue>;
  secondaryText: string;
  secondaryUrl: string /** Official hosts — a citation on one of these is never the independent second source. */;
  officialDomains?: string[];
}
export interface FillInput extends SkuContext {
  registry: Registry;
  values: Record<string, AttributeValue>;
}
export interface DescribeInput extends SkuContext {
  registry: Registry;
  values: Record<string, AttributeValue>;
}

/** What the price stage hands the provider: the selling unit and the curated reading it must never invent past. */
export interface PriceInput extends SkuContext {
  unit: string;
  packQty: number;
  modelNo: string | null;
  curated: CuratedSku['price'];
  officialDomains: string[];
}

/**
 * One web price reading. `provenance: 'fetched'` is only ever set after the citation resolved to a
 * concrete URL, the page was downloaded independently and the rupee figure was found in its text
 * within ±1 %; everything else is `estimated` with the reason in `note`.
 */
export interface PriceReading {
  mrp: number | null;
  selling_price: number | null;
  source_url: string | null;
  quote: string | null;
  seller: string | null;
  observed_date: string | null;
  confidence: number;
  provenance: 'fetched' | 'estimated';
  note: string;
  /** Grounding URLs the model cited (already resolved to final URLs), for the audit trail. */
  citations: string[];
}

export interface CanonicalizeInput extends SkuContext {
  registry: Registry;
  /** key → the long residual string normalize.ts could not shorten by rule. */
  residual: Record<string, string>;
}
/** key → short canonical value (≤ 40 chars) and the reasoning note that becomes AttributeValue.note. */
export type CanonicalizeResult = Record<string, { value: string; note: string }>;

export interface Copy {
  short_description: string;
  long_description: string;
  key_specs: string[];
  seo: { title?: string; meta_description?: string; keywords: string[]; keywords_te: string[]; keywords_hi: string[] };
}

/**
 * The LLM seam. `gemini` = the live provider (packages/llm: grounded verify / price, strict-JSON
 * extraction, Gemini judge + masks); `anthropic` = the earlier Claude tool-use provider; `curated` =
 * the fixture provider (services/pipeline/data/curated) used whenever no key is present. All obey
 * the provenance law; none may invent certificate numbers or prices. `price` and `canonicalize` are
 * optional — stages skip them honestly when the provider has none.
 */
export interface LlmProvider {
  readonly name: 'gemini' | 'anthropic' | 'curated';
  extract(input: ExtractInput): Promise<Record<string, AttributeValue>>;
  verify(input: VerifyInput): Promise<{ values: Record<string, AttributeValue>; conflicts: { key: string; official: unknown; secondary: unknown }[] }>;
  fill(input: FillInput): Promise<Record<string, AttributeValue>>;
  describe(input: DescribeInput): Promise<Copy>;
  /** Grounded web price check; null = the provider cannot check prices (curated). */
  price?(input: PriceInput): Promise<PriceReading | null>;
  /** Shorten residual long strings to facet tokens; never truncates, never invents. */
  canonicalize?(input: CanonicalizeInput): Promise<CanonicalizeResult>;
  /** The curated fixture for a SKU, if one exists (live mode uses it as the secondary source). */
  curated(skuCode: string): CuratedSku | null;
}

/** Keys that must never be AI-filled: licence / certificate / test-report identifiers. */
export const NEVER_FILL = /(licen[cs]e|certificate_no|cert_no|cm_l|report_no|registration_no|test_report|bis_no|isi_no|almm_no|crs_no)/i;

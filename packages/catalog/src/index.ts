/**
 * @buildobjects/catalog — the shared vocabulary of the store.
 *
 * Every package speaks these types: the registry (what an attribute IS), the
 * curated/extracted SKU shape (what the pipeline produces), the read-model a
 * PDP renders from, and the facet tree the PLP renders from. Zod schemas are the
 * single source of validation for data files and LLM tool-use output alike.
 */

export * from './ar';
export * from './facets';
export * from './media';
export * from './num';
export * from './registry';
export * from './search';
export * from './sku';

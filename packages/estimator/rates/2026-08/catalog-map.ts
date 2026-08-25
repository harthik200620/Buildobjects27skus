/**
 * Tier → store SKU mapping. The store and the calculator share one price truth: when the mapped
 * SKU is in the catalogue snapshot the calculator uses its live selling price (provenance shown
 * on the line); otherwise the seed rate applies and the line says so.
 *
 * A category may name explicit codes, or resolve by price rank inside the category (cheapest =
 * basic, middle = medium, dearest = premium) — that is how a category ingested after this file
 * was written still maps with zero edits.
 */
import type { Tier } from '../../src/types';

export interface CatalogMapEntry {
  category: string;
  codes?: Partial<Record<Tier, string>>;
  resolve: 'codes_then_rank' | 'rank';
}

export const CATALOG_MAP: Record<'cement' | 'tiles' | 'bulbs' | 'solar' | 'fire' | 'epoxy' | 'cctv' | 'glass', CatalogMapEntry> = {
  cement: { category: 'cement', codes: { basic: 'CEM-ACC-SP50', medium: 'CEM-AMB-PLUS50', premium: 'CEM-ULT-PPC50' }, resolve: 'codes_then_rank' },
  tiles: {
    category: 'tiles',
    codes: { basic: 'TIL-JOH-YK1FLCR000000PJ', medium: 'TIL-SOM-T31F119001859102', premium: 'TIL-KAJ-GP00215' },
    resolve: 'codes_then_rank',
  },
  bulbs: {
    category: 'bulbs',
    codes: { basic: 'BUL-WIP-GARNET9WB22', medium: 'BUL-HAV-LEDPLUS9WB22', premium: 'BUL-PHI-ACESAVER9WB22' },
    resolve: 'codes_then_rank',
  },
  solar: {
    category: 'solar-panels',
    codes: { basic: 'SOL-WAA-BI55-545', medium: 'SOL-VIK-PARADEA-550', premium: 'SOL-ADA-ASB-M10-144-575' },
    resolve: 'codes_then_rank',
  },
  fire: {
    category: 'fire-extinguishers',
    codes: { basic: 'FIR-SAF-ABC-SP-6KG', medium: 'FIR-CEA-MAP90-4KG', premium: 'FIR-CEA-MAP90-4KG' },
    resolve: 'codes_then_rank',
  },
  epoxy: {
    category: 'epoxy',
    codes: { basic: 'EPX-PID-EPOXYINJGROUT', medium: 'EPX-FOS-CONBEXTRAEP10', premium: 'EPX-SIK-SIKADUR31IN' },
    resolve: 'codes_then_rank',
  },
  cctv: { category: 'cctv', resolve: 'rank' },
  glass: { category: 'glass', resolve: 'rank' },
};

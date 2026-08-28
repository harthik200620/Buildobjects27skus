import { z } from 'zod';

/**
 * The headings a specification can sit under. A category uses the subset that applies to
 * it and states the order itself, in registry/spec-groups.json — a bulb leads with light
 * output, cement with strength, a total station with measurement accuracy.
 *
 * This replaced twenty headings applied uniformly to every category, which put "Wattage"
 * and "Lumens" under Product identity, "Inrush current" under Flow specifications, and gave
 * a light bulb a Pressure section.
 */
export const GROUP_KEYS = [
  'product_identity',
  'light_output',
  'electrical',
  'optical',
  'imaging',
  'measurement',
  'acoustic',
  'thermal',
  'strength',
  'surface',
  'physical',
  'chemical',
  'composition',
  'manufacturing',
  'dimensions',
  'durability',
  'cure',
  'pressure',
  'performance',
  'environmental',
  'application',
  'standards',
  'quality_control',
  'appearance',
  'installation',
  'packaging',
  'commercial',
  'warranty',
] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const DATA_TYPES = ['text', 'number', 'boolean', 'enum'] as const;
export type DataType = (typeof DATA_TYPES)[number];
export const FILTER_WIDGETS = ['checkbox', 'range', 'toggle', 'chips'] as const;
export type FilterWidget = (typeof FILTER_WIDGETS)[number];

export const AttributeDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'snake_case key'),
  group: z.enum(GROUP_KEYS),
  label: z.string().min(1).max(120),
  data_type: z.enum(DATA_TYPES),
  unit: z.string().max(24).nullable().optional(),
  enum_values: z.array(z.string()).optional(),
  is_filterable: z.boolean().default(false),
  filter_widget: z.enum(FILTER_WIDGETS).optional(),
  filter_order: z.number().int().optional(),
  importance_rank: z.number().int().min(1).max(5).default(3),
  show_in_key_specs: z.boolean().default(false),
  show_on_card: z.boolean().default(false),
  compare: z.boolean().default(false),
  synonyms: z.array(z.string()).default([]),
  display_order: z.number().int().default(0),
});
export type AttributeDef = z.infer<typeof AttributeDefSchema>;

export const RegistrySchema = z.object({
  category: z.string(),
  version: z.number().int().default(1),
  attributes: z.array(AttributeDefSchema).min(1),
});
export type Registry = z.infer<typeof RegistrySchema>;

export const GroupDefSchema = z.object({
  key: z.enum(GROUP_KEYS),
  label: z.string(),
  display_order: z.number().int(),
  /** 1 = the section a buyer opens the sheet for; 5 = the section they scroll past. Derived from position. */
  importance: z.number().int(),
});
export type GroupDef = z.infer<typeof GroupDefSchema>;

export const BrandSeedSchema = z.object({
  slug: z.string(),
  code: z.string().length(3),
  name: z.string(),
  domain: z.string(),
});
export const CategorySeedSchema = z.object({
  slug: z.string(),
  code: z.string().length(3),
  name: z.string(),
  name_te: z.string().optional(),
  name_hi: z.string().optional(),
  icon: z.string(),
  display_order: z.number().int(),
  unit: z.string(),
  gst_rate: z.number(),
  brands: z.array(BrandSeedSchema),
});
/** Default widget for a data type when the registry does not say. */
export function defaultWidget(t: DataType): FilterWidget {
  return t === 'number' ? 'range' : t === 'boolean' ? 'toggle' : 'checkbox';
}

/**
 * The thirteen departments the thirty-seven categories hang under, in nav order.
 *
 * A department is the first level of the storefront tree and the pairing the specification
 * workbook already used in column A: Electrical Items → Bulbs, Surveying Equipment → Total
 * Stations. Categories carry the key; this is the only place the name and the order live, so
 * the nav, the sidebar and the homepage cannot drift from each other.
 * `services/pipeline/registry/taxonomy.json` is validated against these keys at seed time.
 */
/**
 * THE THIRTY-FIVE CATEGORIES, and the nine products that sit inside them.
 *
 * The source is `Desktop/Build Objects/PRODUCTS LIST.xlsx` — one sheet per category, in this
 * order. Cement is not a category: CONCRETING is, and cement is a product in it. The same is true
 * of every flagship the store sells today.
 *
 *     CONCRETING          Cement          the gap file's own index reads
 *                                         "CEMENT, LIME, GYPSUM & BINDER GRADES -> CONCRETING"
 *     FLOORING            Tiles           22 tile rows on that sheet; it is the subject
 *     DOORS & WINDOWS     Glass           20 glass rows; "DOORS, WINDOWS, GLASS & ARCHITECTURAL"
 *     ELECTRICALS         Bulbs           "Bulbs", "LED Bulbs"
 *     SECURITY SYSTEMS    CCTV            the sheet's subject; ELECTRICALS lists only its cables
 *     SOLAR               Solar Panels    "Solar panels"
 *     FIRE SYSTEM         Fire Exting'rs  "Fire Extinguishers"
 *     DRAFTING & MEAS.    Total Stations  "Total Stations"; other sheets list it as a tool
 *     WATER PROOFING      Epoxy           the construction-chemicals sheet — admixtures, bonding
 *                                         agents, injection grouts. A judgement call: epoxy grout
 *                                         also appears under FLOORING and RAILINGS.
 *
 * Twenty-six of the thirty-five have no products yet. They are still real, clickable places —
 * an upcoming category is a promise the buyer can see, not a dead link.
 */
export const CATEGORIES = [
  { slug: 'safety-equipment', name: 'Safety Tools & Equipment' },
  { slug: 'excavation', name: 'Excavation' },
  { slug: 'centering', name: 'Centering' },
  { slug: 'steel', name: 'Steel' },
  { slug: 'concreting', name: 'Concreting' },
  { slug: 'bricks-and-blocks', name: 'Bricks & Blocks' },
  { slug: 'doors-windows', name: 'Doors & Windows' },
  { slug: 'flooring', name: 'Flooring' },
  { slug: 'painting', name: 'Painting' },
  { slug: 'electricals', name: 'Electricals' },
  { slug: 'roofing', name: 'Roofing' },
  { slug: 'plumbing', name: 'Plumbing' },
  { slug: 'hvac-materials', name: 'HVAC Materials' },
  { slug: 'fire-system', name: 'Fire System' },
  { slug: 'railings', name: 'Railings' },
  { slug: 'internal-works', name: 'Internal Works' },
  { slug: 'kitchen-ware', name: 'Kitchen Ware' },
  { slug: 'waterproofing', name: 'Water Proofing' },
  { slug: 'security-systems', name: 'Security Systems' },
  { slug: 'solar', name: 'Solar' },
  { slug: 'lift-elevators', name: 'Lift Elevators' },
  { slug: 'external-works', name: 'External Works' },
  { slug: 'heavy-equipment', name: 'Heavy Construction Equipment' },
  { slug: 'transport-systems', name: 'Transport Systems' },
  { slug: 'machineries', name: 'Machineries' },
  { slug: 'branding', name: 'Company Identity & Branding' },
  { slug: 'administration', name: 'Administration Items' },
  { slug: 'stationery', name: 'Stationery Items' },
  { slug: 'paper-sheet', name: 'Paper & Sheet Items' },
  { slug: 'electronic-printing', name: 'Electronic & Printing Items' },
  { slug: 'communication-furniture', name: 'Communication & Furniture Items' },
  { slug: 'drafting-measurement', name: 'Drafting & Measurement Items' },
  { slug: 'finance-accounting', name: 'Finance & Accounting Items' },
  { slug: 'storage-packaging', name: 'Storage & Packaging Items' },
  { slug: 'presentation', name: 'Presentation Items' },
] as const;

/**
 * Product slug -> the category it belongs to.
 *
 * Only the nine the store stocks are here. Every other row in the `categories` table IS one of
 * the thirty-five, and needs no entry.
 */
export const PRODUCT_CATEGORY: Record<string, string> = {
  cement: 'concreting',
  tiles: 'flooring',
  glass: 'doors-windows',
  bulbs: 'electricals',
  cctv: 'security-systems',
  'solar-panels': 'solar',
  'fire-extinguishers': 'fire-system',
  'total-stations': 'drafting-measurement',
  epoxy: 'waterproofing',
};

/** The category a row belongs to: itself when it is a category, its parent when it is a product. */
export function categoryOf(slug: string): string {
  return PRODUCT_CATEGORY[slug] ?? slug;
}

export function categoryName(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}

/** True when the slug names a product the store sells rather than a category it sells within. */
export function isProduct(slug: string): boolean {
  return slug in PRODUCT_CATEGORY;
}

export const DEPARTMENTS = [
  { key: 'construction-materials', name: 'Construction Materials' },
  { key: 'building-materials', name: 'Building Materials' },
  { key: 'construction-chemicals', name: 'Construction Chemicals' },
  { key: 'electrical-items', name: 'Electrical Items' },
  { key: 'solar-energy', name: 'Solar & Energy' },
  { key: 'cctv-security', name: 'CCTV & Security' },
  { key: 'safety-fire', name: 'Safety & Fire' },
  { key: 'surveying-equipment', name: 'Surveying Equipment' },
  { key: 'site-structure', name: 'Site & Structure' },
  { key: 'mep-services', name: 'Plumbing, HVAC & Lifts' },
  { key: 'site-machinery', name: 'Plant & Machinery' },
  { key: 'external-works', name: 'External Works' },
  { key: 'office-administration', name: 'Office & Administration' },
] as const;
export function departmentName(key: string): string {
  return DEPARTMENTS.find((d) => d.key === key)?.name ?? key;
}

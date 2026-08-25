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
export type CategorySeed = z.infer<typeof CategorySeedSchema>;
export type BrandSeed = z.infer<typeof BrandSeedSchema>;

/** Default widget for a data type when the registry does not say. */
export function defaultWidget(t: DataType): FilterWidget {
  return t === 'number' ? 'range' : t === 'boolean' ? 'toggle' : 'checkbox';
}

/** The slug rule the sheet parser uses for verbatim labels → keys. */
export function slugKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
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
export type DepartmentKey = (typeof DEPARTMENTS)[number]['key'];

/** Nav order of a department key; unknown keys sort last rather than throwing on a page render. */
export function departmentOrder(key: string): number {
  const i = DEPARTMENTS.findIndex((d) => d.key === key);
  return i === -1 ? DEPARTMENTS.length : i;
}
export function departmentName(key: string): string {
  return DEPARTMENTS.find((d) => d.key === key)?.name ?? key;
}

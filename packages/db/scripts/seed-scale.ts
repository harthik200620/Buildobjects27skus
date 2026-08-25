/**
 * pnpm scale:seed [--count 400000] [--clear] [--reindex] [--batch 4000]
 *
 * Generates N synthetic SKUs (sku_code SYN-…, ids from 1,000,000 so they never collide with the
 * curated catalogue's auto-increment ids) with realistic per-category attribute distributions,
 * prices, reused real imagery, a full spec_json read-model, EAV rows for every filterable
 * attribute, and the matching Meilisearch documents — then refreshes category stats.
 * Everything synthetic is namespaced (SYN- codes, syn- slugs) so `--clear` restores the curated
 * demo catalogue exactly. `--reindex` rebuilds the Meilisearch documents of every synthetic row
 * from MySQL (keyset scan). Refuses to run unless SCALE_SEED=1 or --yes is passed.
 */
import '../src/env';
import { imageKey } from '@buildobjects/catalog';
import { MeiliSearch } from 'meilisearch';
import { closeDb, getPool } from '../src/client';

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined;
};
const COUNT = Number(flag('count') ?? 400_000);
const BATCH = Number(flag('batch') ?? 4000);
const CLEAR = !!flag('clear');
const REINDEX = !!flag('reindex');
const YES = !!flag('yes') || process.env.SCALE_SEED === '1';
const MEILI = { host: process.env.MEILI_HOST ?? 'http://127.0.0.1:7700', apiKey: process.env.MEILI_MASTER_KEY };
const SKUS_PER_PRODUCT = 5;
const ID_BASE = 1_000_000;

/* deterministic PRNG so runs are reproducible */
let seed = 20260823;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const gauss = (mean: number, sd: number) => {
  const u = 1 - rnd(),
    v = rnd();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const round = (n: number, step: number) => Math.round(n / step) * step;

/** Per-category generators: price band + the filterable attributes (registry keys + enum values) the PLP facets on. */
type Gen = { price: () => number; unit: string; attrs: () => Record<string, string | number | boolean>; names: string[] };
const GEN: Record<string, Gen> = {
  cement: {
    unit: 'bag',
    price: () => round(gauss(410, 35), 1),
    names: ['OPC 53', 'OPC 43', 'PPC', 'PSC', 'Super', 'Plus', 'Gold', 'Premium'],
    attrs: () => {
      const t = pick(['OPC 43', 'OPC 53', 'PPC', 'PSC', 'Composite Cement']);
      return {
        cement_type: t,
        grade: t === 'OPC 43' ? '43' : t === 'OPC 53' ? '53' : 'Blended (no numeric grade)',
        application_segment: pick(['General purpose', 'Structural / RCC', 'Masonry & plaster', 'Specialty / waterproof']),
        compressive_strength_28d: round(gauss(48, 6), 1),
        fineness_blaine: round(gauss(320, 30), 5),
        setting_time_initial: round(gauss(120, 30), 5),
        net_weight_kg: 50,
        isi_marked: rnd() < 0.95,
        bag_material: pick(['HDPE/PP laminated woven', 'Paper (kraft)', 'PP woven']),
      };
    },
  },
  epoxy: {
    unit: 'kit',
    price: () => round(gauss(2100, 600), 10),
    names: ['Epoxy Grout', 'Anchor Fix', 'Bonding Epoxy', 'Injection Grout', 'Repair Mortar', 'Floor Coat'],
    attrs: () => ({
      epoxy_type: pick(['Structural adhesive', 'Bonding agent', 'Injection resin', 'Repair mortar', 'Anchoring grout', 'Free-flow grout']),
      component_system: pick(['Two-part (A + B)', 'Two-part (A + B)', 'Three-part (A + B + filler)']),
      application_form: pick(['Thixotropic paste (non-sag)', 'Trowelable mortar', 'Free-flowing liquid', 'Low-viscosity injection liquid']),
      solvent_free: rnd() < 0.85,
      compressive_strength_mpa: round(gauss(70, 12), 1),
      pot_life_min: round(gauss(45, 15), 5),
      structural_use: rnd() < 0.7,
      usage_area: pick(['Interior', 'Exterior', 'Interior and exterior']),
      pack_size_kg: pick([1, 2, 5, 10, 20]),
    }),
  },
  'fire-extinguishers': {
    unit: 'piece',
    price: () => round(gauss(4200, 1400), 10),
    names: ['ABC Powder', 'CO2', 'Foam', 'Clean Agent', 'Water Mist'],
    attrs: () => ({
      product_type: pick([
        'ABC dry powder (stored pressure)',
        'ABC dry powder (cartridge operated)',
        'Carbon dioxide (CO2)',
        'Mechanical foam (AFFF)',
        'Water (stored pressure)',
      ]),
      extinguishing_agent: pick([
        'Mono ammonium phosphate (MAP 90)',
        'Mono ammonium phosphate (MAP 75)',
        'Mono ammonium phosphate (MAP 40)',
        'Carbon dioxide',
        'AFFF foam concentrate',
      ]),
      capacity_kg: pick([1, 2, 4, 6, 9]),
      operating_mechanism: pick(['Stored pressure', 'Stored pressure', 'Gas cartridge operated']),
      refillable: true,
      cylinder_material: pick(['Deep-drawn CRCA steel', 'Seamless alloy steel', 'Welded mild steel (EN 10120)']),
      fire_rating: pick(['1A 21B', '2A 21B', '4A 34B', '4A 144B']),
      suitable_for_electrical: rnd() < 0.8,
      isi_marked: rnd() < 0.9,
      mounting_type: pick(['Wall bracket', 'Wall hook', 'Floor stand']),
      warranty_months: pick([12, 24, 60, 120]),
    }),
  },
  'solar-panels': {
    unit: 'panel',
    price: () => round(gauss(11800, 1500), 50),
    names: ['Mono PERC', 'TOPCon', 'Bifacial', 'HJT', 'Half-cut'],
    attrs: () => ({
      cell_technology: pick(['Mono PERC', 'N-type TOPCon', 'N-type TOPCon', 'HJT']),
      bifacial: rnd() < 0.6,
      rated_power_wp: pick([400, 450, 500, 540, 545, 550, 575, 600]),
      module_efficiency_pct: round(gauss(21.5, 0.8), 0.1),
      number_of_cells: pick([108, 120, 132, 144]),
      application_segment: pick(['Residential rooftop', 'Commercial & industrial rooftop', 'Utility-scale ground mount']),
      almm_listed: rnd() < 0.9,
      junction_box_ip_rating: pick(['IP67', 'IP68']),
      product_warranty_years: pick([10, 12, 15]),
      performance_warranty_years: pick([25, 27, 30]),
    }),
  },
  cctv: {
    unit: 'piece',
    price: () => round(gauss(2600, 900), 10),
    names: ['Dome', 'Bullet', 'Turret', 'PTZ', 'Cube'],
    attrs: () => ({
      product_type: pick(['IP network camera', 'HD analogue camera (HDTVI/HDCVI/AHD)', 'Wi-Fi / wireless camera']),
      form_factor: pick(['Dome', 'Bullet', 'Turret (eyeball)', 'Cube / indoor', 'PTZ']),
      resolution_mp: pick([2, 2, 4, 5, 8]),
      signal_technology: pick(['IP (network)', 'HDTVI', 'HDCVI', 'AHD']),
      night_vision_type: pick(['Infrared (black & white)', 'Full-colour (white light)', 'Smart dual-light (IR + white light)']),
      audio_support: pick(['None', 'Built-in microphone', 'Microphone + speaker (two-way talk)']),
      lens_focal_length_mm: pick([2.8, 3.6, 4, 6]),
      ir_range_m: pick([20, 30, 40, 50, 80]),
      video_compression: pick(['H.265+', 'H.265', 'H.264+']),
      ip_rating: pick(['IP66', 'IP67', 'Not rated (indoor)']),
      power_supply_type: pick(['PoE (802.3af)', '12 V DC', 'PoE + 12 V DC']),
    }),
  },
  tiles: {
    unit: 'box',
    price: () => round(gauss(1200, 300), 10),
    names: ['Marble Look', 'Wood Look', 'Stone', 'Terrazzo', 'Concrete'],
    attrs: () => {
      const size = pick(['600 x 600 mm', '600 x 1200 mm', '800 x 1600 mm', '300 x 600 mm']);
      return {
        product_type: pick([
          'Glazed vitrified tile (GVT)',
          'Polished glazed vitrified tile (PGVT)',
          'Double charge vitrified tile',
          'Full body vitrified tile',
          'Ceramic floor tile',
        ]),
        body_type: pick(['Vitrified (porcelain) body', 'Double charge body', 'Ceramic (earthenware) body']),
        nominal_size: size,
        dim_d_mm: pick([8, 9, 10, 12]),
        rectified: rnd() < 0.7,
        pei_abrasion_class: pick(['PEI III', 'PEI IV', 'PEI V']),
        water_absorption_pct: round(gauss(0.3, 0.15), 0.05),
        slip_resistance_class: pick(['R9', 'R10', 'R11']),
        usage_area: pick(['Floor', 'Wall', 'Floor and wall']),
        surface_finish: pick(['Glossy', 'Matt', 'Satin', 'Polished']),
        design_theme: pick(['Marble', 'Wood', 'Stone', 'Concrete / cement', 'Terrazzo']),
        price_per_sqft: round(gauss(55, 18), 1),
      };
    },
  },
  glass: {
    unit: 'sqft',
    price: () => round(gauss(120, 45), 1),
    names: ['Clear Float', 'Toughened', 'Laminated', 'Solar Control', 'Low-E', 'DGU'],
    attrs: () => ({
      product_type: pick([
        'Clear float glass',
        'Tinted float glass',
        'Toughened (tempered) safety glass',
        'Heat-strengthened glass',
        'Heat-soaked toughened glass',
      ]),
      coating_type: pick(['Uncoated', 'Pyrolytic hard coat (online)', 'Magnetron sputtered soft coat (offline)', 'Single silver sputtered']),
      interlayer_material: pick(['None', 'None', 'PVB (polyvinyl butyral)']),
      nominal_thickness_mm: pick([4, 5, 6, 8, 10, 12]),
      impact_safety_class: pick(['Not a safety glass', 'IS 2553 Type A (toughened)', 'IS 2553 Type B (laminated)']),
      visible_light_transmission_pct: round(gauss(60, 18), 1),
      solar_heat_gain_coefficient: round(gauss(0.5, 0.15), 0.01),
      u_value_w_m2k: round(gauss(4.5, 1.2), 0.1),
      sound_reduction_db: round(gauss(32, 4), 1),
      application_area: pick(['Windows and residential glazing', 'Commercial facades and curtain walls', 'Doors, partitions and shopfronts']),
      bis_isi_marked: rnd() < 0.5,
      glass_colour: pick(['Clear', 'Green', 'Blue', 'Grey', 'Bronze']),
    }),
  },
  'total-stations': {
    unit: 'piece',
    price: () => round(gauss(480000, 140000), 1000),
    names: ['FlexLine', 'C-Series', 'GM', 'ES', 'OS'],
    attrs: () => ({
      instrument_class: pick(['Manual total station', 'Manual total station', 'Motorised total station', 'Robotic total station']),
      compensator_type: pick(['Dual-axis', 'Dual-axis', 'Quadruple-axis']),
      angular_accuracy_arcsec: pick([1, 2, 3, 5, 7]),
      reflectorless_range_m: pick([350, 500, 800, 1000]),
      prism_range_m: pick([3500, 4000, 5000]),
      laser_class: pick(['Class 1', 'Class 3R']),
      battery_operating_time_h: pick([10, 14, 20, 30]),
      bluetooth: rnd() < 0.8,
      ip_rating: pick(['IP54', 'IP55', 'IP66']),
      warranty_months: pick([12, 24, 36]),
    }),
  },
  bulbs: {
    unit: 'piece',
    price: () => round(gauss(95, 30), 1),
    names: ['Ace Saver', 'Adore', 'Garnet', 'Tejas', 'Lumeno', 'Stellar'],
    attrs: () => {
      const w = pick([5, 7, 9, 9, 12, 15, 18]);
      return {
        base_type: pick(['B22', 'B22', 'E27', 'E14']),
        wattage: w,
        lumens: Math.round(w * gauss(100, 8)),
        colour_temperature: pick([2700, 3000, 4000, 6500, 6500]),
        colour_rendering_index: pick([80, 80, 85, 90]),
        dimmability: rnd() < 0.15,
        shape: pick(['A-shape', 'A-shape', 'Candle', 'Globe']),
        energy_rating: pick(['4 star', '5 star']),
        operating_life: pick([15000, 25000, 30000]),
        warranty_months: pick([12, 24]),
      };
    },
  },
};

type AttrRow = { id: number; key: string; data_type: string; unit: string | null; is_filterable: number; label: string; category: string };

async function main() {
  if (!YES && !CLEAR && !REINDEX) {
    console.error(
      'Refusing: this writes synthetic rows into the catalogue. Re-run with --yes (or SCALE_SEED=1). Use --clear to remove them, --reindex to rebuild their search documents.',
    );
    process.exit(2);
  }
  const pool = getPool();
  const meili = new MeiliSearch(MEILI);
  const index = meili.index('skus');
  const t0 = Date.now();

  if (CLEAR) {
    console.log('clearing synthetic rows…');
    const [rows] = (await pool.query("SELECT id FROM skus WHERE sku_code LIKE 'SYN-%'")) as unknown as [{ id: number }[]];
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 20000) {
      const slice = ids.slice(i, i + 20000);
      await pool.query('DELETE FROM sku_attribute_values WHERE sku_id IN (?)', [slice]);
      await pool.query('DELETE FROM sku_images WHERE sku_id IN (?)', [slice]);
    }
    await pool.query("DELETE FROM skus WHERE sku_code LIKE 'SYN-%'");
    await pool.query("DELETE FROM products WHERE slug LIKE 'syn-%'");
    try {
      for (let i = 0; i < ids.length; i += 50000) {
        const t = await index.deleteDocuments(ids.slice(i, i + 50000));
        await meili.tasks.waitForTask(t.taskUid, { timeout: 600_000 });
      }
    } catch (e) {
      console.warn('meili delete skipped:', (e as Error).message);
    }
    await refreshStats(pool);
    console.log(`cleared ${ids.length} synthetic SKUs in ${Math.round((Date.now() - t0) / 1000)} s · now run: pnpm pipeline facets`);
    await closeDb();
    return;
  }

  const [attrs] = (await pool.query(
    'SELECT a.id, a.key, a.data_type, a.unit, a.is_filterable, a.label, c.slug AS category FROM attributes a JOIN categories c ON c.id=a.category_id',
  )) as unknown as [AttrRow[]];
  const attrByCat = new Map<string, Map<string, AttrRow>>();
  for (const a of attrs) (attrByCat.get(a.category) ?? attrByCat.set(a.category, new Map()).get(a.category)!).set(a.key, a);

  if (REINDEX) {
    // --from <id> --to <id> bound the keyset scan (e.g. to re-push only the rows a crashed run never flushed)
    const FROM = Number(flag('from') ?? 0),
      TO = flag('to') ? Number(flag('to')) : Number.MAX_SAFE_INTEGER;
    console.log(`re-indexing synthetic rows from MySQL (keyset scan, ids ${FROM} … ${TO === Number.MAX_SAFE_INTEGER ? 'end' : TO})…`);
    let last = FROM,
      total = 0;
    for (;;) {
      const [rows] = (await pool.query(
        `SELECT s.id, s.sku_code, s.variant_label, s.selling_price, s.mrp, s.price_provenance, s.unit, s.pack_qty, s.stock_status, s.short_description, s.hero_image_key, s.blurhash, s.key_specs, s.spec_json, s.created_at, p.name AS product_name, p.model_no, b.name AS brand, b.slug AS brand_slug, c.slug AS category, c.name AS category_name, c.name_te, c.name_hi FROM skus s JOIN products p ON p.id=s.product_id JOIN brands b ON b.id=p.brand_id JOIN categories c ON c.id=p.category_id WHERE s.sku_code LIKE 'SYN-%' AND s.id > ? AND s.id <= ? ORDER BY s.id LIMIT 5000`,
        [last, TO],
      )) as unknown as [Record<string, unknown>[]];
      if (!rows.length) break;
      const docs = rows.map((r) => {
        const keySpecs = (typeof r.key_specs === 'string' ? JSON.parse(r.key_specs) : r.key_specs) as { label: string; value: string }[];
        const spec = (typeof r.spec_json === 'string' ? JSON.parse(r.spec_json) : r.spec_json) as {
          groups: { rows: { key: string; value: unknown }[] }[];
        } | null;
        const reg = attrByCat.get(String(r.category));
        const doc: Record<string, unknown> = {
          id: Number(r.id),
          sku_code: r.sku_code,
          slug: String(r.sku_code).toLowerCase(),
          name: `${r.product_name} · ${r.variant_label}`,
          brand: r.brand,
          brand_slug: r.brand_slug,
          category: r.category,
          category_name: r.category_name,
          category_name_te: r.name_te ?? '',
          category_name_hi: r.name_hi ?? '',
          model_no: r.model_no ?? '',
          variant_label: r.variant_label,
          short_description: r.short_description,
          synonyms: [],
          spec_text: keySpecs.map((k) => k.value),
          selling_price: r.selling_price === null ? null : Number(r.selling_price),
          mrp: r.mrp === null ? null : Number(r.mrp),
          price_provenance: r.price_provenance,
          unit: r.unit,
          pack_qty: Number(r.pack_qty ?? 1),
          stock: r.stock_status,
          in_stock: r.stock_status !== 'out_of_stock',
          hero_image_key: r.hero_image_key,
          blurhash: r.blurhash,
          card_specs: keySpecs.slice(0, 3),
          ar: false,
          created_at: Math.floor(new Date(r.created_at as string).getTime() / 1000),
        };
        for (const g of spec?.groups ?? [])
          for (const row of g.rows) {
            const a = reg?.get(row.key);
            if (a?.is_filterable) doc[`attr_${row.key}`] = row.value;
          }
        return doc;
      });
      const t = await index.addDocuments(docs, { primaryKey: 'id' });
      await meili.tasks.waitForTask(t.taskUid, { timeout: 600_000 }).catch(() => {});
      last = Number(rows[rows.length - 1].id);
      total += rows.length;
      if (total % 50000 === 0) console.log(`  ${total.toLocaleString('en-IN')} re-indexed · ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    console.log(`re-indexed ${total.toLocaleString('en-IN')} synthetic documents in ${Math.round((Date.now() - t0) / 1000)} s`);
    await closeDb();
    return;
  }

  const [cats] = (await pool.query('SELECT id, slug, name, name_te, name_hi, unit FROM categories ORDER BY display_order')) as unknown as [
    { id: number; slug: string; name: string; name_te: string | null; name_hi: string | null; unit: string }[],
  ];
  const [brands] = (await pool.query(
    'SELECT b.id, b.slug, b.name, c.slug AS category FROM brands b JOIN products p ON p.brand_id=b.id JOIN categories c ON c.id=p.category_id GROUP BY b.id, b.slug, b.name, c.slug',
  )) as unknown as [{ id: number; slug: string; name: string; category: string }[]];
  const [heroes] = (await pool.query(
    "SELECT s.hero_image_key, s.blurhash, c.slug AS category FROM skus s JOIN products p ON p.id=s.product_id JOIN categories c ON c.id=p.category_id WHERE s.hero_image_key IS NOT NULL AND s.sku_code NOT LIKE 'SYN-%'",
  )) as unknown as [{ hero_image_key: string; blurhash: string | null; category: string }[]];
  const [[{ maxId }]] = (await pool.query('SELECT COALESCE(MAX(id),0) AS maxId FROM skus')) as unknown as [[{ maxId: number }]];
  const [[{ maxProd }]] = (await pool.query('SELECT COALESCE(MAX(id),0) AS maxProd FROM products')) as unknown as [[{ maxProd: number }]];
  // a crashed run can leave synthetic products without SKUs (the products batch lands before the skus batch) — drop them first
  await pool.query("DELETE p FROM products p LEFT JOIN skus s ON s.product_id = p.id WHERE p.slug LIKE 'syn-%' AND s.id IS NULL");
  const [[{ existing }]] = (await pool.query("SELECT COUNT(*) AS existing FROM skus WHERE sku_code LIKE 'SYN-%'")) as unknown as [[{ existing: number }]];
  const start = Number(existing);
  console.log(`seeding ${(COUNT - start).toLocaleString('en-IN')} synthetic SKUs (${start.toLocaleString('en-IN')} exist) across ${cats.length} categories…`);
  let missingKeys = 0;

  const docs: Record<string, unknown>[] = [];
  // synthetic ids live from ID_BASE upward so a concurrent real ingest can never collide with them
  let skuId = Math.max(Number(maxId), ID_BASE - 1),
    prodId = Math.max(Number(maxProd), ID_BASE - 1);
  const flushDocs = async () => {
    if (!docs.length) return;
    const t = await index.addDocuments(docs.splice(0), { primaryKey: 'id' });
    await meili.tasks.waitForTask(t.taskUid, { timeout: 600_000 }).catch(() => {});
  };

  for (let from = start; from < COUNT; from += BATCH) {
    const n = Math.min(BATCH, COUNT - from);
    const prodRows: unknown[][] = [],
      skuRows: unknown[][] = [],
      eavRows: unknown[][] = [],
      imgRows: unknown[][] = [];
    for (let i = 0; i < n; i++) {
      const k = from + i;
      // one product (brand line) per SKUS_PER_PRODUCT consecutive SKUs — all sharing its category
      const cat = cats[Math.floor(k / SKUS_PER_PRODUCT) % cats.length];
      const gen = GEN[cat.slug] ?? GEN.cement;
      const catBrands = brands.filter((b) => b.category === cat.slug);
      const brand = catBrands.length ? catBrands[Math.floor(k / SKUS_PER_PRODUCT) % catBrands.length] : brands[0];
      const attrsOf = gen.attrs();
      const price = Math.max(10, gen.price());
      const mrp = Math.round(price * (1 + Math.max(0, gauss(0.12, 0.08))));
      const code = `SYN-${cat.slug.slice(0, 3).toUpperCase()}-${String(k).padStart(6, '0')}`;
      const line = `${brand.name} ${gen.names[Math.floor(k / SKUS_PER_PRODUCT) % gen.names.length]} ${Math.floor(k / SKUS_PER_PRODUCT) % 997}`;
      const name = `${line} · v${(k % SKUS_PER_PRODUCT) + 1}`;
      if (k % SKUS_PER_PRODUCT === 0 || i === 0) {
        prodId++;
        prodRows.push([
          prodId,
          cat.id,
          brand.id,
          line,
          `syn-${cat.slug}-${Math.floor(k / SKUS_PER_PRODUCT)}-${k}`,
          `SYN-${Math.floor(k / SKUS_PER_PRODUCT)}`,
          'active',
        ]);
      }
      skuId++;
      const catHeroes = heroes.filter((h) => h.category === cat.slug);
      const hero = catHeroes.length ? catHeroes[k % catHeroes.length] : heroes[0];
      const heroKey = hero?.hero_image_key ?? imageKey(code, 1, 'card');
      const reg = attrByCat.get(cat.slug);
      const rows = Object.entries(attrsOf)
        .map(([key, value]) => ({ key, value, a: reg?.get(key) }))
        .filter((r) => {
          if (!r.a) missingKeys++;
          return !!r.a;
        });
      const fmt = (value: string | number | boolean, unit: string | null) =>
        typeof value === 'number'
          ? `${value.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`
          : typeof value === 'boolean'
            ? value
              ? 'Yes'
              : 'No'
            : String(value);
      const keySpecs = rows.slice(0, 8).map((r) => ({ key: r.key, label: r.a!.label, value: fmt(r.value, r.a!.unit), unit: r.a!.unit }));
      const specJson = {
        groups: [
          {
            key: 'product_identity',
            label: 'Product identity',
            importance: 1,
            rows: rows.map((r) => ({
              key: r.key,
              label: r.a!.label,
              value: r.value,
              unit: r.a!.unit,
              data_type: r.a!.data_type,
              provenance: 'ai_filled',
              confidence: 0.5,
              source_url: null,
              compare: true,
            })),
          },
        ],
        filled: rows.length,
        total: reg?.size ?? 0,
        by_provenance: { fetched: 0, verified: 0, ai_filled: rows.length },
      };
      const stock = rnd() < 0.9 ? 'in_stock' : rnd() < 0.5 ? 'low' : 'out_of_stock';
      skuRows.push([
        skuId,
        prodId,
        cat.id,
        code,
        `v${(k % SKUS_PER_PRODUCT) + 1}`,
        mrp,
        price,
        'estimated',
        18,
        gen.unit,
        1,
        stock,
        `Synthetic ${cat.name} SKU for scale testing — ${name}.`,
        JSON.stringify(keySpecs),
        JSON.stringify(specJson),
        heroKey,
        hero?.blurhash ?? null,
        JSON.stringify({
          filled: rows.length,
          total: specJson.total,
          by_provenance: specJson.by_provenance,
          images: 1,
          placeholders: 0,
          brochures: 0,
          computed_at: new Date().toISOString(),
        }),
      ]);
      imgRows.push([skuId, 1, 'hero', name, heroKey.replace(/-card\.webp$/, '-orig.jpg'), 1200, 1200, hero?.blurhash ?? null, 0]);
      const doc: Record<string, unknown> = {
        id: skuId,
        sku_code: code,
        slug: code.toLowerCase(),
        name,
        brand: brand.name,
        brand_slug: brand.slug,
        category: cat.slug,
        category_name: cat.name,
        category_name_te: cat.name_te ?? '',
        category_name_hi: cat.name_hi ?? '',
        model_no: `SYN-${k}`,
        variant_label: `v${(k % SKUS_PER_PRODUCT) + 1}`,
        short_description: `Synthetic ${cat.name} for scale testing`,
        synonyms: [],
        spec_text: keySpecs.map((s) => s.value),
        selling_price: price,
        mrp,
        price_provenance: 'estimated',
        unit: gen.unit,
        pack_qty: 1,
        stock,
        in_stock: stock !== 'out_of_stock',
        hero_image_key: heroKey,
        blurhash: hero?.blurhash ?? null,
        card_specs: keySpecs.slice(0, 3).map((s) => ({ label: s.label, value: s.value })),
        ar: false,
        created_at: Math.floor(Date.now() / 1000) - k,
      };
      for (const r of rows) {
        const a = r.a!;
        if (a.is_filterable) doc[`attr_${r.key}`] = r.value;
        eavRows.push([
          skuId,
          a.id,
          typeof r.value === 'number' || typeof r.value === 'boolean' ? null : String(r.value),
          typeof r.value === 'number' ? r.value : null,
          typeof r.value === 'boolean' ? (r.value ? 1 : 0) : null,
          'ai_filled',
          0.5,
        ]);
      }
      docs.push(doc);
    }
    if (prodRows.length) await pool.query('INSERT INTO products (id, category_id, brand_id, name, slug, model_no, status) VALUES ?', [prodRows]);
    await pool.query(
      'INSERT INTO skus (id, product_id, category_id, sku_code, variant_label, mrp, selling_price, price_provenance, gst_rate, unit, pack_qty, stock_status, short_description, key_specs, spec_json, hero_image_key, blurhash, coverage) VALUES ?',
      [skuRows],
    );
    for (let i = 0; i < eavRows.length; i += 10000)
      await pool.query('INSERT INTO sku_attribute_values (sku_id, attribute_id, value_text, value_number, value_bool, provenance, confidence) VALUES ?', [
        eavRows.slice(i, i + 10000),
      ]);
    await pool.query('INSERT INTO sku_images (sku_id, position, role, alt, storage_key_original, width, height, blurhash, placeholder) VALUES ?', [imgRows]);
    if (docs.length >= 20000) await flushDocs();
    const done = from + n;
    if ((done - start) % 20000 === 0 || done === COUNT)
      console.log(
        `  ${done.toLocaleString('en-IN')} / ${COUNT.toLocaleString('en-IN')} · ${Math.round((Date.now() - t0) / 1000)} s · ${Math.round((done - start) / ((Date.now() - t0) / 60000)).toLocaleString('en-IN')} SKUs/min`,
      );
  }
  await flushDocs();
  await refreshStats(pool);
  if (missingKeys) console.warn(`  ! ${missingKeys} generated values had no registry attribute and were skipped`);
  console.log(
    `done: ${COUNT.toLocaleString('en-IN')} synthetic SKUs in ${Math.round((Date.now() - t0) / 1000)} s. Now run: pnpm pipeline facets  (recomputes filter_configs + Meilisearch filterable attributes)`,
  );
  await closeDb();
}

async function refreshStats(pool: ReturnType<typeof getPool>) {
  await pool.query(
    `UPDATE categories c SET stats = (SELECT JSON_OBJECT('sku_count', COUNT(*), 'in_stock', SUM(s.stock_status <> 'out_of_stock'), 'min_price', MIN(s.selling_price), 'max_price', MAX(s.selling_price), 'computed_at', NOW()) FROM skus s JOIN products p ON p.id = s.product_id WHERE p.category_id = c.id)`,
  );
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});

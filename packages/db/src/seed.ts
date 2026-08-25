/**
 * Base seeds that are not catalogue data: GST rates per category (HSN-led, flagged for
 * verification), the serviceable regions, and the multilingual search synonyms that seed
 * Meilisearch. Categories / brands / registries are seeded by the pipeline (`pnpm registry:seed`).
 * Idempotent — safe to re-run.
 */
import './env';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import { gstRates, regions, searchSynonyms } from './schema';

const GST: { category_slug: string; hsn: string; rate: number; source: string; needs_verification: boolean }[] = [
  // Rates after the GST Council's September 2025 rationalisation (effective 22 Sep 2025). Re-verified by the pipeline's verify stage when a key is present.
  { category_slug: 'cement', hsn: '2523', rate: 18, source: 'GST Council 56th meeting, Sep 2025 — cement moved 28% → 18%', needs_verification: false },
  { category_slug: 'epoxy', hsn: '3907', rate: 18, source: 'HSN 3907 epoxide resins / 3506 adhesives — 18%', needs_verification: true },
  { category_slug: 'fire-extinguishers', hsn: '8424', rate: 18, source: 'HSN 8424 fire extinguishers — 18%', needs_verification: true },
  { category_slug: 'solar-panels', hsn: '8541', rate: 5, source: 'Sep 2025 rationalisation — renewable energy devices 12% → 5%', needs_verification: true },
  { category_slug: 'cctv', hsn: '8525', rate: 18, source: 'HSN 8525 television cameras — 18%', needs_verification: true },
  { category_slug: 'tiles', hsn: '6907', rate: 18, source: 'HSN 6907 ceramic/vitrified tiles — 18%', needs_verification: true },
  { category_slug: 'glass', hsn: '7005', rate: 18, source: 'HSN 7005 float glass / 7007 safety glass — 18%', needs_verification: true },
  { category_slug: 'total-stations', hsn: '9015', rate: 18, source: 'HSN 9015 surveying instruments — 18%', needs_verification: true },
  { category_slug: 'bulbs', hsn: '8539', rate: 12, source: 'HSN 8539 50 LED lamps — 12% (check Sep 2025 schedule)', needs_verification: true },
];

const REGIONS = [
  { region_id: 'hyd', name: 'Hyderabad', state_code: 'TS', pincode_from: '500001', pincode_to: '500113', default_pincode: '500001', delivery_days: 2 },
  { region_id: 'vij', name: 'Vijayawada', state_code: 'AP', pincode_from: '520001', pincode_to: '521456', default_pincode: '520001', delivery_days: 3 },
  { region_id: 'vizag', name: 'Visakhapatnam', state_code: 'AP', pincode_from: '530001', pincode_to: '531173', default_pincode: '530001', delivery_days: 3 },
  { region_id: 'wgl', name: 'Warangal', state_code: 'TS', pincode_from: '506001', pincode_to: '506391', default_pincode: '506002', delivery_days: 4 },
  { region_id: 'gnt', name: 'Guntur', state_code: 'AP', pincode_from: '522001', pincode_to: '522663', default_pincode: '522001', delivery_days: 4 },
  { region_id: 'tpt', name: 'Tirupati', state_code: 'AP', pincode_from: '517501', pincode_to: '517644', default_pincode: '517501', delivery_days: 4 },
];

/** term → synonyms. Telugu / Hindi / transliterations / vernacular trade words. Meilisearch treats these as bidirectional groups. */
const SYNONYMS: { term: string; synonyms: string[]; lang: string; category_slug: string | null }[] = [
  {
    term: 'cement',
    synonyms: ['సిమెంట్', 'सीमेंट', 'simment', 'siment', 'cemant', 'ppc', 'opc', 'bag of cement', 'cement bag'],
    lang: 'mixed',
    category_slug: 'cement',
  },
  {
    term: 'bulb',
    synonyms: ['బల్బు', 'బల్బులు', 'बल्ब', 'led bulb', 'led light', 'current bulb', 'light bulb', 'lamp', 'దీపం', 'बत्ती', 'bulbu', 'b22 bulb'],
    lang: 'mixed',
    category_slug: 'bulbs',
  },
  {
    term: 'tiles',
    synonyms: ['టైల్స్', 'టైల్', 'टाइल्स', 'टाइल', 'tile', 'floor tiles', 'vitrified', 'gvt', 'pgvt', 'marble look tiles', 'tails', 'tyles'],
    lang: 'mixed',
    category_slug: 'tiles',
  },
  {
    term: 'glass',
    synonyms: ['అద్దం', 'గాజు', 'कांच', 'शीशा', 'toughened glass', 'window glass', 'float glass', 'tempered glass', 'addam', 'kanch'],
    lang: 'mixed',
    category_slug: 'glass',
  },
  {
    term: 'cctv',
    synonyms: [
      'camera',
      'కెమెరా',
      'కెమెరాలు',
      'कैमरा',
      'సీసీటీవీ',
      'सीसीटीवी',
      'security camera',
      'ip camera',
      'dome camera',
      'bullet camera',
      'surveillance',
      'nigha camera',
    ],
    lang: 'mixed',
    category_slug: 'cctv',
  },
  {
    term: 'solar panel',
    synonyms: ['సోలార్', 'सोलर', 'solar', 'pv panel', 'solar module', 'rooftop solar', 'సోలార్ ప్యానెల్', 'सोलर पैनल', 'सौर पैनल', 'solar plate'],
    lang: 'mixed',
    category_slug: 'solar-panels',
  },
  {
    term: 'fire extinguisher',
    synonyms: [
      'అగ్నిమాపక',
      'अग्निशामक',
      'fire cylinder',
      'fire safety cylinder',
      'extinguisher',
      'abc extinguisher',
      'co2 extinguisher',
      'fire bottle',
      'agni',
      'aag bujhane wala',
    ],
    lang: 'mixed',
    category_slug: 'fire-extinguishers',
  },
  {
    term: 'epoxy',
    synonyms: [
      'ఎపాక్సీ',
      'एपॉक्सी',
      'waterproofing',
      'leakage',
      'leak',
      'crack filler',
      'grout',
      'dr fixit',
      'epoxy adhesive',
      'epoxy grout',
      'bonding agent',
      'వాటర్ ప్రూఫింగ్',
      'रिसाव',
    ],
    lang: 'mixed',
    category_slug: 'epoxy',
  },
  {
    term: 'total station',
    synonyms: ['టోటల్ స్టేషన్', 'टोटल स्टेशन', 'survey instrument', 'surveying', 'theodolite', 'edm', 'land survey', 'సర్వే', 'सर्वे'],
    lang: 'mixed',
    category_slug: 'total-stations',
  },
  // brands, transliterated
  { term: 'ultratech', synonyms: ['అల్ట్రాటెక్', 'अल्ट्राटेक', 'ultra tech', 'ultratec'], lang: 'mixed', category_slug: 'cement' },
  { term: 'ambuja', synonyms: ['అంబుజా', 'अंबुजा', 'ambuja cement'], lang: 'mixed', category_slug: 'cement' },
  { term: 'acc', synonyms: ['ఏసీసీ', 'एसीसी', 'acc cement', 'acc gold'], lang: 'mixed', category_slug: 'cement' },
  { term: 'philips', synonyms: ['ఫిలిప్స్', 'फिलिप्स', 'signify', 'phillips', 'philps'], lang: 'mixed', category_slug: 'bulbs' },
  { term: 'havells', synonyms: ['హావెల్స్', 'हैवेल्स', 'havels', 'havell'], lang: 'mixed', category_slug: 'bulbs' },
  { term: 'wipro', synonyms: ['విప్రో', 'विप्रो', 'wipro lighting'], lang: 'mixed', category_slug: 'bulbs' },
  { term: 'hikvision', synonyms: ['హిక్విజన్', 'हिकविजन', 'hikvison', 'hik vision', 'hikvission'], lang: 'mixed', category_slug: 'cctv' },
  { term: 'dahua', synonyms: ['దహువా', 'दहुआ', 'dahuwa'], lang: 'mixed', category_slug: 'cctv' },
  { term: 'cp plus', synonyms: ['సీపీ ప్లస్', 'सीपी प्लस', 'cpplus', 'cp-plus'], lang: 'mixed', category_slug: 'cctv' },
  { term: 'kajaria', synonyms: ['కజారియా', 'कजारिया', 'kajariya'], lang: 'mixed', category_slug: 'tiles' },
  { term: 'somany', synonyms: ['సోమానీ', 'सोमानी', 'somani'], lang: 'mixed', category_slug: 'tiles' },
  { term: 'johnson', synonyms: ['జాన్సన్', 'जॉनसन', 'h&r johnson', 'hr johnson'], lang: 'mixed', category_slug: 'tiles' },
  { term: 'saint-gobain', synonyms: ['సెయింట్ గోబెన్', 'सेंट गोबेन', 'saint gobain', 'st gobain', 'sain gobain'], lang: 'mixed', category_slug: 'glass' },
  { term: 'ais', synonyms: ['asahi', 'asahi india glass', 'ఏఐఎస్'], lang: 'mixed', category_slug: 'glass' },
  { term: 'guardian', synonyms: ['guardian glass', 'గార్డియన్'], lang: 'mixed', category_slug: 'glass' },
  { term: 'waaree', synonyms: ['వారీ', 'वारी', 'waree', 'wari'], lang: 'mixed', category_slug: 'solar-panels' },
  { term: 'adani', synonyms: ['అదానీ', 'अदानी', 'adani solar'], lang: 'mixed', category_slug: 'solar-panels' },
  { term: 'vikram', synonyms: ['విక్రమ్', 'विक्रम', 'vikram solar'], lang: 'mixed', category_slug: 'solar-panels' },
  { term: 'ceasefire', synonyms: ['సీజ్‌ఫైర్', 'सीज़फायर', 'cease fire'], lang: 'mixed', category_slug: 'fire-extinguishers' },
  { term: 'safex', synonyms: ['సేఫెక్స్', 'सेफेक्स', 'safex fire'], lang: 'mixed', category_slug: 'fire-extinguishers' },
  { term: 'newage', synonyms: ['న్యూఏజ్', 'न्यूएज', 'new age', 'newage fire'], lang: 'mixed', category_slug: 'fire-extinguishers' },
  { term: 'sika', synonyms: ['సికా', 'सिका', 'sikadur'], lang: 'mixed', category_slug: 'epoxy' },
  { term: 'fosroc', synonyms: ['ఫోస్రోక్', 'फोसरॉक', 'fosrock'], lang: 'mixed', category_slug: 'epoxy' },
  { term: 'pidilite', synonyms: ['పిడిలైట్', 'पिडिलाइट', 'dr. fixit', 'drfixit', 'fevitite', 'fevicol'], lang: 'mixed', category_slug: 'epoxy' },
  { term: 'leica', synonyms: ['లైకా', 'लाइका', 'leica geosystems'], lang: 'mixed', category_slug: 'total-stations' },
  { term: 'trimble', synonyms: ['ట్రింబుల్', 'ट्रिम्बल'], lang: 'mixed', category_slug: 'total-stations' },
  { term: 'topcon', synonyms: ['టాప్‌కాన్', 'टॉपकॉन', 'top con'], lang: 'mixed', category_slug: 'total-stations' },
  // intent words
  { term: 'wattage', synonyms: ['watt', 'w', 'వాట్', 'वाट'], lang: 'mixed', category_slug: 'bulbs' },
  { term: 'warm white', synonyms: ['yellow light', '3000k', '2700k', 'పసుపు లైట్', 'पीली रोशनी'], lang: 'mixed', category_slug: 'bulbs' },
  { term: 'cool daylight', synonyms: ['white light', '6500k', 'తెల్ల లైట్', 'सफेद रोशनी'], lang: 'mixed', category_slug: 'bulbs' },
  { term: 'night vision', synonyms: ['ir camera', 'infrared', 'రాత్రి కెమెరా', 'रात कैमरा', 'colorvu', 'full color'], lang: 'mixed', category_slug: 'cctv' },
  { term: 'mp', synonyms: ['megapixel', '2mp', '4mp', '5mp', '8mp', '4k'], lang: 'mixed', category_slug: 'cctv' },
  { term: 'kw', synonyms: ['kilowatt', 'kwp', 'watt peak', 'wp'], lang: 'mixed', category_slug: 'solar-panels' },
];

async function main() {
  const db = getDb();
  for (const g of GST) {
    await db
      .insert(gstRates)
      .values({
        categorySlug: g.category_slug,
        hsn: g.hsn,
        rate: String(g.rate),
        source: g.source,
        needsVerification: g.needs_verification,
        verifiedAt: g.needs_verification ? null : new Date(),
      })
      .onDuplicateKeyUpdate({ set: { hsn: g.hsn, rate: String(g.rate), source: g.source, needsVerification: g.needs_verification } });
  }
  for (const r of REGIONS) {
    await db
      .insert(regions)
      .values({
        regionId: r.region_id,
        name: r.name,
        stateCode: r.state_code,
        pincodeFrom: r.pincode_from,
        pincodeTo: r.pincode_to,
        defaultPincode: r.default_pincode,
        deliveryDays: r.delivery_days,
        serviceable: true,
      })
      .onDuplicateKeyUpdate({
        set: { name: r.name, pincodeFrom: r.pincode_from, pincodeTo: r.pincode_to, defaultPincode: r.default_pincode, deliveryDays: r.delivery_days },
      });
  }
  await db.execute(sql`DELETE FROM search_synonyms`);
  await db.insert(searchSynonyms).values(SYNONYMS.map((s) => ({ term: s.term, synonyms: s.synonyms, lang: s.lang, categorySlug: s.category_slug })));
  console.log(`seeded ${GST.length} gst rates, ${REGIONS.length} regions, ${SYNONYMS.length} synonym groups`);
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

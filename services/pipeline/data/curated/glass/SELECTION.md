# Glass (GLS) — SKU selection

Category `glass`, code `GLS`, unit `sqft`, GST 18%, HSN 7005 (coated / tinted float glass in sheets).
Governing standards: **IS 14900** (transparent float glass — the substrate of all three picks),
**IS 2553 Part 1** (safety glass — applies only once a pane is toughened or laminated),
**IS 16231** (insulating glass units — applies only if a pane is built into a DGU).
Selected 2026-08-23 for the Andhra Pradesh / Telangana market.

All three picks are the brand's **named residential solar-control line, supplied as a single
monolithic pane at one nominal thickness** — the product an AP/Telangana house-builder actually
asks the window shop for ("Sunban 5 mm", "AIS Ecosense 6 mm", "Guardian ClimaGuard 5 mm") — rather
than a plain clear float, so that VLT, SHGC and U-value are meaningful on the compare engine.
Bounding box for every SKU is one typical window pane, **1200 × 1800 mm × thickness**
(the AR engine reads `dim_*`); the jumbo / maximum pane size is carried separately in
`max_pane_width_mm` / `max_pane_height_mm`.

---

## Saint-Gobain — `in.saint-gobain-glass.com` (the `saint-gobain-glass.in` domain from categories.json does not resolve)

**Domain confirmed as manufacturer.** Footer reads "© 2026 Saint-Gobain Glass India", the site
carries Saint-Gobain's own brand architecture (Sun Ban, Infinity, Inspire, My Home, Vetrotech),
a glass-comparison tool listing its Cool-Lite / Antelio / Envision / Nano / Planitherm / Evolite
codes, projects, press releases and careers. Not a marketplace. `www.saint-gobain-glass.in` gives a
TLS "unrecognized name" error; `glass.saint-gobain.co.in` does not respond; `in.saint-gobain-glass.com`
is the live site (HTML is behind a Cloudflare challenge that blocks curl / WebFetch with HTTP 403, so
the pages were read in a real browser; its static image files answer curl normally).

- **SKU chosen:** Saint-Gobain **Sun Ban — SGG Sapphire Blue, 5 mm** (pyrolytic-coated solar-control glass for residences)
- **URL:** https://in.saint-gobain-glass.com/product/sgg-sapphire-blue
- **Why this one:** Sun Ban is Saint-Gobain India's residential solar-control brand ("best-in-class
  range of Solar Control Glass for residences … reflects away up to 70% of heat"), and Sapphire Blue
  is the first shade in the brand's published 5 mm performance table. It is the best-documented
  product of the range: the product page prints the full 5 mm table (VLT 22.9%, solar factor 0.3894,
  external reflection 23.7%, internal reflection 51.5%, U-value 5.72 W/m²K) **and** a separate 6 mm
  performance block (VLT 21%, SF/SHGC 0.38, SC 0.41, U 5.7) with the test basis stated (EN 410 /
  EN 673), names the applications (windows, balconies, façades, staircases), states that the
  coating is pyrolytic and that the coated face must be installed towards the interior, carries a
  1235-px product-page banner of a Sapphire Blue façade, and links the "SGG Windows" brochure PDF.
  Blue reflective 5 mm is also the most-asked-for Sun Ban shade at Hyderabad / Vijayawada window
  counters, and an IndiaMART dealer listing for "Saint Gobain Sunban 5 mm" gave a live price.

## AIS (Asahi India Glass) — `aisglass.com`

**Domain confirmed as manufacturer.** The site states "Asahi India Glass Ltd (AIS) is India's leading
integrated glass and window solutions company" with 15 plants / sub-assembly units and ~4,000
employees, and publishes its own brochures, technical guides, investor and career pages. Wikipedia
confirms AIS was founded in 1984 as a joint venture of the Labroo family, AGC Inc. (Japan) and
Maruti Suzuki, with float lines at Roorkee and Taloja. Not a marketplace.

- **SKU chosen:** **AIS Ecosense Edge — Natura Plus, 6 mm** (solar-control + thermal-insulation coated glass for single glazing)
- **URL:** https://www.aisglass.com/building-and-construction/coated-for-exteriors/ais-ecosense/
  (official Ecosense range page; the Edge sub-range has no page of its own — the datasheet is the
  official "Ecosense brochure 2025" PDF, July 2026 edition, linked from that page)
- **Why this one:** Ecosense is AIS's flagship high-performance architectural range, and Edge is the
  only Ecosense sub-range AIS says is "developed for use in single-glazing applications as well" —
  i.e. the one that fits an AP/TS house window without a DGU. Natura Plus is the lead shade of the
  Edge neutral series on the website and appears with identical numbers in both the January-2024
  and the 2025/July-2026 brochure editions (6 mm single glazing: VLT 45%, external reflection 20%,
  internal reflection 6%, solar factor 42% → SHGC 0.42, shading coefficient 0.48, U-value
  4.6 W/m²K; 6-12-6 DGU: VLT 40%, SF 33%, U 2.4), with the computation basis stated (ISO 9050 for
  VLT/SF, EN 673 for U-value, EN 1096 tolerances). No AIS price listing could be opened (the AIS
  IndiaMART pages are out of stock / 404), so the price is `estimated`.

## Guardian Glass — `gujaratguardianglass.com` (Guardian's `guardianglass.com/in/en` 301-redirects here)

**Domain confirmed as manufacturer.** The about page identifies Gujarat Guardian Limited as the joint
venture of Guardian Industries Corp. and Modi Rubber Limited that built India's first float glass
plant at Ankleshwar (Gujarat) in 1993 and its mirror line in 1994, and the site is the Indian
property of Guardian Industries Holdings (owned by Koch Industries since 2017, per Wikipedia).
Not a marketplace.

- **SKU chosen:** **Guardian ClimaGuard Blue, 5 mm** (durable coated solar-control glass for homes)
- **URL:** https://www.gujaratguardianglass.com/in/en/our-glass/climaguard/climaguard-blue
- **Why this one:** ClimaGuard is Guardian's residential range in India ("advanced glass products
  designed for the home providing solar control, sound reduction and thermal insulation"), and Blue
  is the lead shade of the five. It is the best-documented Guardian India product: the product page
  and its own two-page brochure state the substrate (clear float), the thicknesses (3.5, 4 and 5 mm;
  4 and 5 mm on short lead time), the maximum size (< 3660 × 2550 mm), the processing options
  (heat-strengthened, heat-soaked, annealed, laminated, bent), monolithic and IGU use, the
  recommended coating position (surface 2), "Edge deletion: No", and the applications (windows,
  skylights, roof windows, doors). It carries five official gallery photographs, four of them
  2083 × 1429 px, plus the range brochure. An IndiaMART listing from a Hyderabad dealer gave a live
  ₹/sqft price for ClimaGuard coated glass.

---

## Known gaps (carried into the SKU files as `ai_filled`, confidence ≤ 0.7)

- **Guardian publishes no optical / thermal numbers for ClimaGuard Blue in India** — neither the
  product page nor either brochure gives VLT, SHGC, reflectance or U-value. Those four values, the
  emissivity and the UV transmission are `ai_filled` from the behaviour of a 5 mm durable-coated blue
  solar-control glass and are flagged for replacement from a Guardian performance sheet.
- **Coating technology for AIS Ecosense Edge and Guardian ClimaGuard Blue** is not stated (only
  "coated" / "durable coated"); both are entered as offline magnetron-sputtered coatings at
  confidence 0.45–0.5. Saint-Gobain states "pyrolytic" explicitly, so that one is `fetched`.
- **Sound reduction (Rw)** is not published by any of the three for these products; 30 dB (5 mm) /
  31 dB (6 mm) monolithic values are `ai_filled`.
- **Maximum pane size** is published only by Guardian; Saint-Gobain and AIS values are the usual
  Indian float jumbo sizes at confidence 0.35–0.4.
- **Warranty** terms are not published online for any of the three coated products; 120 months is
  entered at confidence ≤ 0.45. No BIS / ISI licence, CM/L or test-report number is recorded
  anywhere because none was published; `bis_isi_marked` is left out of all three files.
- **Weights** (`weight_per_sqm_kg`, `net_weight_kg`) are computed from nominal thickness × 2500 kg/m³
  and are `ai_filled`.
- **Images:** Saint-Gobain's swatch and secondary photo are 545–602 px wide (below the pipeline's
  1200 px bar) and the in-context / pack roles are unfilled for AIS and Saint-Gobain; AIS has only
  the one 1200 × 708 px range image plus two small official leaflet renditions. HEAD checks on the
  Saint-Gobain host were run with curl for the image files (they return normally) and in-browser
  (same-origin `fetch HEAD`) for the brochure PDF, because Cloudflare answers curl with a 403 HTML
  page for that PDF URL.
- **Prices:** Saint-Gobain and Guardian are `fetched` from single IndiaMART dealer listings
  (Dindigul ₹50/sqft for "Sunban 5 mm", shade unspecified; Hyderabad ₹70/sqft for "Coated Glass
  ClimaGuard", thickness range 4–12 mm) and should be re-quoted from a Hyderabad Saint-Gobain /
  Guardian dealer; AIS is `estimated`.

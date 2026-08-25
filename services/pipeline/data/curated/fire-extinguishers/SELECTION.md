# Fire extinguishers — brand and SKU selection

Category `fire-extinguishers` (code `FIR`). Three brands, one flagship each. Researched 2026-08-22.
Governing standards for this category: **IS 15683** (portable fire extinguishers — performance and
construction), **IS 2190** (code of practice for selection, installation and maintenance of portable
first-aid fire appliances), with **IS 4308** covering the dry chemical powder charge itself. HSN 8424,
GST 18%.

The category hero is the 4 kg or 6 kg ABC stored-pressure powder unit — the one appliance that covers
Class A, B, C and electrical fires, which is why it is what a builder, a shop owner and a fire NOC
inspector in Hyderabad or Vijayawada all default to.

> **Read this before launch:** two of the three assigned brands make portable extinguishers.
> The third, Newage Fire Protection, does not — see the section at the bottom.

---

## Ceasefire — `FIR-CEA-MAP90-4KG`

**Official Indian domain:** `ceasefire.in` — confirmed manufacturer, not a marketplace. The site is
the first-party brand site of Ceasefire Industries Pvt. Ltd. (vendor name confirmed on the company's
own transactional store, `ceasefireonlineshop.com`). Its `/about` page carries the company timeline
("2002 — company is founded"), and the product pages publish per-model engineering tables rather than
reseller copy.

**SKU chosen:** Ceasefire ABC Powder MAP 90 Fire Extinguisher, 4 kg — product code **CF-001144**
**URL:** https://www.ceasefire.in/product-page/abc-powder-portable-map-90-extinguishers

**Why this is the flagship:** it is the 4 kg unit of Ceasefire's MAP 90 range, the size the brand
sells hardest into homes, offices and shops, and it is by a distance the best-documented extinguisher
found in this whole category. The product page publishes a real spec table — product code, IS 15683
and EN 3 fire ratings (4A 144B / 21A 144B), 15 bar working and 35 bar test pressure, 445 mm height,
140 mm shell OD, 1.2 mm wall thickness, 6.20–6.50 kg gross weight, deep-drawn and MIG-welded can,
forged-and-machined valve, epoxy-polyester powder coating, −30 °C to 60 °C service range, helium leak
detection, and a 10-year warranty. That is 15+ values read directly off the manufacturer's page.

**Price source:** https://www.ceasefireonlineshop.com/products/abc-powder-map90-4kg — Ceasefire's own
store lists CF-001144 at ₹10,230. This is the premium dual-certified (IS 15683 + EN 3 + PED, with LPCB
approval, BSI Kitemark and CE marking) unit, which is why the list price sits well above a plain
ISI-only 4 kg extinguisher. Hyderabad trade pricing will be materially lower; treat ₹10,230 as MRP.

**Secondary sources:** https://www.ceasefire.in/about (year founded, portfolio).

**Not found:** the datasheet PDF linked from the product page
(`cf66d3f9-…usrfiles.com/ugd/cf66d3_45e229211dd54ae7929850f97f6ab8d7.pdf`) refused every connection
(`ECONNREFUSED` on the Wix user-files host), so `documents` is empty. Three of five image roles are
filled with HEAD-verified official images; there is no official in-context or packaging shot.

---

## Safex Fire — `FIR-SAF-ABC-SP-6KG`

**Official Indian domain:** `safexfire.com` — confirmed manufacturer, not a marketplace. The site
belongs to **Safex Fire Services Limited**, Lower Parel West, Mumbai; the company profile page states
it was founded in 1972, describes itself as the largest fire extinguisher manufacturer in India, and
lists 7 branch offices and 75+ distributors, including a Secunderabad sales office that covers Andhra
Pradesh and Telangana. It sells direct from its own WooCommerce store.

**SKU chosen:** Safex 6 kg ABC Portable Stored Pressure (MAP 40% MS)
**URL:** https://safexfire.com/product/6kg-abc-portable-stored-pressure/

**Why this is the flagship:** the 6 kg ABC stored-pressure unit is Safex's mainstream industrial and
commercial size — the one that goes onto factory walls, warehouse columns and office corridors on
fire-NOC drawings — and it is the size Safex prices and photographs on its own store. The official
page gives the agent (MAP 40% mono ammonium phosphate to IS 4308:2019, MAP 90% on request), the body
(mild steel), the mechanism (stored pressure), ISI certification, the four application areas, and
both list and offer prices (₹4,999 → ₹4,399).

**Secondary source:** https://www.esafeworld.com/shop/abc-6kg-fire-extinguisher-stored-pressure-map-40-safex-6895
— an Indian retailer listing used for the performance numbers Safex does not publish on its own page:
IS 15683 design standard, 4A:55B fire rating, 25 s discharge time, 6 m jet range, 15 bar service and
35 bar test pressure, 9.3 kg charged weight, ISI marked, 12-month warranty. Values sourced here are
marked `fetched` against that URL; capacity, fire classes, ISI status and electrical suitability agreed
across both sources and are marked `verified`.

**Two conflicts worth knowing.** (1) Safex's own page advertises MAP **40%** as standard, while the
4A:55B rating read at the retailer is the rating normally achieved with a richer MAP charge — both
values are recorded as read, and the invoice should state the charge. (2) The Safex product page
carries a "5 Year Comprehensive Warranty" line, but that line sits inside a features block that is
actually describing Safex's *modular* ceiling-mounted extinguishers (template bleed on their site), so
the stored SKU uses the retailer's 12 months and flags the discrepancy in `warranty_coverage`.

**Not found:** the three "Download Catalog" links on the product page are dead (`href="#"`), so there
is no datasheet or brochure. Only two official product images exist on the page (870 × 870 px, below
the pipeline's 1200 px bar); the remaining three image roles are `null`. Dimensions (height, diameter,
depth), operating temperature range and valve material are not published anywhere and are `ai_filled`.

---

## Newage Fire Protection — `FIR-NEW-CA-EB-01` ⚠ brand does not make extinguishers

**Official Indian domain:** `newagefireprotection.com` — confirmed manufacturer (NewAge Fire
Protection Industries Pvt. Ltd., 4 Champaklal Udyog Bhavan, Sion East, Mumbai; incepted 1961 per their
IndiaMART manufacturer profile; ISO 9001:2015 certified; star-rated export house). The site blocks
plain fetches with HTTP 403 and had to be read with a browser user-agent.

**The finding: NewAge manufactures no portable fire extinguisher.** This was checked four ways and
the answer was the same each time:

1. Their `product-sitemap.xml` lists **166 products**; the only matches for "extinguish" are
   `extinguisher-box` (a cabinet), `portable-spray-hose-nozzle` and `gfe-zeos-portable-programmer`.
2. Their 21 product categories are hoses, pumps, alarm panels, detectors, sounders, modules,
   accessories, valves, sprinklers, foam equipment, monitors, nozzles, cabinets, stand-post hydrants,
   couplings, dry-riser equipment and hose reels. There is no extinguisher category.
3. Their `/dry-chemical-powder-system/` page is a **fixed suppression system** page — no models, no
   capacities, no specifications.
4. Their `/approval-certifications/` page publishes BIS certificates for couplings and branch pipes,
   landing valves and water-foam monitors only. **No IS 15683 licence.** Their IndiaMART storefront
   lists "Fire Extinguisher AMC Service" — they *service* extinguishers, they do not build them.

No retailer anywhere lists a NewAge-branded portable extinguisher either. Inventing a model number
to fill the slot would breach the provenance law in `data/curated/SCHEMA.md` outright, so it was not
done.

**SKU chosen instead:** NewAge Extinguisher Box **CA-EB-01** — their one genuinely listed product in
the extinguisher family that carries real item codes and real dimensions.
**URL:** https://newagefireprotection.com/product/extinguisher-box/

**Why this one:** the product page publishes a six-row item table (CA-EB-01 to CA-EB-06) with sizes
and materials of construction — CA-EB-01 is 300 × 800 × 300 mm, single extinguisher, in mild steel,
stainless steel, FRP or polyethylene. It is a real, currently listed, code-bearing NewAge product,
and it is the accessory a buyer of the other two SKUs actually needs.

**Caveats on this file, all deliberate:**
- It is an **enclosure, not an extinguisher**. `product_type`, `capacity_kg`, `fire_rating`,
  `extinguishing_agent`, `discharge_time_s` and the whole pressure/flow group are **absent**, not
  guessed. Attribute fill is therefore 34/59 (58%), below the 80% target — the missing 42% are
  attributes the product genuinely does not have.
- `key_specs` still carries the category's standard eight keys for PDP consistency, so five of the
  eight rows will render blank. That blankness is the honest signal.
- No product photograph is published on the page (only the NewAge logo), so all five image roles are
  `null` and the pipeline will render flagged placeholders.
- No price is published; `price.provenance` is `estimated` with the basis noted.
- `hsn_code` is `7326` (steel article), not 8424, and `gst_needs_verification` is set.

**Recommended action before launch:** replace the third brand in
`registry/categories.json` for this category. Genuine ISI-licensed IS 15683 portable-extinguisher
manufacturers with live Indian product sites and published spec tables include **Kanex Fire**
(kanexfire.com — publishes full per-capacity spec tables), **Minimax**, **Omex** and **Safepro**.
Kanex is the closest like-for-like replacement and would give a well-documented third SKU immediately.
Move `FIR-NEW-CA-EB-01` to an accessories or cabinets category, where it is a perfectly good listing.

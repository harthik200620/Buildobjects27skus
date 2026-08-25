# Research brief — one category, three brands, three flagship SKUs

You are one of nine parallel research agents filling the catalogue of **Build Objects**, a
construction-products store for Andhra Pradesh / Telangana (India). You own ONE category.
Work from these contracts (read them first, fully):

- `C:\Users\HP\Desktop\buildobjects-store\services\pipeline\registry\SCHEMA.md` — attribute registry contract
- `C:\Users\HP\Desktop\buildobjects-store\services\pipeline\registry\groups.json` — the 20 fixed group keys
- `C:\Users\HP\Desktop\buildobjects-store\services\pipeline\registry\categories.json` — slugs, codes, brands, domains
- `C:\Users\HP\Desktop\buildobjects-store\services\pipeline\data\curated\SCHEMA.md` — curated SKU contract + provenance law

## Deliverables (write ONLY these paths; touch nothing else)
1. `services/pipeline/registry/{category-slug}.json` — the attribute registry (35–60 attributes). **Skip this file for `bulbs`** — its registry comes from the calendar sheet; use the key list in the Bulbs section below instead.
2. `services/pipeline/data/curated/{category-slug}/SELECTION.md` — per brand: official Indian domain (confirmed it is the manufacturer, not a marketplace), the SKU chosen, its URL, and one line on why it is the flagship / best-documented one.
3. `services/pipeline/data/curated/{category-slug}/{SKU_CODE}.json` × 3 — one per brand, exactly per SCHEMA.md.

## How to work
- Use WebSearch / WebFetch to find the official product page and datasheet of a real, currently listed model. **Do not invent model numbers** — pick from what the live site lists. If a site is unreachable, use a major Indian retailer listing (Amazon.in, IndiaMART, Moglix, Flipkart) as the source and say so in `source_url`.
- Budget: at most ~30 fetches in total. Do not paste long page dumps into your notes; extract the values you need and move on.
- Provenance is law (see SCHEMA.md): `fetched` only for values you actually read at `source_url`; `ai_filled` for industry-standard values you supply; never invent certificate / licence / test-report numbers; prices are `fetched` only from a listing you opened, else `estimated` with a note.
- Fill as many registry attributes as you can for each SKU (target ≥ 80% of the registry; `ai_filled` is allowed and expected for gaps, with honest confidence ≤ 0.7). Every attribute key you write MUST exist in the registry (or, for bulbs, in the key list below).
- Images: find 5 official image URLs per SKU (brand CDN / press kit / retailer listing as last resort), one per role. For each, run `curl -sIL --max-time 15 "<url>" | grep -iE "^(HTTP/|content-type|content-length)"` and set `checked: true` only on HTTP 200 + `image/*`. Prefer the largest available rendition (≥ 1200 px). If you cannot find an image for a role, set `source_url: null` (the pipeline renders a flagged placeholder).
- Documents: datasheet / brochure PDF URLs, HEAD-checked the same way (`application/pdf`).
- Descriptions: `short_description` ≤ 160 chars; `long_description` 250–450 words of markdown with the sections named in SCHEMA.md, grounded only in the attribute values you stored; `seo` with Telugu and Hindi keyword variants.
- Brand `intel`: fill all 19 leaves; `year_established` and `parent_company` should be `fetched` from the brand's about page or Wikipedia where possible.
- Validate every JSON file you write with `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <file>` and fix errors. Check: exactly 5 images in role order, exactly 8 `key_specs`, all attribute keys present in the registry, sku_code pattern `^[A-Z]{3}-[A-Z]{3}-[A-Z0-9-]{1,16}$`.

## Mandatory registry keys (all categories)
`dim_w_mm`, `dim_h_mm`, `dim_d_mm` (dimensions, number, "mm"), `net_weight_kg` (physical, number, "kg"),
`model_number` (product_identity, text), `country_of_origin` (product_identity, text), `is_standard` (standards, text),
`hsn_code` (commercial, text), `warranty_months` (warranty, number, "months").
Exactly 8 attributes `show_in_key_specs: true`; 2–3 `show_on_card: true`; 6–12 `is_filterable: true`.

## Category notes (standards and the attributes an Indian buyer checks first)
- **cement** — IS 269 (OPC 33/43/53 unified), IS 1489 Pt 1 (PPC), IS 455 (PSC); grade, type, 28-day compressive strength (MPa), initial/final setting time (min), fineness (m²/kg), soundness, bag weight 50 kg, shelf life, HSN 2523, GST 28%. Flagship = the brand's mainstream PPC or OPC 53 50 kg bag.
- **epoxy** — type (adhesive / flooring / grout / injection / repair mortar), mix ratio, pot life (min), cure time, compressive strength (MPa), bond strength, solids %, pack size (kg), coverage, IS/ASTM refs (ASTM C881, IS 9162, EN 1504). Pick a widely documented construction epoxy (e.g. Sika Sikadur, Fosroc Nitomortar/Conbextra EP, Dr. Fixit / Fevitite epoxy). HSN 3506/3907, GST 18%.
- **fire-extinguishers** — IS 15683 (portable), IS 2190 (selection/installation); type (ABC dry powder / CO2 / foam / water / clean agent), capacity (kg/L), fire rating (e.g. 2A 21B, 4A 34B), working pressure (bar), discharge time/range, cylinder material, ISI mark, height/diameter, weight, wall-mount bracket. Flagship = the 4 kg or 6 kg ABC stored-pressure model. HSN 8424, GST 18%.
- **solar-panels** — IEC 61215 / IEC 61730, BIS IS 14286, ALMM listing; Wp, cell type (mono PERC / TOPCon / bifacial), cells count, efficiency %, Vmp/Imp/Voc/Isc, temp coefficient of Pmax (%/°C), frame, glass thickness, dimensions (mm), weight, junction box IP, connector (MC4), warranty (product yrs / performance yrs), NOCT. Flagship = the brand's mainstream 540–585 Wp module. HSN 8541, GST 12%.
- **cctv** — resolution (MP), sensor, lens (mm), IR range (m), form factor (dome/bullet/turret), IP rating (IP66/67), IK rating, codec (H.265+), WDR (dB), PoE / 12 V DC, ONVIF, storage slot, audio, colour night vision, operating temp, dimensions, weight, BIS CRS registration. Flagship = the best-selling 2 MP / 4 MP IP dome or bullet (or HD analogue if that is the India hero). HSN 8525, GST 18%.
- **tiles** — IS 15622 / ISO 13006 group (BIa / BIIa …), type (vitrified / ceramic / porcelain), body (double charge, GVT, PGVT), size (mm), thickness, water absorption %, PEI abrasion class, MOHS, breaking strength (N), slip resistance (R rating / DCOF), finish (glossy / matt / satin), rectified, pieces per box, coverage per box (sqft), usage (floor / wall), weight per box. Flagship = the brand's 600×600 or 600×1200 GVT/PGVT floor tile line. HSN 6907, GST 18%.
- **glass** — IS 2553 Pt 1 (safety glass), IS 14900 (float), IS 16231 (IGU); type (clear float / toughened / laminated / insulated / reflective / low-E), thickness (mm), VLT %, SHGC, U-value (W/m²K), sound insulation (dB), max size, edge work, tint/colour, safety class. Flagship = a mainstream 6 mm / 8 mm toughened or a named solar-control/low-E product line. HSN 7005/7007, GST 18%.
- **total-stations** — angular accuracy ("), distance accuracy (mm + ppm), reflectorless range (m), prism range (m), EDM type, compensator, magnification (x), display, keyboard, battery life (h), memory, connectivity (Bluetooth / USB / Wi-Fi), IP rating, operating temp, weight, tripod thread 5/8". Flagship = the brand's mainstream manual total station sold in India (e.g. Leica FlexLine TS07/TS10, Trimble C3/C5, Topcon GM-50 / ES series). HSN 9015, GST 18%.
- **bulbs** — IS 16102 Pt 1/2 (self-ballasted LED), IS 10322 Pt 5, BEE star rating; wattage (W), lumens (lm), efficacy (lm/W), CCT (K), CRI, beam angle (°), base (B22 / E27 / E14), voltage range (V AC), power factor, dimmable, life (h), switching cycles, surge protection (kV), dimensions (mm), weight (g), warranty. Flagship = the brand's hero 9 W B22 LED bulb (Philips Ace Saver / Stellar Bright, Havells Adore / Lumeno, Wipro Garnet / Tejas). HSN 8539, GST 12%.

## Bulbs: use these attribute keys (sheet labels slugified) + the mandatory keys
product_identity: product_type, model_number, series, bulb_type, led_type, base_type, wattage, voltage, frequency, lumens, colour_temperature, beam_angle, colour_rendering_index, dimmability, shape, size, power_factor, product_code, energy_rating, country_of_origin, application_category, operating_type, smart_compatibility ·
material: aluminium_housing, polycarbonate_diffuser, led_chip_material, pcb_material, diffuser_material, aluminium_heat_sink, brass_base, flame_retardant_plastic ·
manufacturing: led_chip_mounting, driver_assembly, lumen_testing, burn_in_testing ·
dimensions: overall_height, overall_diameter, bulb_diameter, base_diameter, product_weight, package_dimensions, dim_w_mm, dim_h_mm, dim_d_mm ·
temperature: operating_temperature, storage_temperature, ambient_temperature, led_junction_temperature ·
mechanical: impact_resistance, vibration_resistance · chemical: corrosion_resistance, uv_resistance ·
physical: luminous_flux, efficacy, operating_life, switching_cycles, flicker_level, power_consumption, luminous_intensity, heat_dissipation, weight, net_weight_kg ·
joining: screw_base_connection · application: residential, commercial, office, outdoor (booleans) ·
flow: rated_current, input_current, inrush_current · hygiene: dust_resistance ·
standards: is_16102, is_16103, iec_62560, bis, isi, bee, rohs, lm_79, lm_80, ip_rating, is_standard ·
quality_control: lumen_test, flicker_test, endurance_test · appearance: surface_finish, colour_uniformity, diffuser_clarity ·
installation: socket_compatibility, voltage_compatibility, mounting_orientation, dimmer_compatibility, installation_height ·
packaging: individual_packaging, carton_box, barcode_labeling · commercial: product_price, bulk_price, dealer_price, minimum_order_quantity, availability, delivery_time, retail_price, hsn_code ·
warranty: warranty_period, product_warranty, led_warranty, warranty_claim_procedure, warranty_coverage, warranty_months.
Numeric ones (wattage, lumens, colour_temperature, beam_angle, colour_rendering_index, power_factor, overall_height, overall_diameter, bulb_diameter, base_diameter, product_weight [g], efficacy, operating_life [h], switching_cycles, rated_current [mA], warranty_months, dim_*, net_weight_kg) must be JSON numbers. `dimmability` and the application booleans are true/false. Bulbs key_specs: wattage, lumens, colour_temperature, base_type, colour_rendering_index, operating_life, energy_rating, warranty_months.

## Final message
Reply with a compact report only: the 3 SKU codes + product names + official URLs, the fetch success per source, counts of fetched / verified / ai_filled attributes per SKU, how many image URLs passed the HEAD check per SKU, which documents were found, and anything you could not find. No file contents.

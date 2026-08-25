# Curated SKU file — `data/curated/{category-slug}/{SKU_CODE}.json`

A curated file is the **fixture provider** for the agentic pipeline: when `ANTHROPIC_API_KEY`
is absent the Extract/Verify/Fill/Describe stages read these files instead of calling the
model; when the key is present the live stages run and these files are only used as the
"secondary source" for verification. They therefore carry the SAME provenance discipline
as live extraction.

## Provenance law (non-negotiable)
- `fetched`  — you actually read this value on the named `source_url` (official brand page / datasheet / BIS listing / major Indian retailer).
- `verified` — you read it on TWO independent sources that agree (both URLs in `source_urls`).
- `ai_filled` — you did not read it anywhere; it is your industry-standard plausible value for this exact product class. Confidence ≤ 0.7.
- NEVER invent BIS/ISI licence numbers, CM/L numbers, test-report numbers or certificate numbers. If you did not read one, leave that attribute out.
- Prices: `price.provenance` is `fetched` ONLY with a real listing/MRP URL you opened; otherwise `estimated` with a one-line `note` on the basis (e.g. "typical Hyderabad dealer rate Aug 2026, ±10%").
- Never mark `ai_filled` data as `verified`.

```jsonc
{
  "sku_code": "CEM-ULT-PPC50",                  // {CATEGORY.code}-{BRAND.code}-{MODEL}  (A–Z 0–9 and hyphens only, ≤ 24 chars)
  "category": "cement",                         // slug
  "brand": {
    "slug": "ultratech", "name": "UltraTech Cement",
    "official_domains": ["ultratechcement.com"],
    "logo_url": "https://…/logo.svg",           // official logo if found (svg/png), else null
    "intel": {                                  // the DAY-1 brand-intelligence block; every leaf = {value, provenance, source_url}
      "year_established":        { "value": 1983, "provenance": "fetched", "source_url": "https://…" },
      "parent_company":          { "value": "Aditya Birla Group", "provenance": "fetched", "source_url": "https://…" },
      "product_portfolio":       { "value": "OPC, PPC, PSC, white cement, RMC, …", "provenance": "ai_filled", "source_url": null },
      "market_coverage":         { "value": "Pan-India; ~150 MTPA capacity", "provenance": "…", "source_url": "…" },
      "quality_strength_note":   { "value": "…", "provenance": "ai_filled", "source_url": null },
      "engineer_user_rating":    { "value": "4.5/5 (typical)", "provenance": "ai_filled", "source_url": null },
      "contractor_preference":   { "value": "…", "provenance": "ai_filled", "source_url": null },
      "novice_preference":       { "value": "…", "provenance": "ai_filled", "source_url": null },
      "price_band":              { "value": { "lowest": 360, "highest": 460, "unit": "₹/bag" }, "provenance": "estimated", "source_url": null },
      "project_vs_retail_cost_note": { "value": "…", "provenance": "ai_filled", "source_url": null },
      "bulk_discount_note":      { "value": "…", "provenance": "ai_filled", "source_url": null },
      "dealer_margin_note":      { "value": "…", "provenance": "ai_filled", "source_url": null },
      "building_type_strengths": { "value": { "individual_houses": "strong", "low_rise": "strong", "mid_rise": "strong", "high_rise": "strong", "skyscrapers": "moderate", "roads": "moderate", "bridges": "strong", "dams_metro": "strong" }, "provenance": "ai_filled", "source_url": null },
      "region_strengths":        { "value": { "strong": "Pan-India", "weak": "—", "balanced": "South", "rural": "strong", "urban": "strong" }, "provenance": "ai_filled", "source_url": null },
      "primary_use":             { "value": "…", "provenance": "ai_filled", "source_url": null },
      "secondary_use":           { "value": "…", "provenance": "ai_filled", "source_url": null },
      "special_use":             { "value": "…", "provenance": "ai_filled", "source_url": null },
      "top_preference_order":    { "value": ["UltraTech", "ACC", "Ambuja"], "provenance": "ai_filled", "source_url": null }
    }
  },
  "product": { "name": "UltraTech PPC Cement", "slug": "ultratech-ppc-cement", "model_no": "PPC", "status": "active" },
  "variant_label": "50 kg bag",
  "unit": "bag", "pack_qty": 1,                 // unit of sale and how many units per pack
  "price": { "mrp": 420, "selling_price": 395, "currency": "INR", "provenance": "estimated", "source_url": null, "fetched_at": "2026-08-22", "note": "…" },
  "gst_rate": 28,                               // current GST % for this HSN; add "gst_needs_verification": true if unsure
  "sources": {
    "official_product_url": "https://…",        // the page the SKU was selected from (REQUIRED, must be the manufacturer)
    "datasheet_urls": ["https://…pdf"],
    "secondary_urls": ["https://…"]             // retailer listing / BIS / press
  },
  "attributes": {                               // key → value object; keys come from registry/{category}.json
    "cement_type": { "value": "PPC", "provenance": "fetched", "source_url": "https://…", "confidence": 0.98 },
    "compressive_strength_28d": { "value": 43, "unit": "MPa", "provenance": "fetched", "source_url": "https://…", "confidence": 0.9 },
    "dim_w_mm": { "value": 520, "provenance": "ai_filled", "source_url": null, "confidence": 0.6 }
    // numbers as JSON numbers, booleans as true/false, enums/text as strings
  },
  "images": [                                   // 5 entries, one per role, in this order
    { "role": "hero",               "source_url": "https://…/pack.png", "alt": "UltraTech PPC 50 kg bag, front", "content_type": "image/png", "bytes": 412000, "checked": true },
    { "role": "angle",              "source_url": "…", "alt": "…", "checked": true },
    { "role": "in_context",         "source_url": "…", "alt": "…", "checked": false },
    { "role": "detail",             "source_url": "…", "alt": "…", "checked": false },
    { "role": "pack_or_dimensions", "source_url": "…", "alt": "…", "checked": false }
    // source_url may be null when nothing official was found; the pipeline then renders a flagged placeholder
  ],
  "documents": [
    { "type": "datasheet", "title": "UltraTech PPC technical data sheet", "source_url": "https://…pdf", "checked": true }
  ],
  "key_specs": ["cement_type", "grade", "compressive_strength_28d", "setting_time_initial", "fineness", "is_standard", "net_weight_kg", "shelf_life_months"],   // exactly 8 registry keys, buyer-priority order
  "short_description": "≤ 160 chars, card-ready, no marketing fluff",
  "long_description": "Markdown. 250–450 words. Sections: What it is · What it's for · Key specifications (woven prose) · Application / installation notes · What's in the box. Grounded ONLY in the attribute values above — no new numbers or claims.",
  "seo": { "title": "≤ 60 chars", "meta_description": "≤ 155 chars", "keywords": ["…", "…"], "keywords_te": ["…"], "keywords_hi": ["…"] }
}
```

`images[].checked: true` means you ran `curl -sI <url>` and saw HTTP 200 with an `image/*`
content-type. The pipeline re-checks, downloads, measures and rejects anything < 1200 px wide.

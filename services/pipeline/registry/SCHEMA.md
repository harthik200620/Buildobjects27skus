# Attribute registry — `registry/{category-slug}.json`

One file per category. It is DATA, not code: it drives PDP layout, key-spec ordering,
the automatic filter engine, Meilisearch attributes and the extraction schema handed to
the LLM. Groups come from `groups.json` (the calendar sheet's heading system) — use ONLY
those 20 group keys. A group with no sensible attributes for the category is simply left
without attributes (it auto-hides).

```jsonc
{
  "category": "cement",                 // slug from categories.json
  "version": 1,
  "attributes": [
    {
      "key": "cement_type",             // snake_case, unique within the category, stable forever
      "group": "product_identity",      // one of the 20 group keys in groups.json
      "label": "Cement type",           // customer-readable, Indian-market wording
      "data_type": "enum",              // text | number | boolean | enum
      "unit": null,                     // for number: "W", "lm", "K", "mm", "kg", "MPa", "%", "h", "months", "₹"… else null
      "enum_values": ["OPC 43", "OPC 53", "PPC", "PSC"],   // enum only; omit otherwise
      "is_filterable": true,
      "filter_widget": "checkbox",      // checkbox (enum/text) | range (number) | toggle (boolean) | chips (short enum)
      "filter_order": 1,                // lower = higher in the rail; only meaningful if is_filterable
      "importance_rank": 1,             // 1 (a buyer checks this first) … 5 (trivia). Drives Show-More order and fill priority
      "show_in_key_specs": true,        // the ~8 rows of the PDP "Key details" table — exactly 8 per category
      "show_on_card": true,             // 2–3 per category: the spec chips on the product card
      "compare": true,                  // the sheet's "Comparison engine" column: attributes worth comparing across brands
      "synonyms": ["grade", "type of cement", "సిమెంట్ రకం"],   // search + filter matching; include Telugu/Hindi where natural
      "display_order": 1                // order inside the group
    }
  ]
}
```

## Rules
- 35–60 attributes per category, spread across the groups the way the calendar sheet does it
  (identity, material, manufacturing, dimensions, mechanical, physical, application, standards,
  appearance, installation, packaging, commercial, warranty always get something; pressure / flow /
  hygiene / joining / temperature / chemical / quality_control only where the product really has them).
- Correct Indian-market units and standards (IS / BIS / IEC / ISO refs as attributes of the
  `standards` group, e.g. `is_standard` = "IS 1489 (Part 1)").
- Exactly 8 attributes with `show_in_key_specs: true`, 2–3 with `show_on_card: true`,
  6–12 with `is_filterable: true`.
- **Mandatory keys in every category** (the AR engine and cards read them):
  - `dim_w_mm`, `dim_h_mm`, `dim_d_mm` — number, unit "mm", group `dimensions`: the physical
    bounding box of ONE unit as a customer would hold/place it (a bulb: diameter × height × diameter;
    a tile: width × length × thickness; a cement bag: bag length × height × thickness; a panel: W × H × frame depth).
    Labels can be natural ("Width", "Height", "Depth / thickness").
  - `net_weight_kg` — number, unit "kg", group `physical` (or `packaging`).
  - `model_number` — text, group `product_identity`.
  - `country_of_origin` — text, group `product_identity`.
  - `is_standard` — text, group `standards` (the governing IS/IEC standard string).
  - `hsn_code` — text, group `commercial`.
  - `warranty_months` — number, unit "months", group `warranty`.
- Keys never change once shipped; add new ones instead.

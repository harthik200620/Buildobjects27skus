/**
 * Display labels for a SKU.
 *
 * The search document's `name` is not a name. It is the product title with `variant_label`
 * already concatenated onto the end of it:
 *
 *   name          "Wipro Garnet 9 W B22 Cool Day White LED Bulb 9 W · B22 · 6500 K cool day white · single lamp"
 *   variant_label "9 W · B22 · 6500 K cool day white · single lamp"
 *   brand         "Wipro Lighting"
 *
 * Printed whole, next to a brand chip that has already said "Wipro Lighting", that is a
 * ninety-character string which says the wattage three times. It is what made the home page's
 * stock strip read as a database dump: every row was the same four facts in a different order.
 *
 * These two functions take the string apart again for display only. Neither touches the data —
 * the full `name` stays the search key, the page title and the accessible name.
 */

/** The brand's first word, which is the part that actually prefixes a product title. */
function brandPrefix(brand: string): string {
  return brand.split(/[\s(]/)[0] ?? '';
}

/**
 * The title with the variant suffix and the brand prefix removed:
 *
 *   "Wipro Garnet 9 W B22 Cool Day White LED Bulb 9 W · B22 · …"  →  "Garnet 9 W B22 Cool Day White LED Bulb"
 *   "UltraTech Portland Pozzolana Cement (PPC) 50 kg bag"          →  "Portland Pozzolana Cement (PPC)"
 *
 * Both trims are conditional. A brand whose first word does not open the title — Pidilite, whose
 * products are all called "Dr. Fixit …" — keeps its title untouched rather than losing a word off
 * the front of it. Never returns an empty string: if trimming would leave nothing, the original
 * comes back whole.
 */
export function skuTitle(name: string, brand: string, variantLabel?: string | null): string {
  let out = name;
  if (variantLabel && out.endsWith(variantLabel)) out = out.slice(0, -variantLabel.length).trim();
  const prefix = brandPrefix(brand);
  if (prefix.length > 2 && out.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) out = out.slice(prefix.length).trim();
  return out || name;
}

/**
 * The short form of the variant, for a line under the title.
 *
 * A variant label runs to five middle-dot-separated clauses — "9 W · B22 · 6500 K cool day white ·
 * single lamp" — and the first two are the ones that identify the item on a shelf. The rest is
 * specification, and the specification has its own sheet.
 */
export function skuVariant(variantLabel: string | null | undefined, clauses = 2): string {
  if (!variantLabel) return '';
  return variantLabel
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, clauses)
    .join(' · ');
}

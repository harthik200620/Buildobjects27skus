/**
 * Display labels for a SKU.
 *
 * The search document's `name` is not a name. It is the product title with `variant_label` already
 * concatenated onto the end of it:
 *
 *   name          "Wipro Garnet 9 W B22 Cool Day White LED Bulb 9 W · B22 · 6500 K cool day white · single lamp"
 *   variant_label "9 W · B22 · 6500 K cool day white · single lamp"
 *   brand         "Wipro Lighting"
 *
 * Printed whole, next to a brand chip that has already said "Wipro Lighting", that is a
 * ninety-character string which says the wattage three times — what made the home page's stock
 * strip read as a database dump, every row the same four facts in a different order.
 *
 * These functions take the string apart for display only; neither touches the data, so the full
 * `name` stays the search key, the page title and the accessible name. `withoutBrand` and
 * `productTitle` live here too, having briefly had their own module: two modules answering "how do
 * we print a brand and a name without saying the brand twice" is one module too many.
 */

/** The name with the brand taken off the front, when it is already there. */
export function withoutBrand(name: string, brand: string): string {
  const b = brand.trim();
  const n = name.trim();
  if (!b) return n;
  if (n.toLowerCase().startsWith(`${b.toLowerCase()} `)) return n.slice(b.length).trim();
  /* Brands whose full name is longer than the prefix the product uses: "UltraTech Cement"
     against "UltraTech Portland Pozzolana Cement". Guarded on length so a two- or three-letter
     head — "ACC", "TVS" — can never eat the start of an unrelated word. */
  const first = b.split(/\s+/)[0];
  if (first.length > 3 && n.toLowerCase().startsWith(`${first.toLowerCase()} `)) return n.slice(first.length).trim();
  return n;
}

/**
 * The full title, brand included exactly once: "ACC Suraksha Power Cement".
 *
 * Use this anywhere the product is being NAMED — a heading, a breadcrumb, a link, a page title.
 * Where brand and name are styled separately, use `withoutBrand` and set the brand yourself.
 */
export function productTitle(brand: string, name: string): string {
  const b = brand.trim();
  const rest = withoutBrand(name, b);
  /* When the name IS the brand — a supplier whose product is filed under its own name and nothing
     else — `withoutBrand` has nothing to take off and returns it whole, and gluing the two gave
     "ACC ACC": the exact fault this function exists to prevent, in the one case nobody tests by
     hand. Caught by the catalogue test rather than by reading it. */
  if (!b) return rest;
  if (!rest || rest.toLowerCase() === b.toLowerCase()) return b;
  return `${b} ${rest}`;
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
  /* One rule for taking a brand off the front, shared with the room view, the breadcrumbs and the
     estimator's picks — see withoutBrand above. This used to have its own, matching only the
     brand's first word and only when that word was longer than two characters, which is a second
     answer to a question that already had one. */
  return withoutBrand(out, brand) || name;
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

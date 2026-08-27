/**
 * Printing a product's brand and its name next to each other, without saying the brand twice.
 *
 * TWENTY-FIVE OF THE TWENTY-SEVEN products in this catalogue are named with their own brand at
 * the front — brand "ACC", name "ACC Suraksha Power Cement"; brand "UltraTech Cement", name
 * "UltraTech Portland Pozzolana Cement". That is how the supplier writes them and how the
 * workbook records them, so it is not a data error to be cleaned up; it is a fact about the data
 * that every surface printing both fields has to know.
 *
 * The obvious `{brand} {name}` was in six places and produced "ACC ACC Suraksha Power Cement" in
 * a breadcrumb, in an <h1>, in the room view's title bar and in the estimator's picks. The room
 * view's HUD had a private fix for it; nothing else did. One function now, so a surface gets this
 * right by calling it rather than by remembering.
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
  return b && rest ? `${b} ${rest}` : rest || b;
}

/**
 * WHICH CATEGORY THE CUSTOMER JUST NAMED — decided in code, not by the model.
 *
 * The system prompt tells the assistant to look up anything it is not certain about, and a prompt
 * is a request. The same build answered "Solar Panels are coming soon" in production — with three
 * panels in stock — and answered the same question correctly on a laptop thirty seconds earlier.
 * That is model variance, and no amount of rewording removes it. So the two decisions that must
 * not be got wrong are made here instead:
 *
 *   a stocked category was named   → the assistant is not allowed to answer from memory
 *   an unstocked one was named     → the tool result says so, in the place the model is looking
 *
 * Matched on the words of the category's own name, so a category added tomorrow is covered
 * tomorrow and there is no keyword list to keep in step with the catalogue.
 */

/** Words that turn up in every shopping question — "total" would make any question about a total one about Total Stations. */
const SHOPPING_WORDS = new Set(['total', 'price', 'cost', 'item', 'items', 'store', 'order', 'stock']);

/** The plural fold the snapshot search uses, for the same reason: "panels" must find Panel. */
export const fold = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export interface RoutedCategory {
  name: string;
  status: 'live' | 'upcoming';
}

/**
 * The categories of `status` whose name appears in `message`, in catalogue order.
 *
 * WHOLE WORDS, NOT SUBSTRINGS. The first cut asked whether the message CONTAINED the category
 * word, and "reinforcement" contains "cement" — so "any steel reinforcement?" routed to Cement and
 * would have had the assistant answer a question about steel with three bags of cement. Comparing
 * folded tokens on both sides costs one Set and cannot match inside a word.
 */
export function categoriesNamed(message: string, cats: RoutedCategory[], status: 'live' | 'upcoming'): string[] {
  const said = new Set(
    message
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(fold),
  );
  const out: string[] = [];
  for (const c of cats) {
    if (c.status !== status) continue;
    for (const w of c.name.toLowerCase().split(/[^a-z0-9]+/)) {
      /* Short words carry no signal and the shopping words carry the wrong one. */
      if (w.length < 4 || SHOPPING_WORDS.has(w)) continue;
      if (said.has(fold(w))) {
        out.push(c.name);
        break;
      }
    }
  }
  return out;
}

/** The first stocked category named, or null. What the engine's nudge hangs off. */
export const shelfCategoryNamed = (message: string, cats: RoutedCategory[]): string | null => categoriesNamed(message, cats, 'live')[0] ?? null;

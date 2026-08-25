import React from 'react';

/**
 * Renders Meilisearch's highlighted field (`_formatted.*`) without handing raw HTML to the DOM.
 *
 * Meili does not escape the source value — it splices the configured pre/post tags into whatever
 * the document holds. So a product name containing markup would be injected verbatim by a
 * `dangerouslySetInnerHTML`, which is what both call sites used to do. The only markup Meili is
 * asked to insert is the `<mark>` pair below, so the string can be split on exactly those and
 * re-emitted as React elements: the matched runs become real `<mark>` nodes and everything else
 * stays text, which React escapes.
 *
 * Keep these two constants in step with `highlightPreTag` / `highlightPostTag` in lib/catalog.
 */
const PRE = '<mark class="hl">';
const POST = '</mark>';

/** Splits a highlighted string into plain and matched runs, in order. */
export function parseHighlight(formatted: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let rest = formatted;

  while (rest.length > 0) {
    const start = rest.indexOf(PRE);
    if (start === -1) break;

    const end = rest.indexOf(POST, start + PRE.length);
    if (end === -1) break;

    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    parts.push({ text: rest.slice(start + PRE.length, end), match: true });
    rest = rest.slice(end + POST.length);
  }

  if (rest.length > 0) parts.push({ text: rest, match: false });
  return parts;
}

export default function Highlight({ formatted, fallback }: { formatted: string | undefined | null; fallback: string }) {
  if (!formatted) return <>{fallback}</>;
  return (
    <>
      {parseHighlight(formatted).map((part, i) =>
        part.match ? (
          // Index is the identity here: the runs are positional slices of one string.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional slices of a single string
          <mark key={i} className="hl">
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional slices of a single string
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

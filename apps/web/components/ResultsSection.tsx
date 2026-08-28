/**
 * The results region on the listing and search pages.
 *
 * A heading, not just a label. Product titles are h3, and on a phone the facet rail — whose
 * section headings are the h2s — is behind a sheet and not in the document, so the outline went
 * h1 straight to h3. `aria-label` names a landmark but does not put a rung on the ladder; a
 * heading does both, and this one is for screen readers only because the count above it already
 * says it on screen. Shared so the two pages cannot answer that differently.
 */
export default function ResultsSection({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Results">
      <h2 className="visually-hidden">Results</h2>
      {children}
    </section>
  );
}

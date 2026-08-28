import type { SkuPageData } from '@/lib/catalog';
import { mediaUrl } from '@/lib/media';

/**
 * `engineer_user_rating` is deliberately absent. It holds strings like "4.6/5 (typical among
 * structural and repair consultants)" at provenance `ai_filled` — a number nobody measured,
 * and a number in a row labelled "Engineer rating" reads as a survey result whatever the
 * tooltip says. The remaining rows are either fetched facts (founding year, parent, coverage)
 * or hedged qualitative notes that read as the judgements they are.
 */
const LEAVES: { key: string; label: string }[] = [
  { key: 'year_established', label: 'Established' },
  { key: 'parent_company', label: 'Parent' },
  { key: 'market_coverage', label: 'Market coverage' },
  { key: 'quality_strength_note', label: 'Quality & strength' },
  { key: 'contractor_preference', label: 'Contractor preference' },
  { key: 'novice_preference', label: 'First-time builders' },
  { key: 'primary_use', label: 'Primary use' },
  { key: 'bulk_discount_note', label: 'Bulk discounts' },
];

function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(text).join(', ');
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k.replace(/_/g, ' ')}: ${text(x)}`)
      .join(' · ');
  return String(v);
}

/** Brand strip: logo + the DAY-1 brand-intelligence highlights, each with its provenance on hover. */
/**
 * Cut long reference prose to a card's worth, at a word.
 *
 * This was `.slice(0, 160)`, which cuts wherever the 161st character happens to fall and says
 * nothing about having done it. On the phone it rendered "…giving dense concrete with lower heat
 * of hydr" — a sentence that stops mid-word, which reads as a bug rather than as an abridgement,
 * because it is one.
 *
 * Back up to the last space and mark it. If a single word runs past the limit — a URL, a part
 * number — the hard cut is the only option left, and the ellipsis still says so.
 */
function abridge(value: string, limit = 160): string {
  const v = value.trim();
  if (v.length <= limit) return v;
  const cut = v.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

export default function BrandStrip({ brand }: { brand: SkuPageData['brand'] }) {
  const rows = LEAVES.map((l) => ({ ...l, leaf: brand.intel[l.key] })).filter(
    (r) => r.leaf && r.leaf.value !== null && r.leaf.value !== undefined && text(r.leaf.value) !== '',
  );
  const logo = mediaUrl(brand.logoKey);
  return (
    <div className="glass-card brand-strip" style={{ borderRadius: 'var(--r-2)' }}>
      <div>
        <div className="brand-logo">
          {logo ? <img src={logo} alt={`${brand.name} logo`} /> : <span className="fig font-semibold text-[16px]">{brand.name}</span>}
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--ink-3)' }}>
          {brand.domains[0] ? (
            <a href={`https://${brand.domains[0]}`} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
              {brand.domains[0]}
            </a>
          ) : (
            brand.name
          )}
        </p>
      </div>
      <div className="intel-grid">
        {rows.length === 0 && <p style={{ color: 'var(--ink-3)' }}>Brand intelligence arrives with the next ingest.</p>}
        {rows.map((r) => (
          <div key={r.key} title={`${r.leaf.provenance}${r.leaf.source_url ? ` · ${r.leaf.source_url}` : ''}`}>
            <div className="intel-k">{r.label}</div>
            <div className="intel-v">{abridge(text(r.leaf.value))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

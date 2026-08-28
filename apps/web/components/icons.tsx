/* The Build Objects icon set — bespoke, because a stock icon pack is the fastest way for a
   visitor to file a site under "template".

   THE GRAMMAR. Five rules; an icon that breaks one does not belong in the family.

   1. GRID          24x24. Art lives inside 3 -> 21, never touching the edge.
   2. STROKE        1.75, uniform. A toolbar where one glyph is bolder reads as a mistake before
                    it reads as emphasis.
   3. CORNERS       Butt caps, miter joins, and a 4.6-unit 45-degree chamfer on the top-right of
                    every container shape. This is the signature: rounded corners are what every
                    icon pack does, a chamfer is what a drafting pen does, and it is the one
                    detail that survives at 16px.
   4. ACCENT        Exactly one element per icon carries `.ic-a` — never two — so the eye lands in
                    the same place on every glyph and a row has rhythm instead of noise.
   5. OPTICAL SIZE  Drawn for 20px. 16px strokes up to 1.9 and 28px+ down to 1.6, because a 1.75
                    stroke correct at 20 is spindly at 16 and heavy at 32.

     <IconCement size={20} />                          accent inherits the brand teal
     <IconCement size={20} accent="none" />            monochrome, for dense tables
     <IconCoin size={20} accent="var(--amber-700)" />  the coin owns amber

   The stylesheet needs `.ic-a { color: var(--icon-accent, currentColor); }` once.

   CATEGORY_ICONS, CategoryIcon, SPEC_GROUP_ICONS and SpecGroupIcon are at the foot of this file:
   eight call sites render a mark from a string that comes out of the database. */

import type React from 'react';

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Rendered size in CSS pixels. Drawn for 20; stroke compensates outside 18–26. */
  size?: number;
  /** Accent colour for the one `.ic-a` element. `'none'` makes the icon monochrome. */
  accent?: string;
  /** Given a label, the icon becomes an image to assistive tech instead of decoration. */
  title?: string;
}

/** Optical stroke compensation. Below 18px a 1.75 stroke disappears; above 26 it
 *  reads as a drawing rather than an icon. Two linear corrections, clamped. */
function strokeFor(size: number): number {
  if (size <= 16) return 1.95;
  if (size >= 32) return 1.5;
  if (size >= 26) return 1.6;
  return 1.75;
}

function Ico({ size = 20, accent, title, children, style, ...rest }: IconProps & { children: React.ReactNode }) {
  const monochrome = accent === 'none';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{
        flex: 'none',
        ...(monochrome ? { ['--icon-accent' as string]: 'currentColor' } : accent ? { ['--icon-accent' as string]: accent } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── shared geometry ──────────────────────────────────────────────────────────
   Two primitives every container in the set is built from, so a box in one icon
   is the same box in every other. The chamfer constant is 4.6 units. */
const BOX = 'M3.5 4h11.9L20.5 9.1V20H3.5z'; //  chamfered container, top-right cut, 4.6 units

/* ═══════════════════════════════════════════════════════════════════════════════
   1. CHROME — navigation, state, controls
   ═══════════════════════════════════════════════════════════════════════════════ */

export const IconCheck = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 12.6 9.2 18 20 6.4" />
  </Ico>
);

export const IconCheckCircle = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-3.2-6.65" />
    <path className="ic-a" d="M7.8 12.2 11 15.6 20.8 5.4" />
  </Ico>
);

export const IconInfo = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z" />
    <path className="ic-a" d="M12 11.2v5.2" />
    <path d="M12 7.6v1" />
  </Ico>
);

export const IconClose = (p: IconProps) => (
  <Ico {...p}>
    <path d="M5.2 5.2 18.8 18.8" />
    <path className="ic-a" d="M18.8 5.2 5.2 18.8" />
  </Ico>
);

export const IconBack = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20 12H4.4" />
    <path className="ic-a" d="M10.4 5.6 4 12l6.4 6.4" />
  </Ico>
);

export const IconArrow = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 12h15.6" />
    <path className="ic-a" d="M13.6 5.6 20 12l-6.4 6.4" />
  </Ico>
);

export const IconChevron = (p: IconProps) => (
  <Ico {...p}>
    <path className="ic-a" d="M9 4.8 16.2 12 9 19.2" />
  </Ico>
);

export const IconChevronDown = (p: IconProps) => (
  <Ico {...p}>
    <path className="ic-a" d="M4.8 9 12 16.2 19.2 9" />
  </Ico>
);

export const IconChevronUp = (p: IconProps) => (
  <Ico {...p}>
    <path className="ic-a" d="M4.8 15 12 7.8 19.2 15" />
  </Ico>
);

/* The menu is three rules of a drawing sheet, not three equal bars — the short
   one is the accent and it is where the eye lands. */
export const IconMenu = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 6.6h16.8" />
    <path className="ic-a" d="M3.6 12h10.4" />
    <path d="M3.6 17.4h16.8" />
  </Ico>
);

/* Search is a lens over a drawing, so the handle is a dimension leader, not a stick. */
export const IconSearch = (p: IconProps) => (
  <Ico {...p}>
    <path d="M18 10.6a7.4 7.4 0 1 1-14.8 0 7.4 7.4 0 0 1 14.8 0Z" />
    <path className="ic-a" d="m15.9 15.9 4.7 4.7" />
  </Ico>
);

export const IconFilter = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 6.8h16.8M3.6 12h16.8M3.6 17.2h16.8" />
    <path className="ic-a" d="M8.6 4.8v4M15.4 10v4M11 15.2v4" />
  </Ico>
);

export const IconPlus = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 4.4v15.2" />
    <path className="ic-a" d="M4.4 12h15.2" />
  </Ico>
);

export const IconMinus = (p: IconProps) => (
  <Ico {...p}>
    <path className="ic-a" d="M4.4 12h15.2" />
  </Ico>
);

export const IconRefresh = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path className="ic-a" d="M20.4 3.6v4.8h-4.8" />
  </Ico>
);

export const IconRotateLeft = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path className="ic-a" d="M3.6 3.6v4.8h4.8" />
  </Ico>
);

export const IconRotateRight = IconRefresh;

export const IconMove = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 3.4v17.2M3.4 12h17.2" />
    <path className="ic-a" d="M9.4 6 12 3.4 14.6 6M18 9.4 20.6 12 18 14.6M14.6 18 12 20.6 9.4 18M6 14.6 3.4 12 6 9.4" />
  </Ico>
);

export const IconExternalWorks = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12.4 4H4v16h16v-8.4" />
    <path className="ic-a" d="M13.6 10.4 20.4 3.6M15.2 3.6h5.2v5.2" />
  </Ico>
);

/* ═══════════════════════════════════════════════════════════════════════════════
   2. ACCOUNT, TRUST, TRANSACTION
   ═══════════════════════════════════════════════════════════════════════════════ */

export const IconUser = (p: IconProps) => (
  <Ico {...p}>
    <path d="M15.6 8.2a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 0 1 7.2 0Z" />
    <path className="ic-a" d="M4.4 20.4v-1.6c0-2.8 3.4-5 7.6-5s7.6 2.2 7.6 5v1.6" />
  </Ico>
);

export const IconLogout = (p: IconProps) => (
  <Ico {...p}>
    <path d="M9.6 4H4v16h5.6" />
    <path d="M20 12H9.2" />
    <path className="ic-a" d="M15.4 7.4 20 12l-4.6 4.6" />
  </Ico>
);

export const IconShield = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 3.2 19.6 6v6.4c0 4.2-3.2 6.9-7.6 8.4-4.4-1.5-7.6-4.2-7.6-8.4V6z" />
    <path className="ic-a" d="m8.6 12.2 2.6 2.7 4.4-5.4" />
  </Ico>
);

export const IconClockCheck = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.4 12a8.4 8.4 0 1 1-16.8 0 8.4 8.4 0 0 1 16.8 0Z" />
    <path d="M12 7v5.3l3.4 2" />
    <path className="ic-a" d="M12 3.6v1.2" />
  </Ico>
);

export const IconFinance = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 20.4h16.8" />
    <path d="M6.4 20.4v-6.2M11 20.4V9.4M15.6 20.4v-8.6" />
    <path className="ic-a" d="M20.2 20.4V4.8" />
  </Ico>
);

/*
   The coin is a struck disc seen slightly off-axis, with a milled edge — the only glyph in the set
   that owns amber.

   THE DEVICE STRUCK INTO IT IS THE WORDMARK'S OWN O, not a drawn circle. A concentric ring is a
   perfectly good icon of a coin and says nothing about whose coin it is; the real glyph has
   Audiowide's flat sides and squared-off counter, which at 15px is the difference between a token
   and a mark. Set rather than traced, and filled rather than stroked, because a letterform is a
   shape and stroking it would draw the outline of the outline.

   13, not 12.8. Audiowide's cap is about 0.72em, so 12.8 would match the old circle exactly — and
   12.8 is a type size that exists nowhere else in the store. scale-audit counts distinct sizes per
   route and this glyph is in every header, so an off-scale value here put four pages over budget
   at once. 13 is already on the scale and lands the letter within a fifth of a unit.
*/
export const IconCoin = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.4 12a8.4 8.4 0 1 1-16.8 0 8.4 8.4 0 0 1 16.8 0Z" />
    <text
      className="ic-a"
      x="12"
      y="12.1"
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily="var(--font-brand)"
      fontWeight="400"
      fontSize="13"
      fill="currentColor"
      stroke="none"
    >
      O
    </text>
    <path d="M12 3.6v1.4M12 19v1.4M3.6 12H5M19 12h1.4" />
  </Ico>
);

/* The assistant. A speech box on the family's chamfered container, with the tail cut from the
   same 45 degrees as the corner — so the one diagonal in the glyph appears twice and reads as
   deliberate. The accent is the line being spoken, not the box. */
export const IconChat = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 4.6h11.8l4.6 4.6V16.4H9.4l-4.4 3.6V16.4H3.6z" />
    <path className="ic-a" d="M7.4 10.5h8.4" />
    <path d="M7.4 13.6h5" />
  </Ico>
);

/* Send. A stroke leaving to the right with its tail behind it: the only icon in the set that is
   pure diagonal, which is what makes it findable in a row of boxes at 16px. */
export const IconSend = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.4 3.6 3.6 10.2l7.2 2.9z" />
    <path className="ic-a" d="m20.4 3.6-9.6 9.5.9 7.3z" />
  </Ico>
);

export const IconSpark = (p: IconProps) => (
  <Ico {...p}>
    <path className="ic-a" d="M12 3.2 13.9 9.7 20.4 12l-6.5 2.3L12 20.8l-1.9-6.5L3.6 12l6.5-2.3z" />
  </Ico>
);

export const IconSave = (p: IconProps) => (
  <Ico {...p}>
    <path d="M5.6 3.6h12.8v16.8L12 15.8l-6.4 4.6z" />
    <path className="ic-a" d="M9 8.4h6" />
  </Ico>
);

export const IconShare = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 15.2V3.8" />
    <path className="ic-a" d="M8.2 7.6 12 3.8l3.8 3.8" />
    <path d="M5 11.6v8.8h14v-8.8" />
  </Ico>
);

export const IconCompare = (p: IconProps) => (
  <Ico {...p}>
    <path d="M7 20.4V6.6M17 3.6v13.8" />
    <path className="ic-a" d="M3.6 10 7 6.6l3.4 3.4M20.4 14 17 17.4 13.6 14" />
  </Ico>
);

/* ═══════════════════════════════════════════════════════════════════════════════
   3. COMMERCE
   ═══════════════════════════════════════════════════════════════════════════════ */

/* The cart is the trolley in the header at rest: a chamfered load box on a deck
   with two wheels. It is deliberately the same silhouette as <BoCartMark>, so the
   animated header rig and the static icon are recognisably one object. */
export const IconCart = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4.6 5.4h9.6L18 9v5.4H4.6z" />
    <path className="ic-a" d="M3.2 17.4h17.6" />
    <path d="M9 21a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0ZM18.6 21a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0Z" />
  </Ico>
);

export const IconStorefront = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 9.6h16V20H4z" />
    <path d="M3.2 9.6 5.6 4h12.8l2.4 5.6" />
    <path className="ic-a" d="M9.6 20v-6h4.8v6" />
  </Ico>
);

export const IconTruck = (p: IconProps) => (
  <Ico {...p}>
    <path d="M2.6 6h10.8v10.4H2.6z" />
    <path d="M13.4 9.4h3.8l3.2 3.4v3.6h-7z" />
    <path className="ic-a" d="M8 18.6a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0ZM19.2 18.6a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0Z" />
  </Ico>
);

export const IconPin = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 21c4-4.6 6-8 6-10.6a6 6 0 1 0-12 0C6 13 8 16.4 12 21Z" />
    <path className="ic-a" d="M14.4 10.2a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0Z" />
  </Ico>
);

export const IconStorage = (p: IconProps) => (
  <Ico {...p}>
    <path d={BOX} />
    <path d="M3.5 12h17" />
    <path className="ic-a" d="M10 8h4M10 16h4" />
  </Ico>
);

export const IconTransport = IconTruck;

export const IconReturn = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.4 13.6a6.6 6.6 0 0 0-6.6-6.6H4.2" />
    <path className="ic-a" d="M8.6 2.8 4 7.4l4.6 4.6" />
    <path d="M20.4 13.6v6.8" />
  </Ico>
);

export const IconTarget = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.4 12a8.4 8.4 0 1 1-16.8 0 8.4 8.4 0 0 1 16.8 0Z" />
    <path d="M16.2 12a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 0 1 8.4 0Z" />
    <path className="ic-a" d="M12 10.4v3.2M10.4 12h3.2" />
  </Ico>
);

/* ═══════════════════════════════════════════════════════════════════════════════
   4. THE STUDIO — drawings, estimating, rooms
   ═══════════════════════════════════════════════════════════════════════════════ */

/* The estimator is a quantity sheet: a chamfered sheet with a total rule under it. */
export const IconEstimate = (p: IconProps) => (
  <Ico {...p}>
    <path d={BOX} />
    <path d="M7 8.6h6.4M7 12h4" />
    <path className="ic-a" d="M7 16.2h10" />
  </Ico>
);

export const IconDrafting = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 3.6 4.6 20.4M12 3.6l7.4 16.8" />
    <path className="ic-a" d="M7.4 14.2h9.2" />
    <path d="M13.4 4.6a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z" />
  </Ico>
);

export const IconRuler = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.4 15.2 15.2 3.4l5.4 5.4L8.8 20.6z" />
    <path className="ic-a" d="m7.4 11.2 2 2M10.6 8l2 2M13.8 4.8l2 2" />
  </Ico>
);

export const IconTotalStation = (p: IconProps) => (
  <Ico {...p}>
    <path d="M7.4 3.6h9.2v6.8H7.4z" />
    <path className="ic-a" d="M12 10.4v3.6M6 20.4l6-6.4 6 6.4" />
    <path d="M10 7h4" />
  </Ico>
);

/* "See it in your room" — a room corner with the object standing in it. */
export const IconRoom = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 3.6v16.8h16.8" />
    <path d="M3.6 16.4 12 20.4l8.4-4" />
    <path className="ic-a" d="M9.4 9h5.2v6.6H9.4z" />
  </Ico>
);

export const IconSeeking = (p: IconProps) => (
  <Ico {...p}>
    <path className="ic-a" d="M3.6 8.4V3.6h4.8M15.6 3.6h4.8v4.8M20.4 15.6v4.8h-4.8M8.4 20.4H3.6v-4.8" />
    <path d="M14.4 12a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0Z" />
  </Ico>
);

export const IconReticle = IconSeeking;

export const IconCamera = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.4 7.4h4L9 5h6l1.6 2.4h4v12.2H3.4z" />
    <path className="ic-a" d="M15.4 13.4a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0Z" />
  </Ico>
);

export const IconFlipCamera = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.4 7.4h17.2v12.2H3.4z" />
    <path className="ic-a" d="M8.6 13.4a3.4 3.4 0 0 1 5.8-2.4M15.4 13.4a3.4 3.4 0 0 1-5.8 2.4M14.8 8.6v2.4h-2.4M9.2 18.2v-2.4h2.4" />
  </Ico>
);

export const IconVideo = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.4 6.6h11.2v10.8H3.4z" />
    <path className="ic-a" d="m14.6 12 6-3.6v7.2z" />
  </Ico>
);

export const IconZoom = (p: IconProps) => (
  <Ico {...p}>
    <path d="M18 10.6a7.4 7.4 0 1 1-14.8 0 7.4 7.4 0 0 1 14.8 0Z" />
    <path className="ic-a" d="M10.6 7.8v5.6M7.8 10.6h5.6" />
    <path d="m15.9 15.9 4.7 4.7" />
  </Ico>
);

export const IconPresentation = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.4 4h17.2v11.4H3.4z" />
    <path className="ic-a" d="M7.6 11.8V9M12 11.8V7M16.4 11.8v-4" />
    <path d="M12 15.4v2.2M8.6 20.4 12 17.6l3.4 2.8" />
  </Ico>
);

export const IconPaper = (p: IconProps) => (
  <Ico {...p}>
    <path d={BOX} />
    <path className="ic-a" d="M15.4 4v5.1h5.1" />
  </Ico>
);

export const IconDoc = (p: IconProps) => (
  <Ico {...p}>
    <path d={BOX} />
    <path className="ic-a" d="M15.4 4v5.1h5.1" />
    <path d="M7 13h8M7 16.6h5.4" />
  </Ico>
);

export const IconDownload = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 3.6v11.2" />
    <path className="ic-a" d="M7.6 10.4 12 14.8l4.4-4.4" />
    <path d="M4 16.8v3.6h16v-3.6" />
  </Ico>
);

export const IconUpload = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 14.8V3.6" />
    <path className="ic-a" d="M7.6 8 12 3.6 16.4 8" />
    <path d="M4 16.8v3.6h16v-3.6" />
  </Ico>
);

export const IconPrint = (p: IconProps) => (
  <Ico {...p}>
    <path d="M7 3.6h10v4.4H7z" />
    <path d="M3.6 8h16.8v7.4H3.6z" />
    <path className="ic-a" d="M7 13h10v7.4H7z" />
  </Ico>
);

export const IconPrinting = IconPrint;

export const IconSettings = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 7.6h16M4 12h16M4 16.4h16" />
    <path className="ic-a" d="M9 5.6v4M15.8 10v4M7.4 14.4v4" />
  </Ico>
);

export const IconAdministration = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 20.4V8.4L12 3.6l8.4 4.8v12z" />
    <path className="ic-a" d="M9.6 20.4v-6.8h4.8v6.8" />
    <path d="M3.6 12h16.8" />
  </Ico>
);

/* ═══════════════════════════════════════════════════════════════════════════════
   5. THE MATERIALS — the 35 category marks
   Each is the material's real silhouette on site, not a generic box.
   ═══════════════════════════════════════════════════════════════════════════════ */

/* A cement bag: the pillow shape with the folded seam at the top. */
export const IconCement = (p: IconProps) => (
  <Ico {...p}>
    <path d="M5.6 6.6C5.6 5 7.2 4 12 4s6.4 1 6.4 2.6v11.8C18.4 19.6 16 20 12 20s-6.4-.4-6.4-1.6z" />
    <path className="ic-a" d="M5.6 8.6c1.6.9 11.2.9 12.8 0" />
    <path d="M9.6 4.2v3.8" />
  </Ico>
);

/* Steel: three rebar ends in section with the rib pattern. */
export const IconSteel = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4.4 4.6v14.8M12 4.6v14.8M19.6 4.6v14.8" />
    <path className="ic-a" d="M3.2 8.2h17.6M3.2 12h17.6M3.2 15.8h17.6" />
  </Ico>
);

export const IconBricks = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.4 6.2h17.2v5.6H3.4zM3.4 11.8h17.2v5.6H3.4z" />
    <path className="ic-a" d="M9.4 6.2v5.6M15.4 11.8v5.6" />
  </Ico>
);

export const IconExcavation = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 20.4h16.8" />
    <path className="ic-a" d="M3.6 20.4 8 13.4h8l4.4 7" />
    <path d="M12 3.6v6.4M9 6.6l3-3 3 3" />
  </Ico>
);

export const IconCentering = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.4 5.6h17.2v3H3.4z" />
    <path className="ic-a" d="M6.4 8.6v11.8M12 8.6v11.8M17.6 8.6v11.8" />
    <path d="M3.4 14.4h17.2" />
  </Ico>
);

export const IconRoofing = (p: IconProps) => (
  <Ico {...p}>
    <path d="M2.6 12 12 4.4 21.4 12" />
    <path className="ic-a" d="M4.8 14.4h14.4M4.8 18h14.4" />
  </Ico>
);

export const IconTiles = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 3.6h16.8v16.8H3.6z" />
    <path d="M12 3.6v16.8M3.6 12h16.8" />
    <path className="ic-a" d="M12 12h8.4v8.4H12z" />
  </Ico>
);

export const IconGlass = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 3.6h16v16.8H4z" />
    <path className="ic-a" d="m7.2 17 9.6-9.6M12.4 17l4.4-4.4" />
  </Ico>
);

export const IconPainting = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4.4 3.6h13.2v5.2H4.4z" />
    <path d="M17.6 6.2h2.8v4.8h-8.8v3" />
    <path className="ic-a" d="M9.6 14h4.8v6.4H9.6z" />
  </Ico>
);

export const IconWaterproofing = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 3.6c3.6 4.5 5.4 7.6 5.4 9.8a5.4 5.4 0 1 1-10.8 0c0-2.2 1.8-5.3 5.4-9.8Z" />
    <path className="ic-a" d="M9.4 13.8a2.6 2.6 0 0 0 2.6 2.6" />
  </Ico>
);

export const IconEpoxy = (p: IconProps) => (
  <Ico {...p}>
    <path d="M8.4 3.6h7.2v4.2l3.4 6.6v6H5v-6l3.4-6.6z" />
    <path className="ic-a" d="M5 14.4h14" />
  </Ico>
);

export const IconPlumbing = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 8.4h6.4v7.2H4z" />
    <path d="M13.6 8.4H20v7.2h-6.4z" />
    <path className="ic-a" d="M10.4 10.6h3.2v2.8h-3.2zM12 3.6v4.8M12 15.6v4.8" />
  </Ico>
);

export const IconHvac = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 5.6h16.8v6.8H3.6z" />
    <path className="ic-a" d="M7 15.6c0 1.6 1.4 1.6 1.4 3.2M12 15.6c0 1.6 1.4 1.6 1.4 3.2M17 15.6c0 1.6 1.4 1.6 1.4 3.2" />
    <path d="M7 8.6h10" />
  </Ico>
);

export const IconBulb = (p: IconProps) => (
  <Ico {...p}>
    <path d="M12 3.4a5.6 5.6 0 0 0-3.4 10v2.4h6.8V13.4A5.6 5.6 0 0 0 12 3.4Z" />
    <path className="ic-a" d="M9.4 18.4h5.2M10.2 20.6h3.6" />
  </Ico>
);

export const IconSolar = (p: IconProps) => (
  <Ico {...p}>
    <path d="M2.8 15.4 5.4 8h13.2l2.6 7.4z" />
    <path d="M8.6 8 7 15.4M15.4 8l1.6 7.4M4.4 11.7h15.2" />
    <path className="ic-a" d="M12 20.4v-5" />
  </Ico>
);

export const IconRailings = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 6.4h16.8" />
    <path className="ic-a" d="M3.6 9.4h16.8" />
    <path d="M6.4 6.4v14M12 6.4v14M17.6 6.4v14" />
  </Ico>
);

export const IconFurniture = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 11.4V7.6h16v3.8" />
    <path d="M2.8 11.4h18.4v5.4H2.8z" />
    <path className="ic-a" d="M5.4 16.8v3.2M18.6 16.8v3.2" />
  </Ico>
);

export const IconKitchen = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 3.6h16.8v16.8H3.6z" />
    <path d="M3.6 11.4h16.8" />
    <path className="ic-a" d="M9.4 7.4h5.2M9.4 15.4h5.2" />
  </Ico>
);

export const IconLift = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4.4 3.6h15.2v16.8H4.4z" />
    <path d="M12 3.6v16.8" />
    <path className="ic-a" d="M8.2 10.6 6.4 8l1.8-2.6M15.8 13.4l1.8 2.6-1.8 2.6" />
  </Ico>
);

export const IconCctv = (p: IconProps) => (
  <Ico {...p}>
    <path d="m3.6 8.4 13-3.4 1.8 6.6-13 3.4z" />
    <path className="ic-a" d="M18.4 11.6h2.4" />
    <path d="M10 13.6v3.4M6.6 20.4h6.8" />
  </Ico>
);

export const IconExtinguisher = (p: IconProps) => (
  <Ico {...p}>
    <path d="M7.6 8.6h6.8v11.8H7.6z" />
    <path className="ic-a" d="M9.6 4.4h2.8v4.2H9.6z" />
    <path d="M14.4 6.4h2.6v6M7.6 12.4h6.8" />
  </Ico>
);

export const IconSafety = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4.6 15.4a7.4 7.4 0 0 1 14.8 0z" />
    <path className="ic-a" d="M9.4 15.4V8a2.6 2.6 0 0 1 5.2 0v7.4" />
    <path d="M3.4 18.4h17.2" />
  </Ico>
);

export const IconMachinery = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4.4 8.4h8.2v7.2H4.4z" />
    <path d="M12.6 11.4h4.2l2.8 4.2v3.4" />
    <path className="ic-a" d="M8.5 19a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM20.5 19a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" />
  </Ico>
);

export const IconHeavyEquipment = IconMachinery;

export const IconBranding = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 4h16.8v11.4H3.6z" />
    <path className="ic-a" d="M8 8.4h8M8 11.4h4.8" />
    <path d="M9.4 15.4v5M6.4 20.4h11.2" />
  </Ico>
);

export const IconStationery = (p: IconProps) => (
  <Ico {...p}>
    <path d="M8.4 3.6h7.2v13L12 20.4l-3.6-3.8z" />
    <path className="ic-a" d="M8.4 8.4h7.2" />
    <path d="M12 12v5" />
  </Ico>
);

export const IconInternalWorks = (p: IconProps) => (
  <Ico {...p}>
    <path d="M3.6 20.4V9.2L12 3.6l8.4 5.6v11.2z" />
    <path className="ic-a" d="M8.4 20.4v-6h7.2v6" />
  </Ico>
);

/* ═══════════════════════════════════════════════════════════════════════════════
   6. THE ENGINE
   ═══════════════════════════════════════════════════════════════════════════════ */

/* The BO Engine: a coin on a track, which is literally what the reward machine is. */
export const IconEngine = (p: IconProps) => (
  <Ico {...p}>
    <path d="M20.4 12a8.4 8.4 0 1 1-16.8 0 8.4 8.4 0 0 1 16.8 0Z" />
    <path className="ic-a" d="M12 6.6V12l3.8 2.2" />
    <path d="M12 3.6v1.4M20.4 12H19M12 20.4V19M3.6 12H5" />
  </Ico>
);

export const IconVolumeOn = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 9.2h3.6L12.6 5v14L7.6 14.8H4z" />
    <path className="ic-a" d="M16 9.4a3.6 3.6 0 0 1 0 5.2M18.6 6.8a7.2 7.2 0 0 1 0 10.4" />
  </Ico>
);

export const IconVolumeOff = (p: IconProps) => (
  <Ico {...p}>
    <path d="M4 9.2h3.6L12.6 5v14L7.6 14.8H4z" />
    <path className="ic-a" d="m16.2 9.8 4.6 4.4M20.8 9.8l-4.6 4.4" />
  </Ico>
);

/* ═══════════════════════════════════════════════════════════════════════════════
   THE TAXONOMY MAPS
   ═══════════════════════════════════════════════════════════════════════════════
   Two lookup tables and their components. They were in the previous file and are
   NOT optional: eight call sites across the header menu, the category rail, the
   category strip, the search results and the specification sheet render a mark
   chosen by a string that comes out of the database, not out of the source.

   The set above is a drop-in replacement for the previous file's ICONS. It is not
   a drop-in replacement for these, because the previous SPEC_GROUP_ICONS reached
   past the store's own icons into Lucide directly — twenty-eight raw imports for
   marks that had no BuildObjects glyph. Those twenty-eight are re-pointed here at
   the closest member of this family, which is the whole point of having a family.
   ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Category → mark. The keys are the `icon` column in the taxonomy, and they
 * outnumber the categories: a category may name any mark, and several share one.
 */
export const CATEGORY_ICONS: Record<string, (p: IconProps) => React.JSX.Element> = {
  /* live */
  cement: IconCement,
  epoxy: IconEpoxy,
  extinguisher: IconExtinguisher,
  solar: IconSolar,
  cctv: IconCctv,
  tiles: IconTiles,
  glass: IconGlass,
  'total-station': IconTotalStation,
  bulb: IconBulb,
  /* upcoming */
  safety: IconSafety,
  excavation: IconExcavation,
  centering: IconCentering,
  steel: IconSteel,
  bricks: IconBricks,
  painting: IconPainting,
  roofing: IconRoofing,
  plumbing: IconPlumbing,
  hvac: IconHvac,
  railings: IconRailings,
  'internal-works': IconInternalWorks,
  kitchen: IconKitchen,
  waterproofing: IconWaterproofing,
  lift: IconLift,
  'external-works': IconExternalWorks,
  'heavy-equipment': IconHeavyEquipment,
  transport: IconTransport,
  machinery: IconMachinery,
  branding: IconBranding,
  administration: IconAdministration,
  stationery: IconStationery,
  paper: IconPaper,
  printing: IconPrinting,
  furniture: IconFurniture,
  drafting: IconDrafting,
  finance: IconFinance,
  storage: IconStorage,
  presentation: IconPresentation,
};

/** A key the taxonomy adds later still gets a mark rather than a hole in the row. */
export function CategoryIcon({ icon: key, ...p }: IconProps & { icon: string }) {
  const C = CATEGORY_ICONS[key] ?? IconCement;
  return <C {...p} />;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Specification-sheet group marks
   ═══════════════════════════════════════════════════════════════════════════════
   One mark per heading on a product's specification sheet. The headings come from
   the database — registry/spec-groups.json decides them per category, so a bulb
   reads "Light output" and cement reads "Strength & structure" — and only the mark
   is chosen here.

   These were twenty-eight emoji before they were twenty-eight Lucide glyphs. A
   specification sheet is the most technical surface in the store — it is where a
   site engineer checks a compressive strength against a drawing — so the marks are
   deliberately quiet and drawn from the same twenty-four-unit grid as everything
   else, rather than being twenty-eight pictures at twenty-eight optical weights.
   ═════════════════════════════════════════════════════════════════════════════ */
export const SPEC_GROUP_ICONS: Record<string, (p: IconProps) => React.JSX.Element> = {
  product_identity: IconDoc,
  light_output: IconBulb,
  electrical: IconSpark,
  optical: IconTotalStation,
  imaging: IconCamera,
  measurement: IconRuler,
  acoustic: IconVolumeOn,
  thermal: IconHvac,
  strength: IconSteel,
  surface: IconTiles,
  physical: IconCompare,
  chemical: IconEpoxy,
  composition: IconBricks,
  manufacturing: IconMachinery,
  dimensions: IconDrafting,
  durability: IconClockCheck,
  cure: IconRefresh,
  /* Pressure ratings are a plumbing figure far more often than a gauge is a mark. */
  pressure: IconPlumbing,
  performance: IconEngine,
  environmental: IconSolar,
  application: IconRoom,
  standards: IconPaper,
  quality_control: IconCheckCircle,
  appearance: IconPainting,
  installation: IconSettings,
  packaging: IconStorage,
  commercial: IconCoin,
  warranty: IconShield,
};

/** Any heading the registry adds later still gets a mark, rather than a hole in the column. */
export function SpecGroupIcon({ group, ...p }: IconProps & { group: string }) {
  const C = SPEC_GROUP_ICONS[group] ?? IconDoc;
  return <C {...p} />;
}

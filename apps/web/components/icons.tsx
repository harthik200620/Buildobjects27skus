import type React from 'react';

/**
 * One line-icon family. Every glyph sits on the same 24-unit grid at the same 1.6 stroke
 * with round joins, in currentColor, so the set reads as one hand whether it is white in the
 * header or teal-700 beside a price. Nothing imported from an icon pack.
 */
type P = React.SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };

function Svg({ size = 22, strokeWidth = 1.6, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── trust marks (from the price-intelligence welcome) ─────────────────── */
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 21.5s-6.5-5.6-6.5-10.9a6.5 6.5 0 0 1 13 0c0 5.3-6.5 10.9-6.5 10.9Z" />
    <circle cx="12" cy="10.6" r="2.4" />
  </Svg>
);
export const IconClockCheck = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v4.8l3 1.8" />
    <path d="M17.5 17.5l1.4 1.4 3-3" />
  </Svg>
);
export const IconStorefront = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.5V20h16v-9.5" />
    <path d="M3 7.5 5 3.5h14l2 4a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-3 0Z" />
    <path d="M9.5 20v-5.5h5V20" />
  </Svg>
);

/* ── app chrome ────────────────────────────────────────────────────────── */
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconArrow = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20.5c.8-3.7 3.8-5.8 7.5-5.8s6.7 2.1 7.5 5.8" />
  </Svg>
);
export const IconEstimate = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8.5 7h7M8.5 11h2M13.5 11h2M8.5 14.5h2M13.5 14.5h2M8.5 18h2M13.5 18h2" />
  </Svg>
);
export const IconFilter = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Svg>
);
export const IconZoom = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5M8.5 11h5M11 8.5v5" />
  </Svg>
);
export const IconTruck = (p: P) => (
  <Svg {...p}>
    <path d="M3 6.5h11v10H3zM14 10h4l3 3.5v3h-7z" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Svg>
);
export const IconReturn = (p: P) => (
  <Svg {...p}>
    <path d="M9 5.5 4.5 10 9 14.5" />
    <path d="M4.5 10h10a5 5 0 0 1 0 10H9" />
  </Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 5 6v6c0 4.3 3 7.4 7 8.5 4-1.1 7-4.2 7-8.5V6z" />
    <path d="m9.5 12 1.8 1.8 3.4-3.6" />
  </Svg>
);
export const IconCamera = (p: P) => (
  <Svg {...p}>
    <path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v11H4z" />
    <circle cx="12" cy="13.5" r="3.2" />
  </Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5" />
    <path d="M4.5 19.5h15" />
  </Svg>
);
export const IconShare = (p: P) => (
  <Svg {...p}>
    <circle cx="18" cy="5.5" r="2.2" />
    <circle cx="6" cy="12" r="2.2" />
    <circle cx="18" cy="18.5" r="2.2" />
    <path d="m8 11 8-4.5M8 13l8 4.5" />
  </Svg>
);
export const IconPrint = (p: P) => (
  <Svg {...p}>
    <path d="M7 9V4h10v5M7 17H4.5v-8h15v8H17" />
    <path d="M7 14h10v6H7z" />
  </Svg>
);
export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M7 3.5h7l4 4v13H7z" />
    <path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5" />
  </Svg>
);
export const IconSave = (p: P) => (
  <Svg {...p}>
    <path d="M5 4.5h11l3 3v12H5z" />
    <path d="M8 4.5v5h7v-5M8 19.5v-5h8v5" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 6v12M6 12h12" />
  </Svg>
);
export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 0 1-14.5 4.6M4 12a8 8 0 0 1 14.5-4.6" />
    <path d="M18.5 3.5v4h-4M5.5 20.5v-4h4" />
  </Svg>
);
export const IconCompare = (p: P) => (
  <Svg {...p}>
    <path d="M9 4.5v15M15 4.5v15M4.5 9.5h9M10.5 14.5h9" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.5" />
  </Svg>
);
export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M10 3.5c.9 3.6 1.9 4.6 5.5 5.5-3.6.9-4.6 1.9-5.5 5.5-.9-3.6-1.9-4.6-5.5-5.5C8.1 8.1 9.1 7.1 10 3.5Z" />
    <path d="M17 14c.45 1.8.95 2.3 2.75 2.75C17.95 17.2 17.45 17.7 17 19.5c-.45-1.8-.95-2.3-2.75-2.75C16.05 16.3 16.55 15.8 17 14Z" />
  </Svg>
);
/** View in your room — a cube on a floor line with the reticle. */
export const IconRoom = (p: P) => (
  <Svg {...p}>
    <path d="m12 3.5 6.5 3.6v7.3L12 18l-6.5-3.6V7.1z" />
    <path d="M12 18v-7.3L5.5 7.1M12 10.7l6.5-3.6" />
    <path d="M3 21h18" />
  </Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M10 4.5H5v15h5" />
    <path d="M14 8l4 4-4 4M18 12H9.5" />
  </Svg>
);
export const IconRuler = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 15.5 12-12 5 5-12 12z" />
    <path d="m7 12 1.5 1.5M10 9l1.5 1.5M13 6l1.5 1.5" />
  </Svg>
);
export const IconPhone = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 17.5h2" />
  </Svg>
);
export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const IconStar = (p: P) => (
  <Svg {...p}>
    <path d="m12 3.8 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17.2 6.7 20l1.1-5.9L3.5 10l5.9-.8z" />
  </Svg>
);
export const IconChevronUp = (p: P) => (
  <Svg {...p}>
    <path d="m6 15 6-6 6 6" />
  </Svg>
);
export const IconCheckCircle = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4M12 16.8v.4" />
  </Svg>
);

/* ── category marks ─────────────────────────────────────────────────────── */
/** A 50 kg bag: valve-top sack with the seam and the round brand mark. */
export const IconCement = (p: P) => (
  <Svg {...p}>
    <path d="M5 8.5c0-1.5 1-2.5 2.5-2.5h9c1.5 0 2.5 1 2.5 2.5v9c0 1.5-1 2.5-2.5 2.5h-9C6 20 5 19 5 17.5z" />
    <path d="M8 6V4.5h8V6M5 12h14" />
    <circle cx="12" cy="15.5" r="1.8" />
  </Svg>
);
/** An epoxy pail with its handle. */
export const IconEpoxy = (p: P) => (
  <Svg {...p}>
    <path d="M6 8.5h12l-1 11.5H7z" />
    <path d="M5 8.5h14" />
    <path d="M8 8.5c0-2.5 1.8-4 4-4s4 1.5 4 4" />
    <path d="M9.5 12.5v5M12 12.5v5M14.5 12.5v5" />
  </Svg>
);
/** A stored-pressure extinguisher: cylinder, valve, hose. */
export const IconExtinguisher = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="8" width="8" height="13" rx="3" />
    <path d="M10.5 8V6h3v2M12 6V3.5M14 5h3v1.5" />
    <path d="M8.5 10.5c-2 0-3 1-3 3v4" />
  </Svg>
);
/** A framed PV module. */
export const IconSolar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="11" rx="1.5" />
    <path d="M3.5 10.5h17M9 5v11M15 5v11" />
    <path d="M12 16v4M8.5 20h7" />
  </Svg>
);
/** A dome camera. */
export const IconCctv = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h16" />
    <path d="M6 9.5a6 6 0 0 1 12 0" />
    <path d="M12 3.5v2" />
    <circle cx="12" cy="14.5" r="4.5" />
    <circle cx="12" cy="14.5" r="1.5" />
  </Svg>
);
/** Four tiles with their joints. */
export const IconTiles = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </Svg>
);
/** A pane with a reflection. */
export const IconGlass = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
    <path d="m8 15 7-8M11 18l6-7" />
  </Svg>
);
/** A total station on its tripod. */
export const IconTotalStation = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="6" width="7" height="6" rx="1.2" />
    <path d="M12 3.5V6M6.5 9h2M15.5 9h2" />
    <path d="M12 12v3M12 15l-5 6M12 15l5 6M9 19.5h6" />
  </Svg>
);
/** An A-shape LED bulb. */
export const IconBulb = (p: P) => (
  <Svg {...p}>
    <path d="M9 15.5a6 6 0 1 1 6 0V18H9z" />
    <path d="M9.5 20.5h5" />
  </Svg>
);

/* ── the twenty-eight categories the catalogue has not reached yet ──────────────
   Same grid, same stroke, same hand. A department strip that mixed nine drawn glyphs
   with twenty-eight fallbacks reads as unfinished, and the fallback was IconCement for
   all of them — every upcoming category showed a cement bag. */

/** A hard hat. */
export const IconSafety = (p: P) => (
  <Svg {...p}>
    <path d="M4 16a8 8 0 0 1 16 0" />
    <path d="M9.5 8.6V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5v3.1" />
    <path d="M3 16h18" />
  </Svg>
);
/** An excavator bucket biting into ground. */
export const IconExcavation = (p: P) => (
  <Svg {...p}>
    <path d="M3 20h18" />
    <path d="M6 20V9l6 4" />
    <path d="M12 13h6a2 2 0 0 1 2 2v2a3 3 0 0 1-3 3h-5z" />
  </Svg>
);
/** Formwork props under a slab. */
export const IconCentering = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M6 6v14M12 6v14M18 6v14" />
    <path d="M4 20h16" />
  </Svg>
);
/** A bundle of rebar, end on. */
export const IconSteel = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="9" r="3.2" />
    <circle cx="15.5" cy="9" r="3.2" />
    <circle cx="11.8" cy="15.5" r="3.2" />
  </Svg>
);
/** Coursed brickwork. */
export const IconBricks = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="1" />
    <path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 9.7v4.6M9 14.3V19" />
  </Svg>
);
/** A roller and its tray. */
export const IconPainting = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="12" height="5" rx="1" />
    <path d="M16 6.5h3v4h-6v3" />
    <rect x="11" y="13.5" width="4" height="6.5" rx="1" />
  </Svg>
);
/** A pitched roof with its sheeting. */
export const IconRoofing = (p: P) => (
  <Svg {...p}>
    <path d="M2 13 12 5l10 8" />
    <path d="M5 13v7h14v-7" />
    <path d="M9 20v-5h6v5" />
  </Svg>
);
/** A tap over a trap. */
export const IconPlumbing = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h6v4H4z" />
    <path d="M10 9h4a2 2 0 0 1 2 2v2" />
    <path d="M7 11v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-2" />
  </Svg>
);
/** A wall-mounted air handler. */
export const IconHvac = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="7" rx="1.6" />
    <path d="M6.5 8.5h11" />
    <path d="M7 15c1.6 0 1.6 2 3.2 2M13 15c1.6 0 1.6 2 3.2 2M9 18.5c1.6 0 1.6 2 3.2 2" />
  </Svg>
);
/** Balusters between rails. */
export const IconRailings = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h18M3 19h18" />
    <path d="M7 7v12M12 7v12M17 7v12" />
  </Svg>
);
/** A false-ceiling grid in perspective. */
export const IconInternalWorks = (p: P) => (
  <Svg {...p}>
    <path d="M3 5h18v6H3z" />
    <path d="M9 5v6M15 5v6" />
    <path d="M5 14v6M12 14v6M19 14v6M5 17h14" />
  </Svg>
);
/** A pan over a burner. */
export const IconKitchen = (p: P) => (
  <Svg {...p}>
    <path d="M3 11h13a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
    <path d="M16 11h3.5a1.5 1.5 0 0 1 0 3H18" />
    <path d="M6 19h9" />
  </Svg>
);
/** A membrane shedding water. */
export const IconWaterproofing = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5c3 4 5 6.4 5 8.8a5 5 0 0 1-10 0c0-2.4 2-4.8 5-8.8Z" />
    <path d="M3 20.5h18" />
  </Svg>
);
/** A lift car between guide rails. */
export const IconLift = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
    <path d="M12 3.5v17" />
    <path d="m8.5 9 1.5-2 1.5 2M12.5 15l1.5 2 1.5-2" />
  </Svg>
);
/** Paving running to a boundary wall. */
export const IconExternalWorks = (p: P) => (
  <Svg {...p}>
    <path d="M3 20h18" />
    <path d="M3 16h18M6 16v4M12 16v4M18 16v4" />
    <path d="M5 12h14v-2H5zM7 10V7h10v3" />
  </Svg>
);
/** A crawler crane. */
export const IconHeavyEquipment = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M7 20V6h2l9 4" />
    <path d="M18 10v3" />
    <rect x="4" y="15.5" width="7" height="3" rx="1.4" />
  </Svg>
);
/** A tipper on the move. */
export const IconTransport = (p: P) => (
  <Svg {...p}>
    <path d="M3 16V8h10v8" />
    <path d="M13 11h4l3 3v2h-7" />
    <circle cx="7" cy="18" r="1.8" />
    <circle cx="17" cy="18" r="1.8" />
  </Svg>
);
/** Meshed gears. */
export const IconMachinery = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="4" />
    <path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M14.6 5.4l-1.4 1.4M6.8 13.2l-1.4 1.4" />
    <circle cx="17.5" cy="17.5" r="2.6" />
  </Svg>
);
/** A site hoarding with the mark on it. */
export const IconBranding = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="10" rx="1.4" />
    <path d="M7.5 9.5h3M13.5 8v3" />
    <path d="M8 14.5v5M16 14.5v5" />
  </Svg>
);
/** A ring binder. */
export const IconAdministration = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5h13a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
    <path d="M8 3.5v17" />
    <path d="M12 8.5h4M12 12h4" />
  </Svg>
);
/** Pencil and clip. */
export const IconStationery = (p: P) => (
  <Svg {...p}>
    <path d="M4 20.5 5.2 16 15.6 5.6a1.8 1.8 0 0 1 2.6 2.6L8.5 18.8Z" />
    <path d="M14 7.5 16.5 10" />
  </Svg>
);
/** A stack of sheets. */
export const IconPaper = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="3.5" width="13" height="14" rx="1.4" />
    <path d="M16 17.5v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13" />
    <path d="M9.5 8h6M9.5 12h6" />
  </Svg>
);
/** A desktop printer with its sheet. */
export const IconPrinting = (p: P) => (
  <Svg {...p}>
    <path d="M7 8V3.5h10V8" />
    <rect x="3.5" y="8" width="17" height="7" rx="1.4" />
    <path d="M7 15v5.5h10V15" />
    <path d="M17 11h1" />
  </Svg>
);
/** A desk with a chair. */
export const IconFurniture = (p: P) => (
  <Svg {...p}>
    <path d="M3 9h11v2H3z" />
    <path d="M4.5 11v9M12.5 11v9" />
    <path d="M17 20v-6a3 3 0 0 1 3-3v9" />
    <path d="M17 15h4" />
  </Svg>
);
/** Set square and rule. */
export const IconDrafting = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h16L4 4z" />
    <path d="M8 16h2M8 12.5h2M11.5 16h2" />
  </Svg>
);
/** A ledger with a rupee. */
export const IconFinance = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="1.6" />
    <path d="M9 8h6M9 11h6M9 8c3 0 3 5 0 5l4 4" />
  </Svg>
);
/** A taped carton. */
export const IconStorage = (p: P) => (
  <Svg {...p}>
    <path d="M3 7.5 12 4l9 3.5v9L12 20l-9-3.5z" />
    <path d="M3 7.5 12 11l9-3.5M12 11v9" />
  </Svg>
);
/** A board on its easel. */
export const IconPresentation = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="11" rx="1.4" />
    <path d="M12 14.5v3M8 20.5l4-3 4 3" />
    <path d="M7.5 11V8.5M11 11V6.5M14.5 11v-3" />
  </Svg>
);

export const CATEGORY_ICONS: Record<string, (p: P) => React.JSX.Element> = {
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
export function CategoryIcon({ icon, ...p }: P & { icon: string }) {
  const C = CATEGORY_ICONS[icon] ?? IconCement;
  return <C {...p} />;
}

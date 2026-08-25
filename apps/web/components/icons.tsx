import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Blocks,
  Bolt,
  Bookmark,
  Boxes,
  Building2,
  Camera,
  Cctv,
  Check,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Cog,
  Compass,
  Construction,
  Crosshair,
  DoorOpen,
  Download,
  Droplets,
  Fence,
  FileClock,
  Files,
  FileText,
  FireExtinguisher,
  FlaskConical,
  Frame,
  GitCompare,
  Grid3x3,
  HardHat,
  House,
  Info,
  Lightbulb,
  LogOut,
  MapPin,
  Menu,
  Minus,
  Package,
  PaintRoller,
  Palette,
  PencilRuler,
  Phone,
  Plus,
  Presentation,
  Printer,
  ReceiptIndianRupee,
  RefreshCw,
  RotateCcw,
  Ruler,
  Scan,
  Search,
  Share2,
  ShieldCheck,
  Shovel,
  SlidersHorizontal,
  Sofa,
  Sparkles,
  Star,
  Store,
  SunMedium,
  Tractor,
  Trees,
  TriangleAlert,
  Truck,
  Umbrella,
  Upload,
  User,
  Wallet,
  Wind,
  X,
  ZoomIn,
} from 'lucide-react';
import type React from 'react';

/**
 * One icon family, drawn by Lucide.
 *
 * This file used to hold seventy-five hand-cut SVG paths and a comment saying "nothing imported
 * from an icon pack". The rule was meant to buy consistency — one hand, one grid, one stroke — and
 * at that count it bought the opposite. Optical correction is what separates an icon family from a
 * set of shapes on a grid: a circle and a square of the same nominal size do not read as the same
 * size, a diagonal needs a different weight from a vertical, and thirty-seven category marks drawn
 * by hand drift apart in exactly those ways. They read as cheap because they were.
 *
 * So the drawing is Lucide's (MIT, 1,780 icons, one editorial hand) and this module stays the only
 * import point, which is why no call site changed when the paths underneath them did.
 *
 * The store draws at 22/1.6 rather than Lucide's 24/2 — the chrome is dense and a 2px stroke at
 * 16px is a blob — so every export carries those defaults and callers override per use.
 */
type P = React.SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };

type LucideComponent = React.ComponentType<
  Omit<React.SVGProps<SVGSVGElement>, 'ref'> & { size?: string | number; strokeWidth?: string | number; absoluteStrokeWidth?: boolean }
>;

const icon =
  (C: LucideComponent) =>
  ({ size = 22, strokeWidth = 1.6, ...rest }: P) => <C size={size} strokeWidth={strokeWidth} aria-hidden focusable="false" {...rest} />;

/* ── chrome and actions ────────────────────────────────────────────────── */
export const IconCheck = icon(Check);
export const IconCheckCircle = icon(CircleCheck);
export const IconAlert = icon(TriangleAlert);
export const IconInfo = icon(Info);
export const IconClose = icon(X);
export const IconBack = icon(ArrowLeft);
export const IconArrow = icon(ArrowRight);
export const IconChevron = icon(ChevronRight);
export const IconChevronDown = icon(ChevronDown);
export const IconChevronUp = icon(ChevronUp);
export const IconMenu = icon(Menu);
export const IconSearch = icon(Search);
export const IconFilter = icon(SlidersHorizontal);
export const IconUser = icon(User);
export const IconLogout = icon(LogOut);
export const IconPhone = icon(Phone);
export const IconStar = icon(Star);
export const IconPlus = icon(Plus);
export const IconMinus = icon(Minus);
export const IconRefresh = icon(RefreshCw);
export const IconCompare = icon(GitCompare);
export const IconSave = icon(Bookmark);
export const IconShare = icon(Share2);
export const IconPrint = icon(Printer);
export const IconDoc = icon(FileText);
export const IconDownload = icon(Download);
export const IconUpload = icon(Upload);
export const IconZoom = icon(ZoomIn);
export const IconCamera = icon(Camera);
export const IconSpark = icon(Sparkles);
export const IconRuler = icon(Ruler);

/* ── the promises the store makes ──────────────────────────────────────── */
export const IconStorefront = icon(Store);
/** The estimate is money, in rupees — not a calculation. */
export const IconEstimate = icon(ReceiptIndianRupee);
export const IconPin = icon(MapPin);
export const IconTruck = icon(Truck);
export const IconReturn = icon(RotateCcw);
export const IconShield = icon(ShieldCheck);
/** Provenance: every price says where it came from and when. */
export const IconClockCheck = icon(FileClock);
/** The AR frame — see it standing in your own room. */
export const IconRoom = icon(Scan);

/* ── the thirty-seven categories ───────────────────────────────────────── */
export const IconCement = icon(Package);
export const IconEpoxy = icon(FlaskConical);
export const IconExtinguisher = icon(FireExtinguisher);
export const IconSolar = icon(SunMedium);
export const IconCctv = icon(Cctv);
export const IconTiles = icon(Grid3x3);
export const IconGlass = icon(Frame);
export const IconTotalStation = icon(Crosshair);
export const IconBulb = icon(Lightbulb);
export const IconSafety = icon(HardHat);
export const IconExcavation = icon(Shovel);
export const IconCentering = icon(Construction);
export const IconSteel = icon(Bolt);
export const IconBricks = icon(Blocks);
export const IconPainting = icon(PaintRoller);
export const IconRoofing = icon(House);
export const IconPlumbing = icon(Droplets);
export const IconHvac = icon(Wind);
export const IconRailings = icon(Fence);
export const IconInternalWorks = icon(DoorOpen);
export const IconKitchen = icon(ChefHat);
export const IconWaterproofing = icon(Umbrella);
export const IconLift = icon(ArrowUpDown);
export const IconExternalWorks = icon(Trees);
export const IconHeavyEquipment = icon(Tractor);
export const IconTransport = icon(Truck);
export const IconMachinery = icon(Cog);
export const IconBranding = icon(Palette);
export const IconAdministration = icon(Building2);
export const IconStationery = icon(PencilRuler);
export const IconPaper = icon(Files);
export const IconPrinting = icon(Printer);
export const IconFurniture = icon(Sofa);
export const IconDrafting = icon(Compass);
export const IconFinance = icon(Wallet);
export const IconStorage = icon(Boxes);
export const IconPresentation = icon(Presentation);

/**
 * Taxonomy `icon` key → glyph, for the places a category is named without a photograph beside it:
 * the nav dropdown and the department menus. Category *tiles* use no glyph at all — all
 * thirty-seven have real photography, and a line drawing laid over a photograph is the thing that
 * made the grid look cheap.
 */
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

export function CategoryIcon({ icon: key, ...p }: P & { icon: string }) {
  const C = CATEGORY_ICONS[key] ?? IconCement;
  return <C {...p} />;
}

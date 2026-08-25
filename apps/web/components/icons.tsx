import {
  Anvil,
  Aperture,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Atom,
  AudioLines,
  BadgeCheck,
  Blocks,
  Bolt,
  Bookmark,
  Boxes,
  Building2,
  Camera,
  Cctv,
  Check,
  CheckCheck,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleDot,
  Cog,
  Coins,
  Compass,
  Construction,
  Crosshair,
  DoorOpen,
  Download,
  Droplets,
  Factory,
  Fence,
  FileClock,
  Files,
  FileText,
  FireExtinguisher,
  Flame,
  FlaskConical,
  Frame,
  Gauge,
  Gift,
  GitCompare,
  Grid3x3,
  Handshake,
  HardHat,
  Hourglass,
  House,
  IndianRupee,
  Info,
  Leaf,
  Lightbulb,
  LogOut,
  MapPin,
  Menu,
  Minus,
  Mountain,
  Move3d,
  Package,
  PackageOpen,
  PaintRoller,
  Palette,
  PartyPopper,
  PencilRuler,
  Phone,
  Plus,
  Presentation,
  Printer,
  ReceiptIndianRupee,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Ruler,
  Scale,
  Scan,
  ScrollText,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Shovel,
  SlidersHorizontal,
  Sofa,
  Sparkles,
  Star,
  Store,
  SunMedium,
  SwitchCamera,
  Tag,
  Target,
  Telescope,
  Thermometer,
  Timer,
  Tractor,
  Trees,
  TriangleAlert,
  Trophy,
  Truck,
  Umbrella,
  Upload,
  User,
  Video,
  Volume2,
  VolumeX,
  Wallet,
  Wind,
  Wrench,
  X,
  Zap,
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
export const IconRotateLeft = icon(RotateCcw);
export const IconRotateRight = icon(RotateCw);
export const IconMove = icon(Move3d);
export const IconTarget = icon(Target);
export const IconReticle = icon(CircleDot);
export const IconSeeking = icon(Circle);
export const IconVideo = icon(Video);
export const IconFlipCamera = icon(SwitchCamera);
export const IconSettings = icon(Settings2);
export const IconVolumeOn = icon(Volume2);
export const IconVolumeOff = icon(VolumeX);
export const IconTrophy = icon(Trophy);
export const IconGift = icon(Gift);
export const IconCelebrate = icon(PartyPopper);
export const IconDone = icon(CheckCheck);

/* ── the BO layer: coins, the cart, the engine ─────────────────────────────
   A currency and a shop need marks, and the three they had were 🪙, 🛒 and ⚡ — the same three
   glyphs every other shop on the internet ships, rendered by the reader's operating system in
   whatever colour and weight it feels like. An emoji is not an icon: it does not take
   currentColor, it does not take a stroke width, it changes shape between Windows and Android,
   and next to a 1.6 px Lucide stroke it reads as a sticker. These are the replacements. */
export const IconCoin = icon(Coins);
export const IconCart = icon(ShoppingCart);
export const IconEngine = icon(Zap);

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

/* ═══════════════════════════════════════════════════════════════════════════
   Specification-sheet group marks
   ═══════════════════════════════════════════════════════════════════════════
   One mark per heading on a product's specification sheet. The headings themselves come from
   the database — registry/spec-groups.json decides them per category, so a bulb reads "Light
   output" and cement reads "Strength & structure" — and only the mark is chosen here.

   These were twenty-eight emoji: 📋 💡 ⚡ 🔭 🎥 📐 🔊 🌡️ 🏗️ 🪨 ⚖️ 🧪 🧱 ⚙️ 📏 ⏳ ⏱️ 💨 🔥 🛡️ 🏠
   📜 ✅ ✨ 🛠️ 📦 💰 🤝. Twenty-eight pictures, at twenty-eight different optical weights, none
   of them able to take the ink colour of the row they sat in. A specification sheet is the most
   technical surface in the store — it is where a site engineer checks a compressive strength
   against a drawing — and decorating it with party stickers is what made a serious document read
   as a toy.
   ═════════════════════════════════════════════════════════════════════════ */
export const SPEC_GROUP_ICONS: Record<string, (p: P) => React.JSX.Element> = {
  product_identity: icon(Tag),
  light_output: icon(Lightbulb),
  electrical: icon(Zap),
  optical: icon(Telescope),
  imaging: icon(Aperture),
  measurement: icon(Ruler),
  acoustic: icon(AudioLines),
  thermal: icon(Thermometer),
  strength: icon(Anvil),
  surface: icon(Mountain),
  physical: icon(Scale),
  chemical: icon(FlaskConical),
  composition: icon(Atom),
  manufacturing: icon(Factory),
  dimensions: icon(Ruler),
  durability: icon(Hourglass),
  cure: icon(Timer),
  pressure: icon(Gauge),
  performance: icon(Flame),
  environmental: icon(Leaf),
  application: icon(House),
  standards: icon(ScrollText),
  quality_control: icon(BadgeCheck),
  appearance: icon(Sparkles),
  installation: icon(Wrench),
  packaging: icon(PackageOpen),
  commercial: icon(IndianRupee),
  warranty: icon(Handshake),
};

/** Any heading the registry adds later still gets a mark, rather than a hole in the column. */
export function SpecGroupIcon({ group, ...p }: P & { group: string }) {
  const C = SPEC_GROUP_ICONS[group] ?? IconDoc;
  return <C {...p} />;
}

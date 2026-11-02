import { createElement, useId, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ArrowUpDown,
  Banknote,
  Bell,
  Bitcoin,
  Briefcase,
  Building2,
  Camera,
  Car as CarIcon,
  ChartColumn,
  ChartLine,
  ChartPie,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CirclePercent,
  CreditCard,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileChartColumn,
  FileText,
  Flag,
  Gem,
  Heart,
  House,
  Image as ImageIcon,
  Info,
  Landmark,
  Layers,
  LayoutGrid,
  List,
  ListFilter,
  Lock,
  Map as MapIcon,
  MapPin,
  Maximize,
  Minus,
  Palette,
  Pencil,
  Plane,
  Play,
  Plug,
  Plus,
  Sailboat,
  Search,
  Settings,
  Share,
  Shield,
  ShieldCheck,
  ShieldPlus,
  Sparkles,
  Star,
  Table,
  Target,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Umbrella,
  Upload,
  Users,
  Vault,
  Wallet,
  Watch,
  Wine,
  Amphora,
  X,
  type IconNode,
} from "lucide";
import { ICON_STROKE, type IconSize } from "../tokens/layout.ts";

/**
 * The Willowsum icon set — DS-12. Based on the open-source Lucide set (lucide.dev, ISC licence,
 * pinned in package.json): 24 px grid, round caps and joins, outline only, `currentColor`, so
 * icons follow the theme without separate files. The stroke is 1.5 px *absolute*: the SVG
 * stroke width is scaled by 24 / size, so 16, 20, 24, 32 and 40 px icons all draw the same
 * 1.5 px line (Lucide's `absoluteStrokeWidth`).
 *
 * Every name maps to one Lucide glyph, except:
 * - child icons, composed from the parent glyph: mortgage = debts + a house badge; public /
 *   private investment = investments + a globe / padlock badge (parent at 75 %, badge in the
 *   bottom-right 8 px box, the parent cut back around it); insurance kinds = the Lucide shield
 *   with a sign inside (health = Lucide shield-plus);
 * - `metals` (gold bars), drawn here because Lucide has no bullion glyph.
 * Custom drawing follows Lucide's rules: 24 px grid, 1 px padding, round joins, whole or half
 * pixel coordinates, no detail closer than 2 px to another.
 *
 * Lucide draws a few dots as tiny filled circles; the fill is dropped (outline only) — with a
 * 1.5 px stroke a 0.5-radius circle still reads as a solid dot.
 */

export type IconName =
  | "home"
  | "accounts"
  | "transactions"
  | "budget"
  | "goals"
  | "assets"
  | "investments"
  | "debts"
  | "locations"
  | "map"
  | "documents"
  | "vault"
  | "insurance"
  | "reports"
  | "notifications"
  | "assistant"
  | "household"
  | "settings"
  | "plans"
  | "wishlist"
  | "integrations"
  | "search"
  | "more"
  | "property"
  | "art"
  | "wine"
  | "collectable"
  | "watch"
  | "vehicle"
  | "boat"
  | "company"
  | "cash"
  | "crypto"
  | "pension"
  | "metals"
  | "plus"
  | "close"
  | "check"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "chevron-down"
  | "eye"
  | "eye-off"
  | "edit"
  | "trash"
  | "upload"
  | "download"
  | "camera"
  | "image"
  | "filter"
  | "sort"
  | "share"
  | "info"
  | "warning"
  | "external"
  | "lock"
  | "expand"
  | "play"
  | "grid"
  | "pie"
  | "bars"
  | "table"
  | "trend"
  | "card"
  | "mortgage"
  | "insurance-health"
  | "insurance-life"
  | "insurance-home"
  | "insurance-vehicle"
  | "insurance-travel"
  | "investment-public"
  | "investment-private"
  | "list"
  | "star"
  | "minus"
  | "target";

/** What a glyph gets to draw with: a unique id for masks and the SVG stroke width in grid units. */
type GlyphContext = { id: string; sw: number };
type Glyph = (ctx: GlyphContext) => ReactNode;

const camel = (attr: string) => attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * Lucide node → React elements. `fill` is dropped so the set stays outline only. A dot (circle of
 * radius ≤ 1) is redrawn as a circle whose own stroke covers its centre: Lucide sizes dots for a
 * 2 px stroke, and at 1.5 px they would otherwise show a pinhole. The dot keeps its outer size.
 * Zero-length dot segments get the same 2.5 px weight, so every dot in the set reads alike.
 */
/** Lucide's other dot form: zero-length segments ("M3 5h.01"), widened to the same 2.5 px dot. */
const DOT_PATH = /^(M[\d.]+[ ,][\d.]+h\.01)+$/;

function draw(node: IconNode, sw: number): ReactNode[] {
  return node.map(([tag, attrs], i) => {
    const props: Record<string, unknown> = { key: i };
    for (const [k, v] of Object.entries(attrs)) if (k !== "fill") props[camel(k)] = v;
    const r = tag === "circle" ? Number(attrs.r) : NaN;
    if (r <= 1) {
      const d = 2 * r + sw;
      props.r = d / 4;
      props.strokeWidth = d / 2;
    }
    if (tag === "path" && DOT_PATH.test(String(attrs.d))) props.strokeWidth = sw + 1;
    return createElement(tag, props);
  });
}

const lucide =
  (node: IconNode): Glyph =>
  ({ sw }) =>
    draw(node, sw);

/** A group drawn at `scale` keeps the absolute line weight by dividing the stroke. */
function scaled(scale: number, x: number, y: number, sw: number, children: ReactNode) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} strokeWidth={sw / scale}>
      {children}
    </g>
  );
}

/* Badges for child icons, in the bottom-right 8 px box (14…22) as Lucide draws its modifiers. */
const BADGE_HOUSE: IconNode = [
  // Lucide shield-house's house.
  [
    "path",
    {
      d: "M15 22a1 1 0 0 1-1-1v-4a1 1 0 0 1 .445-.832l3-2a1 1 0 0 1 1.11 0l3 2A1 1 0 0 1 22 17v4a1 1 0 0 1-1 1z",
    },
  ],
  ["path", { d: "M18 22v-3" }],
];
const BADGE_GLOBE: IconNode = [
  // Lucide globe at 40 %.
  ["circle", { cx: "18", cy: "18", r: "4" }],
  ["path", { d: "M18 14a5.8 5.8 0 0 0 0 8 5.8 5.8 0 0 0 0-8" }],
  ["path", { d: "M14 18h8" }],
];
const BADGE_LOCK: IconNode = [
  // Lucide folder-lock's padlock.
  ["rect", { x: "14", y: "17", width: "8", height: "5", rx: "1" }],
  ["path", { d: "M20 17v-2a2 2 0 1 0-4 0v2" }],
];

/** DS-12 item 5: child = parent glyph at 75 % (top left) + a badge; the parent is cut back 1.5 px around the badge. */
const withBadge =
  (parent: IconNode, badge: IconNode): Glyph =>
  ({ id, sw }) => (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" />
        <g fill="black" stroke="black" strokeWidth={sw + 3}>
          {draw(badge, sw)}
        </g>
      </mask>
      <g mask={`url(#${id})`}>{scaled(0.75, 0.5, 0.5, sw, draw(parent, sw / 0.75))}</g>
      {draw(badge, sw)}
    </>
  );

/* Signs inside the insurance shield: drawn in the shield's 6–7 px inner box centred on (12, 12). */
const SHIELD_PATH = Shield[0]!;
const inShield =
  (sign: IconNode, scale: number): Glyph =>
  ({ sw }) => (
    <>
      {draw([SHIELD_PATH], sw)}
      {scaled(scale, 12 - 12 * scale, 12 - 12 * scale, sw, draw(sign, sw / scale))}
    </>
  );

/** Custom: Lucide's car loses its wheels at shield-sign size, so a front-view car is drawn in the 8 px box. */
const SIGN_CAR: IconNode = [
  ["path", { d: "M8 15v-2.4a1.5 1.5 0 0 1 .44-1.06L9.5 10.5h5l1.06 1.04A1.5 1.5 0 0 1 16 12.6V15z" }],
  ["path", { d: "M9.5 15v1M14.5 15v1" }],
  ["path", { d: "M10 13h.01M14 13h.01" }],
];

const GLYPHS: Record<IconName, Glyph> = {
  home: lucide(House),
  accounts: lucide(Landmark),
  transactions: lucide(ArrowLeftRight),
  budget: lucide(Wallet),
  goals: lucide(Flag),
  assets: lucide(Gem),
  investments: lucide(TrendingUp),
  debts: lucide(CirclePercent),
  locations: lucide(MapPin),
  map: lucide(MapIcon),
  documents: lucide(FileText),
  vault: lucide(Vault),
  insurance: lucide(ShieldCheck),
  reports: lucide(FileChartColumn),
  notifications: lucide(Bell),
  assistant: lucide(Sparkles),
  household: lucide(Users),
  settings: lucide(Settings),
  plans: lucide(Layers),
  wishlist: lucide(Heart),
  integrations: lucide(Plug),
  search: lucide(Search),
  more: lucide(Ellipsis),
  property: lucide(Building2),
  art: lucide(Palette),
  wine: lucide(Wine),
  collectable: lucide(Amphora),
  watch: lucide(Watch),
  vehicle: lucide(CarIcon),
  boat: lucide(Sailboat),
  company: lucide(Briefcase),
  cash: lucide(Banknote),
  crypto: lucide(Bitcoin),
  pension: lucide(Umbrella),
  // Custom: three bars in a pyramid; Lucide has no bullion glyph.
  metals: () => (
    <>
      <path d="M7 13l1.5-6h7l1.5 6z" />
      <path d="M2 19l1.5-6h7L12 19z" />
      <path d="M12 19l1.5-6h7l1.5 6z" />
    </>
  ),
  plus: lucide(Plus),
  close: lucide(X),
  check: lucide(Check),
  "chevron-left": lucide(ChevronLeft),
  "chevron-right": lucide(ChevronRight),
  "chevron-up": lucide(ChevronUp),
  "chevron-down": lucide(ChevronDown),
  eye: lucide(Eye),
  "eye-off": lucide(EyeOff),
  edit: lucide(Pencil),
  trash: lucide(Trash2),
  upload: lucide(Upload),
  download: lucide(Download),
  camera: lucide(Camera),
  image: lucide(ImageIcon),
  filter: lucide(ListFilter),
  sort: lucide(ArrowUpDown),
  share: lucide(Share),
  info: lucide(Info),
  warning: lucide(TriangleAlert),
  external: lucide(ExternalLink),
  lock: lucide(Lock),
  expand: lucide(Maximize),
  play: lucide(Play),
  grid: lucide(LayoutGrid),
  pie: lucide(ChartPie),
  bars: lucide(ChartColumn),
  table: lucide(Table),
  trend: lucide(ChartLine),
  card: lucide(CreditCard),
  mortgage: withBadge(CirclePercent, BADGE_HOUSE),
  "insurance-health": lucide(ShieldPlus),
  "insurance-life": inShield(Heart, 0.42),
  "insurance-home": inShield(House, 0.44),
  "insurance-vehicle": inShield(SIGN_CAR, 1),
  "insurance-travel": inShield(Plane, 0.46),
  "investment-public": withBadge(TrendingUp, BADGE_GLOBE),
  "investment-private": withBadge(TrendingUp, BADGE_LOCK),
  list: lucide(List),
  star: lucide(Star),
  minus: lucide(Minus),
  target: lucide(Target),
};

/** Every icon name, in the design board's order. */
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

/** DS-12 item 4: icon groups. */
export const ICON_GROUPS = {
  sections: [
    "home",
    "accounts",
    "transactions",
    "budget",
    "goals",
    "assets",
    "investments",
    "debts",
    "locations",
    "documents",
    "vault",
    "insurance",
    "reports",
    "notifications",
    "assistant",
    "household",
    "settings",
    "plans",
    "wishlist",
    "integrations",
    "search",
    "more",
  ],
  assetTypes: [
    "property",
    "art",
    "wine",
    "collectable",
    "watch",
    "vehicle",
    "boat",
    "company",
    "cash",
    "crypto",
    "pension",
    "metals",
  ],
  moneyAndCover: [
    "card",
    "mortgage",
    "investment-public",
    "investment-private",
    "insurance-health",
    "insurance-life",
    "insurance-home",
    "insurance-vehicle",
    "insurance-travel",
  ],
  actions: [
    "plus",
    "minus",
    "close",
    "check",
    "chevron-left",
    "chevron-right",
    "chevron-up",
    "chevron-down",
    "eye",
    "eye-off",
    "edit",
    "trash",
    "upload",
    "download",
    "camera",
    "image",
    "filter",
    "sort",
    "share",
    "external",
    "expand",
    "play",
    "grid",
    "list",
    "pie",
    "bars",
    "table",
    "trend",
    "map",
    "lock",
    "star",
    "target",
  ],
  status: ["check", "warning", "close", "info"],
} as const satisfies Record<string, readonly IconName[]>;

export type IconGroup = keyof typeof ICON_GROUPS;

/** DS-12 item 5: parent → child pairs. */
export const ICON_PARENT_CHILD: readonly (readonly [IconName, IconName])[] = [
  ["debts", "mortgage"],
  ["investments", "investment-public"],
  ["investments", "investment-private"],
  ["insurance", "insurance-health"],
  ["insurance", "insurance-life"],
  ["insurance", "insurance-home"],
  ["insurance", "insurance-vehicle"],
  ["insurance", "insurance-travel"],
];

export const isIconName = (v: unknown): v is IconName =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(GLYPHS, v);

/** DS-12 item 3: tones. */
export type IconTone = "default" | "muted" | "brand" | "on-brand";

/** DS-12 item 9: only pointing icons mirror in right-to-left languages. */
const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>(["chevron-left", "chevron-right"]);

/**
 * The bare SVG. `stroke` is the line weight in screen pixels at any `px` (absolute, DS-12 item 2);
 * pass `absoluteStroke={false}` to treat it as grid units instead (a large, thin picture such as
 * the photo placeholder).
 */
export function IconSvg({
  name,
  px,
  stroke = ICON_STROKE,
  absoluteStroke = true,
}: {
  name: IconName;
  px: number;
  stroke?: number;
  absoluteStroke?: boolean;
}) {
  const id = `ws-m-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const sw = absoluteStroke ? Math.round(((stroke * 24) / px) * 1000) / 1000 : stroke;
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      {GLYPHS[name]({ id, sw })}
    </svg>
  );
}

/**
 * `<Icon name size tone label>`. Sizes 16 (text, chips), 20 (buttons), 24 (navigation, rows —
 * default), 32 and 40 (empty states). Decorative (hidden from screen readers) unless `label` is
 * given — then it is one image with that name (DS-12 item 6).
 */
export function Icon({
  name,
  size = 24,
  tone = "default",
  label,
}: {
  name: IconName;
  size?: IconSize;
  tone?: IconTone;
  label?: string;
}) {
  const cls = ["ws-icon", tone !== "default" && `ws-icon-${tone}`, DIRECTIONAL.has(name) && "ws-dir-flip"]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={cls}
      data-size={size}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <IconSvg name={name} px={size} />
    </span>
  );
}

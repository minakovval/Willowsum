import { useId, type ReactNode } from "react";
import { ICON_STROKE, type IconSize } from "../tokens/layout.ts";

/**
 * The Willowsum icon set — DS-12. One 24 px grid, a 1.75 px stroke with round caps and joins,
 * outline only, `currentColor`, so icons follow the theme without separate files. Child icons
 * inherit the parent glyph: mortgage = debts + a house; public / private investment =
 * investments + a globe / padlock; insurance kinds keep the shield with a sign inside.
 *
 * The glyphs are the product's own drawings (ported from the previous Willowsum prototype), so
 * no third-party icon licence applies. Dots are drawn as tiny stroked circles: with round caps
 * they read as dots while staying outline-only.
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

type Glyph = (maskId: string, stroke: number) => ReactNode;

/* Glyphs ported from the Willowsum design board (wealth-platform docs/design/willowsum/components/Icon). */
const GLYPHS: Record<IconName, Glyph> = {
  home: () => (
    <>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  accounts: () => (
    <>
      <path d="M3 9.5L12 4l9 5.5H3z" />
      <path d="M6 12v5M10 12v5M14 12v5M18 12v5" />
      <path d="M3 20h18" />
    </>
  ),
  transactions: () => (
    <>
      <path d="M4 8h14" />
      <path d="M14 4l4 4-4 4" />
      <path d="M20 16H6" />
      <path d="M10 12l-4 4 4 4" />
    </>
  ),
  budget: () => (
    <>
      <path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
      <circle cx="16" cy="13.5" r="1" />
    </>
  ),
  goals: () => (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </>
  ),
  assets: () => (
    <>
      <path d="M6 4h12l4 5-10 11L2 9z" />
      <path d="M2 9h20" />
      <path d="M10 4L8 9l4 11 4-11-2-5" />
    </>
  ),
  investments: () => (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  debts: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 15.5l7-7" />
      <circle cx="9" cy="9" r="1.1" />
      <circle cx="15" cy="15" r="1.1" />
    </>
  ),
  locations: () => (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  map: () => (
    <>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  documents: () => (
    <>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  vault: () => (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1" />
    </>
  ),
  insurance: () => (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  reports: () => (
    <>
      <path d="M5 20v-7M12 20V5M19 20V10" />
      <path d="M3 21h18" />
    </>
  ),
  notifications: () => (
    <>
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  assistant: () => (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </>
  ),
  household: () => (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17 14c2.8 0 5 2.2 5 5" />
    </>
  ),
  settings: () => (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  plans: () => (
    <>
      <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5l-5.4 3 1.2-6L3.3 9.3l6.1-.7z" />
    </>
  ),
  wishlist: () => (
    <>
      <path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" />
    </>
  ),
  integrations: () => (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  search: () => (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  more: () => (
    <>
      <circle cx="5" cy="12" r=".6" />
      <circle cx="12" cy="12" r=".6" />
      <circle cx="19" cy="12" r=".6" />
    </>
  ),
  property: () => (
    <>
      <path d="M5 21V4h9v17" />
      <path d="M14 9h5v12" />
      <path d="M8 8h3M8 12h3M8 16h3" />
      <path d="M3 21h18" />
    </>
  ),
  art: () => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <rect x="6" y="7" width="12" height="10" />
      <path d="M6 15l4-4 3 3 2-2 3 3" />
    </>
  ),
  wine: () => (
    <>
      <path d="M10 3h4v5c2 1.5 3 3 3 5v7a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-7c0-2 1-3.5 3-5z" />
      <path d="M7 14h10" />
    </>
  ),
  collectable: () => (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </>
  ),
  watch: () => (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M9 7l.8-4h4.4l.8 4M9 17l.8 4h4.4l.8-4" />
      <path d="M12 10v2.2l1.5 1" />
    </>
  ),
  vehicle: () => (
    <>
      <path d="M3 16v-4l2-5a2 2 0 0 1 1.9-1.3h10.2A2 2 0 0 1 19 7l2 5v4" />
      <path d="M3 12h18" />
      <path d="M3 16h1.7M9.3 16h5.4M19.3 16H21" />
      <circle cx="7.5" cy="16" r="2" />
      <circle cx="16.5" cy="16" r="2" />
    </>
  ),
  boat: () => (
    <>
      <path d="M3 15l2 5h14l2-5z" />
      <path d="M12 3v12" />
      <path d="M12 4l7 9h-7" />
    </>
  ),
  company: () => (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </>
  ),
  cash: () => (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  crypto: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5H15" />
    </>
  ),
  pension: () => (
    <>
      <path d="M3 12a9 9 0 0 1 18 0z" />
      <path d="M12 12v6a2 2 0 0 0 4 0" />
    </>
  ),
  metals: () => (
    <>
      <path d="M2 18l2.5-5h6L13 18z" />
      <path d="M11 18l2.5-5h6L22 18z" />
      <path d="M6.5 13L9 8h6l2.5 5" />
    </>
  ),
  plus: () => (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  close: () => (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ),
  check: () => (
    <>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </>
  ),
  "chevron-left": () => (
    <>
      <path d="M15 5l-7 7 7 7" />
    </>
  ),
  "chevron-right": () => (
    <>
      <path d="M9 5l7 7-7 7" />
    </>
  ),
  "chevron-up": () => (
    <>
      <path d="M5 15l7-7 7 7" />
    </>
  ),
  "chevron-down": () => (
    <>
      <path d="M5 9l7 7 7-7" />
    </>
  ),
  eye: () => (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": () => (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 4l16 16" />
    </>
  ),
  edit: () => (
    <>
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </>
  ),
  trash: () => (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </>
  ),
  upload: () => (
    <>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
    </>
  ),
  download: () => (
    <>
      <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
    </>
  ),
  camera: () => (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  image: () => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M3 17l5-5 4 4 3-3 6 6" />
    </>
  ),
  filter: () => (
    <>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </>
  ),
  sort: () => (
    <>
      <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
    </>
  ),
  share: () => (
    <>
      <path d="M12 15V3M8 7l4-4 4 4M5 12v8h14v-8" />
    </>
  ),
  info: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.5" r=".2" />
    </>
  ),
  warning: () => (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="18" r=".2" />
    </>
  ),
  external: () => (
    <>
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </>
  ),
  lock: () => (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  expand: () => (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </>
  ),
  play: () => (
    <>
      <path d="M7 4l13 8-13 8z" />
    </>
  ),
  grid: () => (
    <>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </>
  ),
  pie: () => (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </>
  ),
  bars: () => (
    <>
      <path d="M4 20h16" />
      <path d="M6 20v-7M11 20V6M16 20v-10" />
    </>
  ),
  table: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10h17M3.5 15h17M9.5 4.5v15" />
    </>
  ),
  trend: () => (
    <>
      <path d="M3 17l5.5-6 4 3.5L21 6" />
      <path d="M15 6h6v6" />
    </>
  ),
  card: () => (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M6.5 15h4" />
    </>
  ),
  mortgage: (m, sw) => (
    <>
      <mask id={m}>
        <rect width="24" height="24" fill="white" />
        <circle cx="18.2" cy="18.2" r="6" fill="black" />
      </mask>
      <g mask={`url(#${m})`}>
        <g transform="scale(.74)" strokeWidth={sw / 0.74}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 15.5l7-7" />
          <circle cx="9" cy="9" r="1.1" />
          <circle cx="15" cy="15" r="1.1" />
        </g>
      </g>
      <g transform="translate(18.2 18.2)">
        <path d="M-4.4 0L0 -4.2 4.4 0" />
        <path d="M-3.2 -.8V4.2h6.4V-.8" />
      </g>
    </>
  ),
  "insurance-health": () => (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M12 8v7M8.5 11.5h7" />
    </>
  ),
  "insurance-life": () => (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M12 16s-4-2.4-4-5.2a2.1 2.1 0 0 1 4-1.1 2.1 2.1 0 0 1 4 1.1c0 2.8-4 5.2-4 5.2z" />
    </>
  ),
  "insurance-home": () => (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M8.5 12l3.5-3.3 3.5 3.3" />
      <path d="M9.7 11.2v4.2h4.6v-4.2" />
    </>
  ),
  "insurance-vehicle": () => (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M8 14.5v-2.3l1-2.4h6l1 2.4v2.3" />
      <path d="M8 12.2h8" />
      <path d="M9.2 14.5h.01M14.8 14.5h.01" />
    </>
  ),
  "insurance-travel": () => (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <rect x="8.8" y="10" width="6.4" height="5" rx="1" />
      <path d="M10.6 10V8.8h2.8V10" />
    </>
  ),
  "investment-public": (m, sw) => (
    <>
      <mask id={m}>
        <rect width="24" height="24" fill="white" />
        <circle cx="17.4" cy="17.4" r="7.1" fill="black" />
      </mask>
      <g mask={`url(#${m})`}>
        <g transform="scale(.8)" strokeWidth={sw / 0.8}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </g>
      </g>
      <g transform="translate(17.4 17.4)">
        <circle r="4.2" />
        <path d="M-4.2 0h8.4M0 -4.2c-2.2 2.4-2.2 6 0 8.4M0 -4.2c2.2 2.4 2.2 6 0 8.4" />
      </g>
    </>
  ),
  "investment-private": (m, sw) => (
    <>
      <mask id={m}>
        <rect width="24" height="24" fill="white" />
        <circle cx="17.4" cy="17.4" r="7.1" fill="black" />
      </mask>
      <g mask={`url(#${m})`}>
        <g transform="scale(.8)" strokeWidth={sw / 0.8}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </g>
      </g>
      <g transform="translate(17.4 17.4)">
        <rect x="-3.4" y="-1" width="6.8" height="5" rx="1" />
        <path d="M-1.9 -1v-1.3a1.9 1.9 0 0 1 3.8 0V-1" />
      </g>
    </>
  ),
  list: () => (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  star: () => (
    <>
      <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5l-5.4 3 1.2-6L3.3 9.3l6.1-.7z" />
    </>
  ),
  minus: () => (
    <>
      <path d="M5 12h14" />
    </>
  ),
  target: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r=".6" />
    </>
  ),
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

/** The bare SVG; `px` and `stroke` are free so pictures (photo placeholder) can draw it large and thin. */
export function IconSvg({ name, px, stroke = ICON_STROKE }: { name: IconName; px: number; stroke?: number }) {
  const maskId = `ws-m-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      {GLYPHS[name](maskId, stroke)}
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

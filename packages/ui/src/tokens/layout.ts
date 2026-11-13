/** Breakpoints and layout — DS-10, DS-09 item 8, CMP-69. All values in px. */

/** DS-10 item 3. `min` is the smallest supported width. */
export const breakpoints = {
  min: 360,
  medium: 600,
  wide: 1024,
  sidebar: 1280,
  large: 1440,
} as const;

export type WidthClass = "narrow" | "medium" | "wide" | "large";

export interface WidthClassSpec {
  from: number;
  /** Inclusive upper bound; `null` for no limit. */
  to: number | null;
  columns: number;
  margin: number;
  gutter: number;
  /** Gap between page bands (DS-10 item 5). */
  bandGap: number;
  /** Card inner padding (DS-09 item 2). */
  cardPadding: number;
}

/** DS-10 item 2. The narrow class starts at 0 so widths under 360 px still get it (edge case). */
export const widthClasses: Readonly<Record<WidthClass, WidthClassSpec>> = {
  narrow: { from: 0, to: 599, columns: 4, margin: 16, gutter: 16, bandGap: 32, cardPadding: 16 },
  medium: { from: 600, to: 1023, columns: 8, margin: 24, gutter: 24, bandGap: 32, cardPadding: 24 },
  wide: { from: 1024, to: 1439, columns: 12, margin: 32, gutter: 24, bandGap: 48, cardPadding: 24 },
  large: { from: 1440, to: null, columns: 12, margin: 32, gutter: 24, bandGap: 48, cardPadding: 24 },
};

export const widthClassOf = (width: number): WidthClass =>
  width >= breakpoints.large
    ? "large"
    : width >= breakpoints.wide
      ? "wide"
      : width >= breakpoints.medium
        ? "medium"
        : "narrow";

export type NavForm = "bottom" | "rail" | "sidebar";

/** DS-10 acceptance 1 / CMP-69: bottom bar < 600, rail 600–1279, sidebar ≥ 1280. */
export const navFormOf = (width: number): NavForm =>
  width >= breakpoints.sidebar ? "sidebar" : width >= breakpoints.medium ? "rail" : "bottom";

export const layout = {
  "content-max": 1200,
  "rail-width": 64,
  "sidebar-width": 212,
  /** CMP-69: bottom bar height without the safe area. */
  "bottom-bar-height": 56,
  /** CMP-69: compact top row. */
  "top-bar-height": 56,
  "rail-item": 56,
  "sidebar-item-height": 40,
  "sidebar-header-height": 64,
  /** DS-10 item 9, DS-14 item 7. */
  "touch-target": 44,
  "focus-ring-width": 3,
  "focus-ring-offset": 2,
  /** DS-10 item 7: a table becomes a stack of cards below this container width. */
  "table-stack-below": 520,
} as const;

export const iconSizes = [16, 20, 24, 32, 40] as const;
export type IconSize = (typeof iconSizes)[number];
/** DS-12 item 2: 1.8 px stroke (canvas P0); «+» and «✓» inside buttons use 2 px. */
export const ICON_STROKE = 1.8;
export const ICON_STROKE_BUTTON = 2;
/** DS-12@PoC item 2: dots («ще», «список», «інфо») are solid dots 2.5 px across on screen. */
export const ICON_DOT = 2.5;

/** Media query strings for matchMedia; CSS cannot read custom properties inside @media. */
export const mediaQueries = {
  medium: `(min-width: ${breakpoints.medium}px)`,
  wide: `(min-width: ${breakpoints.wide}px)`,
  sidebar: `(min-width: ${breakpoints.sidebar}px)`,
  large: `(min-width: ${breakpoints.large}px)`,
  reducedMotion: "(prefers-reduced-motion: reduce)",
  dark: "(prefers-color-scheme: dark)",
} as const;

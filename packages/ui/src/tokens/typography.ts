/**
 * Typography — DS-08. Sizes are authored in px as in the requirement and emitted in rem (DS-08
 * item 7: text follows the system font size up to 200 %). Tracking is a fraction of the font size.
 */

export const fontFamilies = {
  /** Headings, large numbers, wordmark. */
  display: '"Inter Tight", system-ui, sans-serif',
  /** Interface text, captions, tables, amounts. */
  sans: '"Inter", system-ui, sans-serif',
} as const;

export type FontFamilyName = keyof typeof fontFamilies;

export interface TypeStyle {
  family: FontFamilyName;
  size: number;
  lineHeight: number;
  weight: 400 | 500 | 600;
  /** em; −0.03 is −3 %. */
  tracking: number;
  uppercase?: true;
  tabularNumbers?: true;
  usage: string;
}

/** DS-08 item 3. */
export const typeScale = {
  "display-xl": {
    family: "display",
    size: 56,
    lineHeight: 60,
    weight: 600,
    tracking: -0.03,
    usage: "Hero lines, large wordmark",
  },
  "display-l": {
    family: "display",
    size: 40,
    lineHeight: 44,
    weight: 600,
    tracking: -0.025,
    usage: "Screen titles on wide layouts",
  },
  "heading-1": {
    family: "display",
    size: 28,
    lineHeight: 34,
    weight: 600,
    tracking: -0.02,
    usage: "Page heading (one per page)",
  },
  "heading-2": {
    family: "display",
    size: 22,
    lineHeight: 28,
    weight: 600,
    tracking: -0.015,
    usage: "Section and card heading",
  },
  "heading-3": {
    family: "display",
    size: 18,
    lineHeight: 24,
    weight: 600,
    tracking: -0.01,
    usage: "Small heading above a list",
  },
  body: {
    family: "sans",
    size: 16,
    lineHeight: 24,
    weight: 400,
    tracking: 0,
    usage: "Running text and list rows",
  },
  "body-sm": {
    family: "sans",
    size: 14,
    lineHeight: 20,
    weight: 400,
    tracking: 0,
    usage: "Base app text, captions, hints, table cells",
  },
  label: {
    family: "sans",
    size: 13,
    lineHeight: 16,
    weight: 500,
    tracking: 0.08,
    uppercase: true,
    usage: "Labels above fields and amounts, capitals only",
  },
  action: { family: "sans", size: 15, lineHeight: 20, weight: 600, tracking: 0, usage: "Button text" },
  "amount-xl": {
    family: "sans",
    size: 40,
    lineHeight: 44,
    weight: 600,
    tracking: -0.01,
    tabularNumbers: true,
    usage: "Total on Home",
  },
  "amount-l": {
    family: "sans",
    size: 28,
    lineHeight: 32,
    weight: 600,
    tracking: -0.01,
    tabularNumbers: true,
    usage: "Account totals",
  },
  "amount-m": {
    family: "sans",
    size: 16,
    lineHeight: 24,
    weight: 600,
    tracking: 0,
    tabularNumbers: true,
    usage: "Amounts in list rows",
  },
} as const satisfies Record<string, TypeStyle>;

/**
 * DS-08 item 4 (component sizes) and CMP-69 (navigation labels). The map cluster number has no
 * line height in DS-08; it is set equal to the font size (single line inside a circle).
 */
export const componentTypeScale = {
  "chart-axis": {
    family: "sans",
    size: 12,
    lineHeight: 16,
    weight: 400,
    tracking: 0,
    tabularNumbers: true,
    usage: "Chart axis and scale labels",
  },
  tooltip: { family: "sans", size: 13, lineHeight: 18, weight: 400, tracking: 0, usage: "Tooltip text" },
  badge: { family: "sans", size: 13, lineHeight: 20, weight: 500, tracking: 0, usage: "Status badge text" },
  "map-cluster": {
    family: "sans",
    size: 14,
    lineHeight: 14,
    weight: 600,
    tracking: 0,
    tabularNumbers: true,
    usage: "Number in a map cluster",
  },
  "nav-bottom": {
    family: "sans",
    size: 12,
    lineHeight: 16,
    weight: 500,
    tracking: 0,
    usage: "Bottom bar label (CMP-69)",
  },
  "nav-rail": {
    family: "sans",
    size: 11,
    lineHeight: 14,
    weight: 500,
    tracking: 0,
    usage: "Rail label (CMP-69)",
  },
  "nav-sidebar": {
    family: "sans",
    size: 14,
    lineHeight: 20,
    weight: 500,
    tracking: 0,
    usage: "Sidebar item (CMP-69)",
  },
  "nav-count": {
    family: "sans",
    size: 11,
    lineHeight: 14,
    weight: 600,
    tracking: 0,
    tabularNumbers: true,
    usage: "Navigation count badge (CMP-69)",
  },
} as const satisfies Record<string, TypeStyle>;

export type TypeStyleName = keyof typeof typeScale;
export type ComponentTypeStyleName = keyof typeof componentTypeScale;

/** px → rem at the 16 px root. */
export const rem = (px: number): string => `${+(px / 16).toFixed(4)}rem`;

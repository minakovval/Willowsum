/**
 * Colour tokens — DS-06 (base tokens and roles) and DS-02 (named brand colours). Values are exactly
 * the requirement tables; this file and the CSS generated from it are the only places in the code
 * where colour literals are allowed (DS-06, item 1 and acceptance criterion 3).
 */

export type ThemeName = "light" | "dark";
export const THEMES: readonly ThemeName[] = ["light", "dark"];

export type ColorTokenName =
  | "surface-100"
  | "surface-200"
  | "surface-300"
  | "ink"
  | "ink-muted"
  | "line"
  | "border-control"
  | "brand"
  | "brand-hover"
  | "brand-pressed"
  | "on-brand"
  | "brand-2"
  | "accent"
  | "on-accent"
  | "link"
  | "focus"
  | "gain"
  | "loss"
  | "disabled-bg"
  | "disabled-ink"
  | "overlay";

export interface ColorToken {
  light: string;
  dark: string;
  /** The «Призначення» column of DS-06, in English for developers. */
  usage: string;
}

/** DS-06 item 2, row for row. */
export const colors: Readonly<Record<ColorTokenName, ColorToken>> = {
  "surface-100": {
    light: "#FBFBFA",
    dark: "#0B2545",
    usage: "Page background. Text on it: ink, ink-muted, link.",
  },
  "surface-200": {
    light: "#FFFFFF",
    dark: "#12305A",
    usage: "Cards, inputs, bottom sheets on surface-100. Text: ink, ink-muted, link.",
  },
  "surface-300": {
    light: "#F1F1EF",
    dark: "#1B3F6E",
    usage: "Sunken areas: progress tracks, table stripes, quiet button hover. Text: ink only.",
  },
  ink: {
    light: "#1B2230",
    dark: "#F6F1E8",
    usage: "Body text, headings and amounts on surface-100, -200, -300.",
  },
  "ink-muted": {
    light: "#566174",
    dark: "#9DB2C8",
    usage: "Secondary text, captions, hints on surface-100 and surface-200.",
  },
  line: {
    light: "#E5E5E2",
    dark: "#24456F",
    usage: "Hairline dividers and card borders; decorative, never the only edge of a control.",
  },
  "border-control": {
    light: "#7B8494",
    dark: "#6F8CB0",
    usage: "Input borders and progress tracks; at least 3:1 on surface-100 and surface-200.",
  },
  brand: {
    light: "#0B2545",
    dark: "#EBDFC6",
    usage: "Large leaf; primary button fill, strong text accents.",
  },
  "brand-hover": { light: "#173A66", dark: "#F3EAD6", usage: "Primary button fill on hover." },
  "brand-pressed": { light: "#061833", dark: "#D8CBAE", usage: "Primary button fill when pressed." },
  "on-brand": {
    light: "#F6F1E8",
    dark: "#0B2545",
    usage: "Text and icons on brand, brand-hover, brand-pressed.",
  },
  "brand-2": {
    light: "#1D4E89",
    dark: "#9DB2C8",
    usage: "Middle leaf; charts and secondary marks; at least 3:1 on surface-100 and surface-200.",
  },
  accent: {
    light: "#E3A33B",
    dark: "#E3A33B",
    usage: "Small leaf; goal or next step only; fill only, one per screen; never text.",
  },
  "on-accent": { light: "#0B2545", dark: "#0B2545", usage: "Text on an accent fill." },
  link: {
    light: "#1D4E89",
    dark: "#9DB2C8",
    usage: "Links and quiet buttons on surface-100 and surface-200.",
  },
  focus: {
    light: "#1D4E89",
    dark: "#E3A33B",
    usage: "Focus ring: 3 px solid, 2 px offset; at least 3:1 on surface-100 and surface-200.",
  },
  gain: {
    light: "#27704C",
    dark: "#58C38F",
    usage: "Positive change, text on surface-100 and surface-200; always with sign and arrow.",
  },
  loss: {
    light: "#B23A3A",
    dark: "#F09090",
    usage: "Negative change and error text on surface-100 and surface-200.",
  },
  "disabled-bg": {
    light: "#E7E1D3",
    dark: "#1B3F6E",
    usage: "Disabled control fill; exempt from contrast, only with disabled-ink.",
  },
  "disabled-ink": { light: "#8A8F99", dark: "#6F86A6", usage: "Disabled control text on disabled-bg." },
  overlay: {
    light: "rgba(11, 37, 69, 0.45)",
    dark: "rgba(0, 0, 0, 0.6)",
    usage: "Scrim under dialogs, bottom sheets and the drawer.",
  },
};

export const COLOR_TOKEN_NAMES = Object.keys(colors) as ColorTokenName[];

/** DS-06 item 6 / DS-02 item 5: named brand colours. */
export const brandColors = {
  navy: "#0B2545",
  blue: "#1D4E89",
  amber: "#E3A33B",
  steel: "#9DB2C8",
  sand: "#EBDFC6",
  paper: "#F6F1E8",
} as const;

export type ContrastKind = "text" | "ui";

/** WCAG 2.2 AA minimums used by DS-06 item 4. */
export const CONTRAST_MINIMUM: Readonly<Record<ContrastKind, number>> = { text: 4.5, ui: 3 };

export interface ContrastPair {
  fg: ColorTokenName;
  bg: ColorTokenName;
  kind: ContrastKind;
  /** Where the pair comes from. */
  source: string;
}

const textOn = (fg: ColorTokenName, bgs: ColorTokenName[], source: string): ContrastPair[] =>
  bgs.map((bg) => ({ fg, bg, kind: "text", source }));
const uiOn = (fg: ColorTokenName, bgs: ColorTokenName[], source: string): ContrastPair[] =>
  bgs.map((bg) => ({ fg, bg, kind: "ui", source }));

/**
 * Every pair named in the token purposes (DS-06 item 2), status tones (DS-07 item 1) and chart
 * marks (DS-07 items 4, 6, 8). Text pairs need 4.5:1, interface and graphic pairs 3:1, in both
 * themes. `disabled-*` is exempt by WCAG and DS-06; `accent` is never text.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...textOn("ink", ["surface-100", "surface-200", "surface-300"], "DS-06 ink"),
  ...textOn("ink-muted", ["surface-100", "surface-200"], "DS-06 ink-muted"),
  ...textOn("link", ["surface-100", "surface-200"], "DS-06 link"),
  ...textOn("gain", ["surface-100", "surface-200"], "DS-06 gain"),
  ...textOn("loss", ["surface-100", "surface-200"], "DS-06 loss"),
  ...textOn("brand", ["surface-100", "surface-200"], "DS-06 brand (strong text accents)"),
  ...textOn("on-brand", ["brand", "brand-hover", "brand-pressed"], "DS-06 on-brand"),
  ...textOn("on-accent", ["accent"], "DS-06 on-accent"),
  ...textOn("on-brand", ["brand-2"], "CMP-69 navigation badge"),
  ...uiOn("border-control", ["surface-100", "surface-200"], "DS-06 border-control"),
  ...uiOn("brand-2", ["surface-100", "surface-200"], "DS-06 brand-2"),
  ...uiOn("focus", ["surface-100", "surface-200"], "DS-06 / DS-14 focus ring"),
  ...uiOn("surface-200", ["gain", "loss"], "DS-07 status marker symbol"),
  ...uiOn("surface-100", ["ink", "link"], "DS-07 status marker symbol"),
  ...uiOn("brand", ["surface-200"], "DS-07 chart step 1"),
  ...uiOn("ink-muted", ["surface-200"], "DS-07 chart step 3 / series 2"),
];

/** Pairs that only hold in one theme and are therefore checked only there. */
export const THEME_ONLY_PAIRS: readonly (ContrastPair & { theme: ThemeName })[] = [
  { fg: "accent", bg: "surface-100", kind: "ui", source: "DS-06 amber on navy page (dark)", theme: "dark" },
];

/**
 * DS-07 item 4: chart fill palette, five steps for every chart. Step 5 («Інше») is a 45° hatch of
 * 3 px ink-muted and 3 px surface-200 stripes.
 */
export const CHART_FILL_STEPS: readonly ColorTokenName[] = [
  "brand",
  "brand-2",
  "ink-muted",
  "border-control",
];

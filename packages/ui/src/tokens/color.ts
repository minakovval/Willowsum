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
  | "gain-soft"
  | "loss-soft"
  | "disabled-bg"
  | "disabled-ink"
  | "overlay"
  | "surface-inset"
  | "tint-info"
  | "tint-warning"
  | "on-warning"
  | "warning-line"
  | "tint-positive"
  | "tint-negative"
  | "skeleton"
  | "chart-cat-1"
  | "chart-cat-2"
  | "chart-cat-3"
  | "chart-cat-4"
  | "chart-cat-5"
  | "chart-cat-6"
  | "chart-cat-7"
  | "chart-cat-8"
  | "chart-group-income-1"
  | "chart-group-income-2"
  | "chart-transfer"
  | "chart-other"
  | "chart-reference"
  | "usage-0"
  | "usage-30"
  | "usage-55"
  | "usage-75"
  | "usage-95"
  | "over-1"
  | "over-2"
  | "over-3"
  | "over-4"
  | "over-5"
  | "over-6"
  | "over-7"
  | "over-8"
  | "goal-0"
  | "goal-25"
  | "goal-55"
  | "goal-80"
  | "goal-100"
  | "goal-paused"
  | "scrim";

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
  // Issue #51: the light steps of gain and loss and the chart warning marker. Light values are the
  // DS-06@PoC table; dark values are the DS-06@MVP table and the design-system snapshot (PoC is light only).
  "gain-soft": {
    light: "#387F5A",
    dark: "#3EAC79",
    usage:
      "Light step of gain («трохи краще»): change or deviation up to 10 % inclusive; always with an arrow.",
  },
  "loss-soft": {
    light: "#C34A48",
    dark: "#DD7F7F",
    usage:
      "Light step of loss («трохи гірше»): change or deviation up to 10 % inclusive; always with an arrow.",
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
    usage: "Scrim under bottom sheets and the drawer.",
  },
  // Canvas P0 (owner decision 2026-11-05): surfaces, tints, charts, goals and the dialog scrim.
  "surface-inset": {
    light: "#FAFAF8",
    dark: "#0F2B50",
    usage: "Inset area inside a card: dialog action bar, banner, halves of a pair.",
  },
  "tint-info": {
    light: "#EEF2F7",
    dark: "#1B3F6E",
    usage: "Info badge, active sort, selected row, filter chip, current step. Text: link or ink.",
  },
  "tint-warning": {
    light: "#FBF3E8",
    dark: "#3A3122",
    usage: "Attention badge and warning banner ground. Text: on-warning.",
  },
  "on-warning": {
    light: "#7A4505",
    dark: "#F2C27A",
    usage: "Text and «!» marker on tint-warning; also «! Відстає» on goals.",
  },
  "warning-line": {
    light: "#A15C07",
    dark: "#E0A04A",
    usage:
      "Warning marker on a chart; at least 3:1 on tint-warning and surface-200. Always with «!» and a word.",
  },
  "tint-positive": { light: "#E9F3EE", dark: "#173F36", usage: "Positive badge ground. Text: gain." },
  "tint-negative": {
    light: "#F8ECEC",
    dark: "#4A2532",
    usage: "Negative badge ground and danger button hover. Text: loss.",
  },
  skeleton: { light: "#ECEEF1", dark: "#1B3F6E", usage: "Skeleton fill while loading." },
  "chart-cat-1": {
    light: "#5872D2",
    dark: "#5872D2",
    usage: "Chart palette tone 1 (DS-07 item 15): «Житло» group and categorical series 1.",
  },
  "chart-cat-2": {
    light: "#0E9161",
    dark: "#0E9161",
    usage: "Chart palette tone 2: «Харчування» group and categorical series 2.",
  },
  "chart-cat-3": {
    light: "#9C7305",
    dark: "#9C7305",
    usage: "Chart palette tone 3: «Транспорт і авто» group and categorical series 3.",
  },
  "chart-cat-4": {
    light: "#097FCD",
    dark: "#097FCD",
    usage: "Chart palette tone 4: «Зв'язок і підписки» group and categorical series 4.",
  },
  "chart-cat-5": {
    light: "#C35047",
    dark: "#C35047",
    usage: "Chart palette tone 5: «Здоров'я і догляд» group and categorical series 5.",
  },
  "chart-cat-6": {
    light: "#9B5BB6",
    dark: "#9B5BB6",
    usage: "Chart palette tone 6: «Родина» group and categorical series 6.",
  },
  "chart-cat-7": {
    light: "#0F899B",
    dark: "#0F899B",
    usage: "Chart palette tone 7: «Відпочинок» group and categorical series 7.",
  },
  "chart-cat-8": {
    light: "#678800",
    dark: "#678800",
    usage: "Chart palette tone 8: «Фінанси і податки» group and categorical series 8.",
  },
  "chart-group-income-1": {
    light: "#BA4E84",
    dark: "#BA4E84",
    usage: "Income group «Дохід від роботи»; not in the series palette.",
  },
  "chart-group-income-2": {
    light: "#BE590F",
    dark: "#BE590F",
    usage: "Income group «Інші доходи»; not in the series palette.",
  },
  "chart-transfer": {
    light: "#9DB2C8",
    dark: "#9DB2C8",
    usage: "Service category «Переказ» (BUD-01); dark text on it.",
  },
  "chart-other": {
    light: "#9AA3AF",
    dark: "#9AA3AF",
    usage: "«Інші · N» and «Коригування» on charts; always last.",
  },
  "chart-reference": {
    light: "rgba(27, 34, 48, 0.6)",
    dark: "rgba(246, 241, 232, 0.6)",
    usage: "Reference lines: plan and goal target dash 4/4, budget dash 12/4 (ink at 60 %).",
  },
  "usage-0": {
    light: "#0E7A3B",
    dark: "#0E7A3B",
    usage: "Limit usage gradient stop 0 % (oklch); a fill, never text.",
  },
  "usage-30": { light: "#34A853", dark: "#34A853", usage: "Limit usage gradient stop 30 %." },
  "usage-55": { light: "#7CC242", dark: "#7CC242", usage: "Limit usage gradient stop 55 %." },
  "usage-75": { light: "#C9C21A", dark: "#C9C21A", usage: "Limit usage gradient stop 75 %." },
  "usage-95": {
    light: "#FBBC05",
    dark: "#FBBC05",
    usage: "Limit usage gradient stop 95–100 %; not the accent amber.",
  },
  "over-1": {
    light: "#E3A39B",
    dark: "#E3A39B",
    usage: "Overspend level 1: below 5 %; also «вичерпано» of an optional category.",
  },
  "over-2": { light: "#DE7A6F", dark: "#DE7A6F", usage: "Overspend level 2: 5–10 %." },
  "over-3": { light: "#E5584A", dark: "#E5584A", usage: "Overspend level 3: 10–20 %." },
  "over-4": { light: "#F2281A", dark: "#F2281A", usage: "Overspend level 4: 20–50 %." },
  "over-5": { light: "#D21C10", dark: "#D21C10", usage: "Overspend level 5: 50–100 %." },
  "over-6": { light: "#B5180C", dark: "#B5180C", usage: "Overspend level 6: 100–200 %." },
  "over-7": { light: "#94130A", dark: "#94130A", usage: "Overspend level 7: 200–500 %." },
  "over-8": {
    light: "#7A0F08",
    dark: "#7A0F08",
    usage: "Overspend level 8: from 500 %; also when no optional limits exist.",
  },
  "goal-0": { light: "#FFD000", dark: "#FFD000", usage: "Goal progress gradient stop 0 % (oklch)." },
  "goal-25": { light: "#E6CF1A", dark: "#E6CF1A", usage: "Goal progress gradient stop 25 %." },
  "goal-55": { light: "#9ACD32", dark: "#9ACD32", usage: "Goal progress gradient stop 55 %." },
  "goal-80": { light: "#4CAF50", dark: "#4CAF50", usage: "Goal progress gradient stop 80 %." },
  "goal-100": {
    light: "#2E7D32",
    dark: "#2E7D32",
    usage: "Goal progress gradient stop 100 %; an achieved goal and above target.",
  },
  "goal-paused": { light: "#C5CAD1", dark: "#C5CAD1", usage: "Goal bar «На паузі»." },
  scrim: {
    light: "rgba(11, 37, 69, 0.36)",
    dark: "rgba(0, 0, 0, 0.55)",
    usage: "Scrim under a modal dialog, with a 2 px backdrop blur.",
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
  ...textOn("gain-soft", ["surface-100", "surface-200"], "DS-06 gain-soft (#51)"),
  ...textOn("loss-soft", ["surface-100", "surface-200"], "DS-06 loss-soft (#51)"),
  ...textOn("brand", ["surface-100", "surface-200"], "DS-06 brand (strong text accents)"),
  ...textOn("on-brand", ["brand", "brand-hover", "brand-pressed"], "DS-06 on-brand"),
  ...textOn("on-accent", ["accent"], "DS-06 on-accent"),
  ...textOn("on-brand", ["brand-2"], "CMP-69 navigation badge"),
  ...uiOn("border-control", ["surface-100", "surface-200"], "DS-06 border-control"),
  ...uiOn("brand-2", ["surface-100", "surface-200"], "DS-06 brand-2"),
  ...uiOn("focus", ["surface-100", "surface-200"], "DS-06 / DS-14 focus ring"),
  ...uiOn("surface-200", ["gain", "loss"], "DS-07 status marker symbol"),
  ...uiOn("surface-100", ["ink", "link"], "DS-07 status marker symbol"),
  ...textOn("gain", ["tint-positive"], "DS-07 positive badge"),
  ...textOn("on-warning", ["tint-warning"], "DS-07 attention badge"),
  ...uiOn("warning-line", ["tint-warning", "surface-200"], "DS-06 warning-line (#51)"),
  ...textOn("loss", ["tint-negative"], "DS-07 negative badge"),
  ...textOn("link", ["tint-info"], "DS-07 info badge"),
  ...textOn("brand", ["tint-info"], "CMP-09 main goal tag"),
  ...textOn("ink-muted", ["surface-300"], "DS-07 neutral badge"),
  ...textOn("brand", ["surface-300"], "CMP-11 / CMP-65 / CMP-69 current tab and navigation item"),
  ...textOn("ink", ["surface-inset", "tint-info"], "DS-06 surface-inset, tint-info"),
  ...uiOn("brand", ["surface-200"], "DS-07 chart step 1"),
  ...uiOn("ink-muted", ["surface-200"], "DS-07 chart step 3 / series 2"),
];

/** Pairs that only hold in one theme and are therefore checked only there. */
export const THEME_ONLY_PAIRS: readonly (ContrastPair & { theme: ThemeName })[] = [
  { fg: "accent", bg: "surface-100", kind: "ui", source: "DS-06 amber on navy page (dark)", theme: "dark" },
];

/**
 * DS-07 item 4: chart fill palette, five steps for every chart. Step 5 («Інше») is a 45° hatch of
 * 3 px ink-muted and 3 px surface-200 stripes. Charts keep the DS-07 scheme (owner, 2026-11-05),
 * not the P0 canvas series colours.
 */
export const CHART_FILL_STEPS: readonly ColorTokenName[] = [
  "brand",
  "brand-2",
  "ink-muted",
  "border-control",
];

/** DS-07 item 15: categorical palette, in its fixed order. */
export const CHART_CATEGORY_PALETTE: readonly ColorTokenName[] = [
  "chart-cat-1",
  "chart-cat-2",
  "chart-cat-3",
  "chart-cat-4",
  "chart-cat-5",
  "chart-cat-6",
  "chart-cat-7",
  "chart-cat-8",
];

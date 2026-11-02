/**
 * Turns the TypeScript tokens into CSS custom properties. The output is committed as
 * `src/styles/tokens.css` (`pnpm --filter @willowsum/ui build` regenerates it; a test fails when it
 * is stale). Theme selection (DS-11 item 5): one `data-theme` attribute on the root element —
 * `light`, `dark`, or absent for «Як у системі» (then `prefers-color-scheme` decides). The same
 * attribute on any element scopes a theme to that subtree (used by the gallery).
 */
import { CHART_FILL_STEPS, colors, COLOR_TOKEN_NAMES, type ThemeName } from "./color.ts";
import { layers, shadows } from "./elevation.ts";
import { breakpoints, layout, widthClasses, type WidthClass } from "./layout.ts";
import { easings, motion } from "./motion.ts";
import { radii, space } from "./spacing.ts";
import { componentTypeScale, fontFamilies, rem, typeScale, type TypeStyle } from "./typography.ts";

export const CSS_PREFIX = "--ws-";
export const cssVar = (name: string): string => `var(${CSS_PREFIX}${name})`;

const decl = (name: string, value: string | number): string => `  ${CSS_PREFIX}${name}: ${value};`;

/** Colour-dependent properties for one theme, including values derived from tokens (DS-07). */
function themeDeclarations(theme: ThemeName): string[] {
  const lines = [`  color-scheme: ${theme};`];
  for (const name of COLOR_TOKEN_NAMES) lines.push(decl(name, colors[name][theme]));
  for (const [name, value] of Object.entries(shadows)) lines.push(decl(name, value[theme]));
  // DS-07 item 4: chart fills 1–4; step 5 is a hatch of ink-muted and surface-200.
  CHART_FILL_STEPS.forEach((token, i) => lines.push(decl(`chart-${i + 1}`, cssVar(token))));
  lines.push(
    decl(
      "chart-other",
      `repeating-linear-gradient(45deg, ${cssVar("ink-muted")} 0 3px, ${cssVar("surface-200")} 3px 6px)`,
    ),
  );
  // DS-07 item 5: fifth stacked-area layer = 45 % ink-muted + 55 % surface-200.
  lines.push(
    decl("chart-area-5", `color-mix(in srgb, ${cssVar("ink-muted")} 45%, ${cssVar("surface-200")})`),
  );
  // DS-07 item 9: heat map levels.
  lines.push(decl("heat-0", cssVar("surface-300")));
  [25, 50, 75].forEach((p, i) =>
    lines.push(
      decl(`heat-${i + 1}`, `color-mix(in srgb, ${cssVar("brand")} ${p}%, ${cssVar("surface-200")})`),
    ),
  );
  lines.push(decl("heat-4", cssVar("brand")));
  // DS-07 item 10: waterfall decrease hatch.
  lines.push(
    decl(
      "chart-loss-hatch",
      `repeating-linear-gradient(45deg, ${cssVar("loss")} 0 3px, ${cssVar("surface-200")} 3px 6px)`,
    ),
  );
  // DS-02 item 5: the mark follows the theme (light: navy/blue/amber, dark: sand/steel/amber).
  lines.push(
    decl("mark-large", cssVar("brand")),
    decl("mark-middle", cssVar("brand-2")),
    decl("mark-small", cssVar("accent")),
  );
  return lines;
}

const typeDeclarations = (name: string, s: TypeStyle): string[] => [
  decl(`text-${name}-family`, cssVar(`font-${s.family}`)),
  decl(`text-${name}-size`, rem(s.size)),
  decl(`text-${name}-line`, rem(s.lineHeight)),
  decl(`text-${name}-weight`, s.weight),
  decl(`text-${name}-tracking`, `${s.tracking}em`),
];

const typeClass = (name: string, s: TypeStyle): string =>
  [
    `.ws-text-${name} {`,
    `  font-family: ${cssVar(`text-${name}-family`)};`,
    `  font-size: ${cssVar(`text-${name}-size`)};`,
    `  line-height: ${cssVar(`text-${name}-line`)};`,
    `  font-weight: ${cssVar(`text-${name}-weight`)};`,
    `  letter-spacing: ${cssVar(`text-${name}-tracking`)};`,
    ...(s.uppercase ? ["  text-transform: uppercase;"] : []),
    ...(s.tabularNumbers ? ["  font-variant-numeric: tabular-nums;"] : []),
    "}",
  ].join("\n");

const widthDeclarations = (cls: WidthClass): string[] => {
  const w = widthClasses[cls];
  return [
    decl("columns", w.columns),
    decl("page-margin", `${w.margin}px`),
    decl("gutter", `${w.gutter}px`),
    decl("band-gap", `${w.bandGap}px`),
    decl("card-padding", `${w.cardPadding}px`),
  ];
};

const block = (selector: string, lines: string[]): string => `${selector} {\n${lines.join("\n")}\n}`;
const indent = (css: string): string =>
  css
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");

export function buildTokensCss(): string {
  const base: string[] = [
    decl("font-display", fontFamilies.display),
    decl("font-sans", fontFamilies.sans),
    ...Object.entries(typeScale).flatMap(([n, s]) => typeDeclarations(n, s)),
    ...Object.entries(componentTypeScale).flatMap(([n, s]) => typeDeclarations(n, s)),
    ...Object.entries(space).map(([n, v]) => decl(n, `${v}px`)),
    ...Object.entries(radii).map(([n, v]) => decl(n, `${v}px`)),
    ...Object.entries(layers).map(([n, v]) => decl(n, v)),
    ...Object.entries(motion).map(([n, v]) => decl(n, `${v}ms`)),
    ...Object.entries(easings).map(([n, v]) => decl(n, v)),
    ...Object.entries(layout).map(([n, v]) => decl(n, `${v}px`)),
    decl("chart-area-opacity", 0.14),
    ...widthDeclarations("narrow"),
  ];

  const light = themeDeclarations("light");
  const dark = themeDeclarations("dark");

  return [
    "/* Generated from packages/ui/src/tokens/*.ts by `pnpm --filter @willowsum/ui build`. Do not edit. */",
    "",
    block(":root", base),
    "",
    "/* DS-11: light theme by default and when chosen. */",
    block(':root,\n[data-theme="light"]', light),
    "",
    "/* DS-11: dark theme when chosen. */",
    block('[data-theme="dark"]', dark),
    "",
    "/* DS-11: «Як у системі» — no data-theme on the root element. */",
    `@media (prefers-color-scheme: dark) {\n${indent(block(':root:not([data-theme="light"])', dark))}\n}`,
    "",
    "/* DS-10: width classes. */",
    `@media (min-width: ${breakpoints.medium}px) {\n${indent(block(":root", widthDeclarations("medium")))}\n}`,
    `@media (min-width: ${breakpoints.wide}px) {\n${indent(block(":root", widthDeclarations("wide")))}\n}`,
    "",
    "/* DS-13: reduced motion — transitions become instant, the spinner slows down. */",
    `@media (prefers-reduced-motion: reduce) {\n${indent(
      block(":root", [
        decl("duration-interaction", `${motion["duration-reduced"]}ms`),
        decl("duration-spinner", `${motion["duration-spinner-reduced"]}ms`),
      ]),
    )}\n}`,
    "",
    "/* DS-11 edge case: printing always uses the light theme. */",
    `@media print {\n${indent(block(':root:not([data-theme="light"]),\n:root,\n[data-theme]', light))}\n}`,
    "",
    "/* DS-08: type scale. */",
    ...Object.entries(typeScale).map(([n, s]) => typeClass(n, s)),
    ...Object.entries(componentTypeScale).map(([n, s]) => typeClass(n, s)),
    "",
  ].join("\n");
}

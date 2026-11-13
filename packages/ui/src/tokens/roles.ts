/**
 * Static checks of how colour roles are used in stylesheets — DS-06@PoC items 3 and «Бізнес-правила»,
 * acceptance criteria 4, 5, 6, 9 and 11. The checks read the CSS text (no browser): each declaration
 * with the selector and at-rules it sits in. Tests in `packages/ui` and `apps/web` run them over every
 * stylesheet; the generated `tokens.css` defines the roles and is not checked here.
 */

export interface CssDeclaration {
  /** Selector of the rule (at-rule preludes are in `atRules`). */
  selector: string;
  property: string;
  value: string;
  atRules: readonly string[];
}

/** Every declaration of a stylesheet, in order. Comments are ignored; nested at-rules are kept. */
export function cssDeclarations(source: string): CssDeclaration[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssDeclaration[] = [];
  const stack: string[] = [];
  let buf = "";
  let depth = 0; // parentheses

  const flushDeclaration = () => {
    const text = buf.trim();
    buf = "";
    if (!text || stack.length === 0) return;
    const selector = [...stack].reverse().find((p) => !p.startsWith("@"));
    if (!selector) return;
    const colon = text.indexOf(":");
    if (colon < 0) return;
    out.push({
      selector,
      property: text.slice(0, colon).trim().toLowerCase(),
      value: text
        .slice(colon + 1)
        .replace(/\s+/g, " ")
        .trim(),
      atRules: stack.filter((p) => p.startsWith("@")),
    });
  };

  for (const ch of css) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
    } else if (depth === 0 && ch === "}") {
      flushDeclaration();
      stack.pop();
    } else if (depth === 0 && ch === ";") {
      if (stack.length === 0)
        buf = ""; // @import and other top-level statements
      else flushDeclaration();
    } else buf += ch;
  }
  return out;
}

const tokenRef = (names: readonly string[]) => new RegExp(`var\\(--ws-(${names.join("|")})\\)`);

/** The amber accent and the small leaf of the mark, which is the accent (DS-02 item 5). */
const ACCENT = tokenRef(["accent", "mark-small"]);

/**
 * DS-06 AC4: where the accent may be used — the small leaf of the mark. The goal icon adds its
 * selector here when its component is built (the goal progress bar, ring and line use `goal-*`).
 */
export const ACCENT_SELECTORS: readonly RegExp[] = [/(^|[\s,>+~])\.ws-mark-small(?![\w-])/];

/** DS-06 item 3: the accent is a fill only. */
const FILL_PROPERTIES = new Set(["background", "background-color", "fill"]);

/** Properties that colour text (DS-06 AC5). */
const TEXT_PROPERTIES = new Set([
  "color",
  "-webkit-text-fill-color",
  "-webkit-text-stroke",
  "-webkit-text-stroke-color",
  "text-decoration",
  "text-decoration-color",
  "text-emphasis-color",
  "text-shadow",
  "caret-color",
]);

const show = (d: CssDeclaration) =>
  `${d.atRules.length ? `${d.atRules.join(" ")} ` : ""}${d.selector} { ${d.property}: ${d.value} }`;

/** DS-06 AC4 and item 3: the accent only fills the small leaf (or the goal icon); never a border or outline. */
export function accentUsageViolations(css: string): string[] {
  return cssDeclarations(css)
    .filter((d) => ACCENT.test(d.value))
    .filter(
      (d) =>
        !FILL_PROPERTIES.has(d.property) ||
        !d.selector.split(",").every((s) => ACCENT_SELECTORS.some((re) => re.test(s.trim()))),
    )
    .map(show);
}

/** DS-06 AC5: no text is accent-coloured. */
export function accentTextViolations(css: string): string[] {
  return cssDeclarations(css)
    .filter((d) => TEXT_PROPERTIES.has(d.property) && ACCENT.test(d.value))
    .map(show);
}

const SURFACE_300 = tokenRef(["surface-300"]);
/** DS-06 AC6 and «Бізнес-правила»: text on surface-300 is ink, or brand on the current tab and navigation item. */
const SURFACE_300_TEXT = tokenRef(["ink", "brand"]);
/** The one exception: the word of a neutral badge (DS-06 item 2, surface-300 row). */
export const NEUTRAL_BADGE_SELECTORS: readonly RegExp[] = [/\.ws-badge-neutral(?![\w-])/];

/**
 * DS-06 AC6: a rule that paints surface-300 and sets a text colour sets ink (or brand). Checked per
 * rule; text inherited from another rule is checked in the components that place it.
 */
export function surface300TextViolations(css: string): string[] {
  const rules = new Map<string, CssDeclaration[]>();
  for (const d of cssDeclarations(css)) {
    const key = `${d.atRules.join(" ")}|${d.selector}`;
    rules.set(key, [...(rules.get(key) ?? []), d]);
  }
  const out: string[] = [];
  for (const decls of rules.values()) {
    const painted = decls.some(
      (d) => (d.property === "background" || d.property === "background-color") && SURFACE_300.test(d.value),
    );
    if (!painted) continue;
    for (const d of decls) {
      if (d.property !== "color") continue;
      if (SURFACE_300_TEXT.test(d.value) && !/var\(--ws-ink-muted\)/.test(d.value)) continue;
      if (/var\(--ws-ink-muted\)/.test(d.value) && NEUTRAL_BADGE_SELECTORS.some((re) => re.test(d.selector)))
        continue;
      out.push(show(d));
    }
  }
  return out;
}

const WARNING = tokenRef(["on-warning", "tint-warning", "warning-line"]);
/** DS-06 AC9: the warning colours never mark a goal or an error. */
const NOT_WARNING = /(goal|error|danger|invalid|loss|negative|fail)/i;

export function warningMeaningViolations(css: string): string[] {
  return cssDeclarations(css)
    .filter((d) => WARNING.test(d.value) && NOT_WARNING.test(d.selector))
    .map(show);
}

const CONTROL_BORDER =
  /^border(-(color|block|inline|top|right|bottom|left|block-start|block-end|inline-start|inline-end))?$/;
/** DS-06 AC11: a border on a control uses border-control (or a state colour), never the decorative line. */
export function controlBorderViolations(css: string, controlSelectors: readonly RegExp[]): string[] {
  return cssDeclarations(css)
    .filter((d) => CONTROL_BORDER.test(d.property))
    .filter((d) => controlSelectors.some((re) => re.test(d.selector)))
    .filter((d) => /var\(--ws-line\)/.test(d.value))
    .map(show);
}

/** DS-13 item 1 and AC3: every transition lasts `duration-interaction` (150 ms, within 120–200 ms). */
export function transitionDurationViolations(css: string): string[] {
  return cssDeclarations(css)
    .filter((d) => d.property === "transition" || d.property === "transition-duration")
    .filter((d) => !/^(none|0s?)$/.test(d.value))
    .filter((d) => {
      const durations = [...d.value.matchAll(/var\(--ws-(duration-[\w-]+)\)|(\d*\.?\d+m?s)\b/g)].map(
        (m) => m[1] ?? m[2],
      );
      return (
        durations.length === 0 ||
        durations.some((x) => x !== "duration-interaction" && x !== "duration-reduced")
      );
    })
    .map(show);
}

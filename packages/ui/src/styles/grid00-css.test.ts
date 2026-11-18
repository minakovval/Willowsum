// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cssDeclarations, layout, motion, space, widthClasses } from "../tokens/index.ts";

/**
 * GRID-00@PoC on the shipped stylesheets: the grid tokens the pages are laid out with, the shell that applies them,
 * the container-width rules, focus and motion. jsdom has no layout, so the rules themselves are read, and each one
 * is compared with the typed value the design system declares (a changed rule or a changed token fails the test).
 */
const read = (name: string) =>
  cssDeclarations(readFileSync(fileURLToPath(new URL(`./${name}.css`, import.meta.url)), "utf8"));
const sheets = {
  tokens: read("tokens"),
  shell: read("shell"),
  base: read("base"),
  components: read("components"),
};

type Sheet = keyof typeof sheets;
/** The value of `property` in the rule with exactly this selector, inside the at-rule containing `at` (or outside any). */
function value(sheet: Sheet, selector: string, property: string, at?: string): string | undefined {
  return sheets[sheet].find(
    (d) =>
      d.selector.split(",").some((s) => s.trim() === selector) &&
      d.property === property &&
      (at === undefined ? d.atRules.length === 0 : d.atRules.some((r) => r.includes(at))),
  )?.value;
}
const px = (v: string | undefined) => Number(v?.replace("px", ""));

describe("GRID-00@PoC grid tokens and the shell that applies them", () => {
  it("GRID-00@PoC FR 2: Expanded (1024 px) is 12 columns, 32 px margins, 24 px gutter; Large changes nothing but the content width", () => {
    const at = "(min-width: 1024px)";
    expect(widthClasses.wide).toMatchObject({ from: 1024, to: 1439, columns: 12, margin: 32, gutter: 24 });
    expect(Number(value("tokens", ":root", "--ws-columns", at))).toBe(widthClasses.wide.columns);
    expect(px(value("tokens", ":root", "--ws-page-margin", at))).toBe(widthClasses.wide.margin);
    expect(px(value("tokens", ":root", "--ws-gutter", at))).toBe(widthClasses.wide.gutter);
    // Large (1440 px) is the same grid …
    expect(widthClasses.large).toMatchObject({ from: 1440, columns: 12, margin: 32, gutter: 24 });
    expect(
      sheets.tokens.some(
        (d) =>
          d.atRules.some((r) => r.includes("min-width: 1440px")) && /columns|gutter|margin/.test(d.property),
      ),
    ).toBe(false);
    // … with the content at most 1200 px wide and centred, so the side margins are empty.
    expect(layout["content-max"]).toBe(1200);
    expect(px(value("tokens", ":root", "--ws-content-max"))).toBe(1200);
    expect(value("shell", ".ws-main-inner", "max-width")).toBe("var(--ws-content-max)");
    expect(value("shell", ".ws-main-inner", "margin-inline")).toBe("auto");
  });

  it("GRID-00@PoC FR 3: the columns are counted from the content area — the content sits beside the navigation, not under the window", () => {
    // The grid lives in `.ws-main-inner`, which is inside `.ws-shell-body`; that body is shifted by the navigation's width,
    // so 12 columns share what is left of the window, and the rail (64 px) gives the room back.
    expect(value("shell", ".ws-shell-body", "margin-inline-start")).toBe("var(--ws-nav-width)");
    expect(value("shell", ".ws-nav", "position")).toBe("fixed");
    expect(value("shell", ".ws-shell-body", "min-width")).toBe("0");
    expect(layout["sidebar-width"]).toBe(212);
    expect(layout["rail-width"]).toBe(64);
  });

  it("GRID-00@PoC FR 4, AC3: card padding is 24 px and the gap between bands 48 px from Expanded; the shell and the card use the tokens, not their own numbers", () => {
    const at = "(min-width: 1024px)";
    expect(px(value("tokens", ":root", "--ws-card-padding", at))).toBe(widthClasses.wide.cardPadding);
    expect(px(value("tokens", ":root", "--ws-band-gap", at))).toBe(widthClasses.wide.bandGap);
    expect(widthClasses.wide).toMatchObject({ cardPadding: 24, bandGap: 48, margin: 32, gutter: 24 });
    expect(value("components", ".ws-card", "padding")).toBe("var(--ws-card-padding)");
    const inner = value("shell", ".ws-main-inner", "padding");
    expect(inner).toContain("var(--ws-page-margin)");
    expect(inner).toContain("var(--ws-band-gap)");
  });

  it("GRID-00@PoC FR 5: the page grids of the app take the column count from the token — no page lays out a literal 12 or 8 columns", () => {
    const dir = fileURLToPath(new URL("../../../../apps/web/src/", import.meta.url));
    const files = [
      "app.css",
      "planning/planning.css",
      "accounts/accounts.css",
      "accounts/account-card.css",
      "transactions/transactions.css",
    ];
    const columns = files.flatMap((f) =>
      cssDeclarations(readFileSync(dir + f, "utf8"))
        .filter(
          (d) =>
            d.property === "grid-template-columns" &&
            /^repeat\(\s*(var\(--ws-columns\)|12|8)\s*,/.test(d.value),
        )
        .map((d) => ({ file: f, selector: d.selector, value: d.value })),
    );
    expect(columns.filter((c) => !c.value.startsWith("repeat(var(--ws-columns)"))).toEqual([]);
    // The four page grids (shell page, «Планування», «Рахунки», «Картка рахунку») all follow the width class.
    expect(columns.map((c) => c.file).sort()).toEqual([
      "accounts/account-card.css",
      "accounts/accounts.css",
      "app.css",
      "planning/planning.css",
    ]);
    const planning = cssDeclarations(readFileSync(dir + "planning/planning.css", "utf8"));
    expect(planning.find((d) => d.selector === ".plan-grid" && d.property === "gap")?.value).toBe(
      "var(--ws-gutter)",
    );
  });

  it("GRID-00@PoC FR 6, FR 7, AC4, EC1: a table is a stack of cards below 520 px of its container, not of the window; the card labels are the column headings", () => {
    expect(layout["table-stack-below"]).toBe(520);
    expect(value("components", ".ws-table-wrap", "container-type")).toBe("inline-size");
    const container = (v: string) =>
      sheets.components.some((d) => d.atRules.includes(`@container (max-width: ${v})`));
    expect(container("519px")).toBe(true);
    expect(container("520px")).toBe(false);
    expect(
      sheets.components.some(
        (d) =>
          d.atRules.some((r) => r.startsWith("@container (max-width: 519px)")) &&
          d.property === "content" &&
          d.value === "attr(data-label)",
      ),
    ).toBe(true);
    // No window media query decides it.
    expect(
      sheets.components.some(
        (d) =>
          d.selector.startsWith(".ws-table") &&
          d.atRules.some((r) => r.startsWith("@media") && r.includes("520")),
      ),
    ).toBe(false);
  });

  it("GRID-00@PoC FR 8: a table in a widget (flat) has 44 px rows, fixed columns that share the width and no sideways scroll, and stays rows in a narrow container", () => {
    expect(value("components", ".ws-dtable-wrap--flat .ws-dtable td", "block-size")).toBe(
      "calc(var(--ws-space-1) * 11)",
    );
    expect(space["space-1"] * 11).toBe(44);
    expect(value("components", ".ws-dtable", "table-layout")).toBe("fixed");
    expect(value("components", ".ws-dtable", "inline-size")).toBe("100%");
    // The card mode of the container query is for the table that is not flat only.
    const cards = sheets.components.filter(
      (d) =>
        d.atRules.some((r) => r.startsWith("@container (max-width: 519px)")) &&
        d.selector.startsWith(".ws-dtable-wrap"),
    );
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((d) => d.selector.includes(":not(.ws-dtable-wrap--flat)"))).toBe(true);
    expect(
      sheets.components.some((d) => d.selector.includes("ws-dtable") && /^(overflow-x)$/.test(d.property)),
    ).toBe(false);
  });

  it("GRID-00@PoC FR 9: tabs are the one intentional sideways scroll — no other rule of the design system scrolls sideways", () => {
    const scrolling = sheets.components
      .filter(
        (d) => (d.property === "overflow-x" || d.property === "overflow") && /^(auto|scroll)\b/.test(d.value),
      )
      .map((d) => d.selector);
    expect(scrolling).toEqual([".ws-page-tabs"]);
  });

  it("GRID-00@PoC FR 19, AC6: an amount is one unbroken run in tabular figures, never cut with an ellipsis; the abbreviated one is underlined with dashes", () => {
    expect(value("components", ".ws-amount-fit", "white-space")).toBe("nowrap");
    expect(value("components", ".ws-amount-fit", "display")).toBe("inline-block");
    expect(value("base", ".ws-tabular", "font-variant-numeric")).toBe("tabular-nums");
    expect(
      sheets.components.some((d) => d.selector.startsWith(".ws-amount") && d.property === "text-overflow"),
    ).toBe(false);
    // `tabindex` is set only on the abbreviated state (FitAmount), so the rule marks exactly that one.
    expect(value("components", ".ws-amount-fit[tabindex] > .ws-amount", "text-decoration")).toBe(
      "underline dashed",
    );
  });

  it("GRID-00@PoC FR 23: the focus ring is 3 px with a 2 px offset, set on every :focus-visible; a rule that clears the outline puts a ring on the element around it", () => {
    expect(layout["focus-ring-width"]).toBe(3);
    expect(layout["focus-ring-offset"]).toBe(2);
    expect(value("base", ":focus-visible", "outline")).toBe(
      "var(--ws-focus-ring-width) solid var(--ws-focus-ring-color)",
    );
    expect(value("base", ":focus-visible", "outline-offset")).toBe("var(--ws-focus-ring-offset)");
    expect(px(value("tokens", ":root", "--ws-focus-ring-width"))).toBe(3);
    expect(px(value("tokens", ":root", "--ws-focus-ring-offset"))).toBe(2);
    // `outline: none` only where the ring is drawn elsewhere (the field's box, the row's overlay) or on an element that is not interactive.
    const cleared = [...sheets.base, ...sheets.components]
      .filter((d) => d.property === "outline" && d.value === "none")
      .map((d) => d.selector);
    expect(cleared.sort()).toEqual(
      [
        ".ws-field-input:focus-visible",
        ".ws-row-open:focus-visible",
        ".ws-select-search input",
        '[tabindex="-1"]:focus:not(:focus-visible)',
      ].sort(),
    );
    expect(value("components", ".ws-row-open:focus-visible::after", "outline")).toContain(
      "var(--ws-focus-ring-width)",
    );
    expect(value("components", ".ws-field-box:has(.ws-field-input:focus-visible)", "outline")).toContain(
      "var(--ws-focus-ring-width)",
    );
    expect(value("components", ".ws-select-search:focus-within", "outline")).toContain(
      "var(--ws-focus-ring-width)",
    );
  });

  it("GRID-00@PoC FR 27, AC10: hover and focus take 120–200 ms; with reduced motion everything is instant except the slow spinner", () => {
    expect([motion["duration-hover-min"], motion["duration-hover-max"]]).toEqual([120, 200]);
    const ms = px(value("tokens", ":root", "--ws-duration-interaction")?.replace("ms", "px"));
    expect(ms).toBeGreaterThanOrEqual(120);
    expect(ms).toBeLessThanOrEqual(200);
    const reduced = "(prefers-reduced-motion: reduce)";
    expect(value("base", "*", "transition-duration", reduced)).toBe("var(--ws-duration-reduced) !important");
    expect(value("base", "*", "animation-duration", reduced)).toBe("var(--ws-duration-reduced) !important");
    expect(value("base", "*", "animation-iteration-count", reduced)).toBe("1 !important");
    expect(value("base", "*", "scroll-behavior", reduced)).toBe("auto !important");
    expect(value("tokens", ":root", "--ws-duration-reduced")).toBe("0.01ms");
    // The skeleton stops, the spinner is the one thing that still turns — slowly.
    expect(value("base", ".ws-skeleton", "animation", reduced)).toBe("none !important");
    expect(value("base", ".ws-spinner", "animation-duration", reduced)).toBe(
      "var(--ws-duration-spinner-reduced) !important",
    );
    expect(value("base", ".ws-spinner", "animation-iteration-count", reduced)).toBe("infinite !important");
    expect(motion["duration-spinner-reduced"]).toBe(2400);
  });
});

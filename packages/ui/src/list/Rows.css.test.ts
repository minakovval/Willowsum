// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * CMP-27@PoC and CMP-28@PoC: the sizes and states of the rows are written in the stylesheet, so they are checked
 * there (jsdom has no layout). Every value is a token; the numbers are the view's.
 */
const css = readFileSync(fileURLToPath(new URL("../styles/components.css", import.meta.url)), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  // A rule starts after a blank line or a comment, so `.ws-tx-row {` is not found inside a selector list.
  const found = new RegExp(`(?:\\n\\n|\\*/\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`).exec(
    css,
  );
  if (!found) throw new Error(`No rule for ${selector}`);
  return css.slice(found.index, css.indexOf("}", found.index));
}

const ROW = ".ws-list-row,\n.ws-tx-row";

describe("CMP-27@PoC ListRow styles", () => {
  it("CMP-27@PoC AC1: the name is one line with an ellipsis and the amount block is at most 45 % of the row", () => {
    expect(rule(".ws-row-title")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".ws-row-title")).toMatch(/white-space:\s*nowrap/);
    expect(rule(".ws-row-meta")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".ws-row-money")).toMatch(/max-inline-size:\s*45%/);
    expect(rule(".ws-row-money")).toMatch(/align-items:\s*flex-end/);
  });

  it("CMP-27@PoC AC2: the amount is in ink (1B2230 in the light theme), never in gain or loss", () => {
    expect(rule(".ws-row-money")).toMatch(/color:\s*var\(--ws-ink\)/);
    expect(rule(".ws-row-money")).not.toMatch(/gain|loss/);
  });

  it("CMP-27@PoC AC5: a row is at least 56 px high (48 + 8 px)", () => {
    expect(rule(ROW)).toMatch(/min-block-size:\s*calc\(var\(--ws-space-7\) \+ var\(--ws-space-2\)\)/);
  });

  it("CMP-27@PoC FR «Розміри і стиль»: padding 8 × 16, gap 12, a 1 px `line` under it, `surface-200`; name 16/24 500, detail 13/20 `ink-muted`", () => {
    const row = rule(ROW);
    expect(row).toMatch(/padding:\s*var\(--ws-space-2\) var\(--ws-space-4\)/);
    expect(row).toMatch(/gap:\s*var\(--ws-space-3\)/);
    expect(row).toMatch(/border-block-end:\s*1px solid var\(--ws-line\)/);
    expect(row).toMatch(/background:\s*var\(--ws-surface-200\)/);
    expect(rule(".ws-row-title")).toMatch(/font-size:\s*var\(--ws-text-body-size\)/);
    expect(rule(".ws-row-title")).toMatch(/line-height:\s*var\(--ws-text-body-line\)/);
    expect(rule(".ws-row-title")).toMatch(/font-weight:\s*500/);
    expect(rule(".ws-row-meta")).toMatch(/color:\s*var\(--ws-ink-muted\)/);
    expect(rule(".ws-row-meta")).toMatch(/line-height:\s*var\(--ws-text-body-sm-line\)/);
    // 2 px between the amount and the change.
    expect(rule(".ws-row-money")).toMatch(/gap:\s*calc\(var\(--ws-space-1\) \/ 2\)/);
  });

  it("CMP-27@PoC FR «Стани»: hover surface-100, pressed and selected surface-300, focus ring 3 px `focus` inside the row", () => {
    expect(rule(".ws-list-row:hover,\n.ws-tx-row:hover")).toMatch(/background:\s*var\(--ws-surface-100\)/);
    expect(
      rule(".ws-list-row:active,\n.ws-tx-row:active,\n.ws-list-row-selected,\n.ws-list-row-selected:hover"),
    ).toMatch(/background:\s*var\(--ws-surface-300\)/);
    const ring = rule(".ws-row-open:focus-visible::after");
    expect(ring).toMatch(/outline:\s*var\(--ws-focus-ring-width\) solid var\(--ws-focus-ring-color\)/);
    expect(ring).toMatch(/outline-offset:\s*calc\(var\(--ws-focus-ring-width\) \* -1\)/);
  });

  it("CMP-27@PoC FR «Стани»: the archived name is ink-muted", () => {
    expect(rule(".ws-list-row-archived .ws-row-title")).toMatch(/color:\s*var\(--ws-ink-muted\)/);
  });

  it("CMP-27@PoC FR «Адаптивність»: the click area is the whole row — the open element's ::after covers it", () => {
    const after = rule(".ws-row-open::after");
    expect(after).toMatch(/position:\s*absolute/);
    expect(after).toMatch(/inset:\s*0/);
  });
});

describe("CMP-28@PoC TransactionRow styles", () => {
  it("CMP-28@PoC AC1: the review stripe is 6 px of `ink` on the left edge", () => {
    expect(rule(".ws-tx-row-review")).toMatch(
      /box-shadow:\s*inset calc\(var\(--ws-space-1\) \* 1\.5\) 0 0 var\(--ws-ink\)/,
    );
  });

  it("CMP-28@PoC AC2: «Без категорії» is a dashed chip", () => {
    expect(rule(".ws-tx-category-none")).toMatch(/border:\s*1px dashed var\(--ws-border-control\)/);
  });

  it("CMP-28@PoC AC3: the amount is in ink, the sign is never shown by colour", () => {
    expect(rule(".ws-row-money")).toMatch(/color:\s*var\(--ws-ink\)/);
  });

  it("CMP-28@PoC FR «Розміри і стиль»: padding 12 × 16, gap 12, the main area at least 160 px, the line under it", () => {
    expect(rule(".ws-tx-row")).toMatch(/padding-block:\s*var\(--ws-space-3\)/);
    expect(rule(ROW)).toMatch(/padding:\s*var\(--ws-space-2\) var\(--ws-space-4\)/);
    expect(rule(ROW)).toMatch(/gap:\s*var\(--ws-space-3\)/);
    expect(rule(".ws-tx-row .ws-row-open")).toMatch(/min-inline-size:\s*calc\(var\(--ws-space-8\) \* 2\.5\)/);
  });

  it("CMP-28@PoC FR «Стани»: hover and focus are the row's (surface-100, a 3 px `focus` ring inside)", () => {
    expect(rule(".ws-list-row:hover,\n.ws-tx-row:hover")).toMatch(/background:\s*var\(--ws-surface-100\)/);
    expect(rule(".ws-row-open:focus-visible::after")).toMatch(/var\(--ws-focus-ring-color\)/);
  });

  it("CMP-28@PoC AC6: the table has the date column after «Рахунок», not first, and the amounts end-aligned", () => {
    expect(rule(".ws-tx-row-table")).toMatch(/display:\s*grid/);
    expect(rule(".ws-tx-head-amount")).toMatch(/text-align:\s*end/);
    expect(rule(".ws-row-money")).toMatch(/align-items:\s*flex-end/);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, screen } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, renderAt, resetAuthState } from "../auth/testing.tsx";

/**
 * GRID-04@PoC: the page grids of «Планування». The measured layout at 1280 px (AC1) is in e2e/layout.spec.ts; here
 * the regions, the empty slots and the CSS rules that make the columns. S-141 is in recurring/bud07c-recurring.test.tsx.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "planning.css"), "utf8").replace(
  /\s+/g,
  " ",
);

const regions = (page: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-plan-page='${page}'] > [data-plan-region]`)].map((e) => [
    e.dataset.planRegion,
    e.className.match(/plan-span-(\d+)/)?.[1],
  ]);

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("GRID-04@PoC page grids of «Планування»", () => {
  it("GRID-04@PoC FR 1, AC1: «Бюджет» — the header, three blocks of 4 columns, the categories on 12", () => {
    renderAt("#/planning/budget", fakeApi({}).client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Бюджет");
    expect(regions("budget")).toEqual([
      ["spendable", "4"],
      ["income", "4"],
      ["recurring", "4"],
      ["categories", "12"],
    ]);
  });

  it("GRID-04@PoC FR 1: the three blocks are empty slots of one height — they stretch in one row", () => {
    renderAt("#/planning/budget", fakeApi({}).client);
    const slots = document.querySelectorAll("[data-plan-page='budget'] > [data-empty='true']");
    expect([...slots].map((e) => e.getAttribute("data-plan-region"))).toEqual([
      "spendable",
      "income",
      "recurring",
    ]);
    // The page is not blank until its screen comes: the shell's empty state stays.
    expect(screen.getByRole("heading", { level: 2, name: "Тут поки нічого немає" })).toBeTruthy();
    expect(css).toContain("align-items: stretch;");
    expect(css).toContain("grid-template-columns: repeat(var(--ws-columns), minmax(0, 1fr));");
    expect(css).toContain("gap: var(--ws-gutter);");
  });

  it("GRID-04@PoC FR 3, AC1: «Цілі» — the list on 4 columns, the detail with the projection and the links on 8", () => {
    renderAt("#/planning/goals", fakeApi({}).client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Цілі");
    expect(screen.getByRole("heading", { level: 2, name: "Тут поки нічого немає" })).toBeTruthy();
    expect(regions("goals")).toEqual([
      ["list", "4"],
      ["detail", "8"],
    ]);
    const detail = document.querySelector("[data-plan-region='detail']")!;
    expect([...detail.children].map((c) => c.getAttribute("data-plan-region"))).toEqual([
      "goal",
      "projection",
      "links",
    ]);
  });

  it("GRID-04@PoC FR 1, FR 3, FR 5: spans of 4, 8 and 12 columns apply from Expanded (1024 px); below it a region takes the whole width", () => {
    expect(css).toContain(
      "@media (min-width: 1024px) { .plan-grid > .plan-span-4 { grid-column: span 4; } .plan-grid > .plan-span-8 { grid-column: span 8; }",
    );
    expect(css).toContain(".plan-grid > .plan-region { grid-column: 1 / -1;");
  });

  it("GRID-04@PoC FR 1: the grid has one h1 and no page of its own values — only tokens", () => {
    renderAt("#/planning/budget", fakeApi({}).client);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\d+px(?!\))/);
  });

  it("GRID-04@PoC FR 4: there is no page «Чи можу я дозволити» in this release", () => {
    renderAt("#/planning/afford", fakeApi({}).client);
    expect(document.querySelector("[data-plan-page]")).toBeNull();
    expect(screen.queryByRole("link", { name: "Чи можу я дозволити" })).toBeNull();
  });

  const navLabels = () =>
    [...document.querySelectorAll(".ws-nav-page .ws-nav-label")].map((e) => e.textContent);

  it("GRID-04@PoC FR 6, AC2, AC6: «Бюджет» is the root of «Планування»; «Борги» is in the menu, «Звіти» is not", () => {
    renderAt("#/planning", fakeApi({}).client);
    expect(window.location.hash).toBe("#/planning/budget");
    const sections = [...document.querySelectorAll(".ws-nav-section > .ws-nav-item .ws-nav-label")].map(
      (e) => e.textContent,
    );
    expect(sections).toEqual(["Гроші", "Планування"]);
    expect(navLabels()).toEqual(["Бюджет", "Цілі", "Регулярні платежі", "Борги"]);
    expect(navLabels()).not.toContain("Звіти");
  });

  it("GRID-04@PoC AC6, EC3: without any debt «Борги» opens and shows its empty state", async () => {
    renderAt("#/planning/debts", fakeApi({ "GET /v1/debts": { status: 200, body: { debts: [] } } }).client);
    expect(await screen.findByRole("heading", { name: "Боргів не додано" })).toBeTruthy();
    expect(navLabels()).toContain("Борги");
  });

  it("GRID-04@PoC FR 7, AC3: every page of «Планування» opens; «Тільки бюджет» is not in the PoC shell", () => {
    for (const hash of [
      "#/planning/budget",
      "#/planning/goals",
      "#/planning/recurring",
      "#/planning/debts",
    ]) {
      renderAt(hash, fakeApi({}).client);
      expect(screen.getByRole("heading", { level: 1 }), hash).toBeTruthy();
      expect(navLabels(), hash).toContain("Борги");
      cleanup();
    }
  });
});

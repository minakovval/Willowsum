import { expect, h1, test } from "./fixtures.ts";

/** NFR-07@PoC: the desktop layout at a window 1280 px wide (П-25), in Chromium and WebKit. */
test.describe("NFR-07@PoC: desktop layout at 1280 px", () => {
  test("NFR-07@PoC AC1, FR 2: the 212 px sidebar with labels is on the left", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/#\/planning\/budget$/);
    await expect(h1(page)).toHaveText("Бюджет");
    expect(page.viewportSize()?.width).toBe(1280);

    const nav = page.locator(".ws-nav-sidebar");
    await expect(nav).toBeVisible();
    const box = (await nav.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(212);
    // Labelled items: the sections and the pages of the open section show their text, not just icons.
    for (const label of ["Гроші", "Планування", "Бюджет", "Цілі", "Регулярні платежі", "Борги"])
      await expect(nav.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
    // The main area starts to the right of the sidebar.
    const main = (await page.getByRole("main").boundingBox())!;
    expect(main.x).toBeGreaterThanOrEqual(212);
  });

  test("NFR-07@PoC FR 3: grid gutters 24 px, content at most 1200 px wide, no horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/#/planning/budget");
    await expect(h1(page)).toHaveText("Бюджет");
    const layout = await page.evaluate(() => {
      const inner = document.querySelector(".ws-main-inner")!;
      return {
        gutter: getComputedStyle(document.documentElement).getPropertyValue("--ws-gutter").trim(),
        maxWidth: getComputedStyle(inner).maxWidth,
        width: inner.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.gutter).toBe("24px");
    // The gutter as rendered: the gap between two cards side by side in a grid of the app (the design-system
    // gallery is the only screen with such a grid while the PoC pages are placeholders).
    await page.goto("/#/gallery/tokens");
    const gap = await page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll(".gallery-themes > *")].map((e) =>
        e.getBoundingClientRect(),
      );
      return a && b && Math.round(a.top) === Math.round(b.top) ? b.left - a.right : null;
    });
    expect(gap).toBe(24);
    expect(layout.maxWidth).toBe("1200px");
    expect(layout.width).toBeLessThanOrEqual(1200);
    expect(layout.overflow).toBe(0);
  });

  for (const path of ["/login", "/signup", "/password/reset", "/not-me"])
    test(`GRID-06@PoC AC2: ${path} — the card takes the 6 middle columns, 3 empty on each side`, async ({
      page,
    }) => {
      await page.goto(`/#${path}`);
      await expect(h1(page)).toBeVisible();
      // 12 columns, 32 px margins, 24 px gutters (GRID-00 FR 2): a column is (1280 − 64 − 11 × 24) / 12 px.
      const column = (1280 - 2 * 32 - 11 * 24) / 12;
      const box = (await page.getByRole("main").boundingBox())!;
      expect(box.x).toBeCloseTo(32 + 3 * (column + 24), 0);
      expect(box.width).toBeCloseTo(6 * column + 5 * 24, 0);
      // Nothing of the app's navigation around the card (FR 5).
      await expect(page.getByRole("navigation")).toHaveCount(0);
    });

  test("GRID-05@PoC AC1: «Налаштування» — the header, then navigation 3 columns and the form 9", async ({
    page,
  }) => {
    await page.route("**/v1/profile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: "Олена Синтетична",
          email: "olena@example.test",
          locale: null,
          timeZone: null,
        }),
      }),
    );
    await page.goto("/#/settings");
    await expect(h1(page)).toHaveText("Налаштування");
    const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
    const [head, layout, nav, form] = [
      await h1(page).boundingBox(),
      await box(".settings-layout"),
      await box(".settings-nav"),
      await box(".settings-form"),
    ];
    // 12 columns with 24 px gutters: 3 columns span 3c + 2g, 9 columns 9c + 8g.
    const column = (layout.width - 11 * 24) / 12;
    expect(Math.abs(nav.width - (3 * column + 2 * 24))).toBeLessThan(1);
    expect(form.x - (nav.x + nav.width)).toBeCloseTo(24, 0);
    expect(form.x + Math.min(form.width, 820)).toBeLessThanOrEqual(layout.x + layout.width + 1);
    expect(head!.y + head!.height).toBeLessThanOrEqual(nav.y);
    expect(Math.round(nav.y)).toBe(Math.round(form.y));
  });
});

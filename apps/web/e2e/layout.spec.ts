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
});

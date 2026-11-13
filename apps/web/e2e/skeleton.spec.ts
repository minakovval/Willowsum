import { expect, test } from "./fixtures.ts";

/**
 * CMP-22@PoC AC5 in a real browser at 1280 px: in the gallery a list swaps between its skeleton and its content;
 * the list heading and the neighbouring block below keep their vertical position to the pixel.
 */
test("CMP-22@PoC AC5: the skeleton is replaced by its content without moving the heading or the next block", async ({
  page,
}) => {
  await page.goto("/#/gallery/tokens");
  const swap = page.locator('[data-case="swap"]');
  await swap.scrollIntoViewIfNeeded();
  await expect(swap.locator(".ws-skeleton-row")).toHaveCount(3);
  const top = (selector: string) => swap.locator(selector).evaluate((e) => e.getBoundingClientRect().top);
  const before = { heading: await top("h3"), next: await top(".gallery-skeleton__neighbour") };

  await swap.getByRole("button", { name: "Показати вміст" }).click();
  await expect(swap.locator("li")).toHaveCount(3);
  await expect(swap.locator("[aria-busy]")).toHaveCount(0);
  expect({ heading: await top("h3"), next: await top(".gallery-skeleton__neighbour") }).toEqual(before);

  await swap.getByRole("button", { name: "Показати скелетон" }).click();
  await expect(swap.locator(".ws-skeleton-row")).toHaveCount(3);
  expect({ heading: await top("h3"), next: await top(".gallery-skeleton__neighbour") }).toEqual(before);
});

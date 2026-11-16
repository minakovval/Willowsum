import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { expectFormStepsFit } from "./form-steps.ts";

/**
 * CMP-21@PoC b) in a real browser on the smallest supported desktop window, 1280 × 720 px: the gallery's form
 * dialogs never scroll and are not taller than the window minus 2 × 48 px (624 px); a form split into steps keeps one
 * height on every step, so the action bar does not move. Synthetic values only.
 */
test.use({ viewport: { width: 1280, height: 720 } });

const LIMIT = 720 - 2 * 48;

async function box(page: Page) {
  return page.locator("dialog.ws-dialog[open]").evaluate((d) => {
    const body = d.querySelector<HTMLElement>(".ws-dialog-body")!;
    const bar = d.querySelector<HTMLElement>(".ws-dialog-actions")!;
    return {
      height: d.getBoundingClientRect().height,
      scrolls: body.scrollHeight > body.clientHeight + 0.5 || d.scrollHeight > d.clientHeight + 0.5,
      barTop: bar.getBoundingClientRect().top,
    };
  });
}

async function openCase(page: Page, name: string) {
  await page.goto("/#/gallery/tokens");
  const opener = page.locator(`button[data-case="${name}"]`);
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  await expect(page.locator("dialog.ws-dialog[open]")).toBeVisible();
}

test("CMP-21@PoC AC13, AC21: «Нова ціль» in three steps — at most 624 px, no scrolling, the same height and bar position on every step", async ({
  page,
}) => {
  await openCase(page, "form");
  const dialog = page.getByRole("dialog", { name: "Нова ціль" });
  await expect(dialog.getByRole("list", { name: "Кроки форми" }).locator("li")).toHaveCount(3);
  await dialog.getByLabel(/^Назва/).fill("Відпустка");
  await dialog.getByLabel(/^Цільова сума/).fill("3000");
  await dialog.getByLabel(/^Бажана дата/).focus();
  const first = await box(page);
  expect(first.height).toBeLessThanOrEqual(LIMIT);
  expect(first.scrolls).toBe(false);
  for (const step of [2, 3]) {
    await dialog.getByRole("button", { name: "Далі" }).click();
    await expect(dialog.locator(`.ws-form-step[data-step="${step - 1}"]`)).not.toHaveAttribute("inert");
    expect(await box(page)).toEqual(first);
  }
  await dialog.getByRole("button", { name: "Назад" }).click();
  expect(await box(page)).toEqual(first);
});

test("CMP-21@PoC AC22: a group that would make a 700 px step is split into two steps, each at most 624 px; «Додатково» opened, nothing scrolls", async ({
  page,
}) => {
  await openCase(page, "form");
  const goal = page.getByRole("dialog", { name: "Нова ціль" });
  // «Внески» and «Додатково» of «Нова ціль» as one step would be taller than the window allows (about 710 px)…
  const m = await expectFormStepsFit(page);
  expect(m.steps).toHaveLength(3);
  const merged = m.chrome + m.steps[1]! + m.gap + m.steps[2]!;
  expect(merged).toBeGreaterThan(m.limit);
  // …so they are two steps, each within 624 px, and the dialog shows each of them without scrolling.
  expect(m.limit).toBe(624);
  await goal.getByLabel(/^Назва/).fill("Відпустка");
  await goal.getByLabel(/^Цільова сума/).fill("3000");
  for (let step = 0; step < 3; step++) {
    if (step > 0) await goal.getByRole("button", { name: "Далі" }).click();
    const shown = await box(page);
    expect(shown.height).toBeLessThanOrEqual(m.limit);
    expect(shown.scrolls).toBe(false);
  }

  // A form without steps with «Додатково» open fits as well.
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.ws-dialog[open]")).toHaveCount(0);
  await openCase(page, "short");
  const rule = page.getByRole("dialog", { name: "Правило категорії" });
  await expectFormStepsFit(page);
  await rule.getByRole("button", { name: "Додатково: нотатка" }).click();
  await expect(rule.getByLabel("Нотатка")).toBeVisible();
  const opened = await box(page);
  expect(opened.height).toBeLessThanOrEqual(m.limit);
  expect(opened.scrolls).toBe(false);
});

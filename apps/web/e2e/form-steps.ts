import { expect, type Page } from "@playwright/test";

/**
 * CMP-21@PoC «Форма створення…», п. 7 (AC13, AC21, AC22): the measures of the open form dialog with every
 * «Додатково» opened. `steps` — each step's own content height (all steps share one grid cell, so each is measured
 * at its natural height); `chrome` — the rest of the dialog (title, indicator, bar); `gap` — the space between two
 * fields inside a step; `limit` — the window height minus 2 × 48 px. A form screen's e2e test calls
 * `expectFormStepsFit` on its dialog: a step that does not fit has to be split into more steps.
 */
export interface FormStepMeasures {
  limit: number;
  chrome: number;
  gap: number;
  steps: number[];
}

export async function measureFormSteps(page: Page): Promise<FormStepMeasures> {
  return page.locator("dialog.ws-dialog[open]").evaluate((dialog) => {
    const holder = dialog.querySelector<HTMLElement>(".ws-form-steps")!;
    const steps = [...holder.querySelectorAll<HTMLElement>(":scope > .ws-form-step")];
    const closed = [...dialog.querySelectorAll<HTMLElement>(".ws-form-more-body[hidden]")];
    closed.forEach((b) => (b.hidden = false));
    steps.forEach((s) => (s.style.alignSelf = "start"));
    const heights = steps.map((s) => s.getBoundingClientRect().height);
    const holderHeight = holder.getBoundingClientRect().height;
    const chrome = dialog.getBoundingClientRect().height - holderHeight;
    const gap = Number(getComputedStyle(steps[0]!).rowGap.replace(/px$/, "")) || 0; // a layout length, not an amount
    steps.forEach((s) => (s.style.alignSelf = ""));
    closed.forEach((b) => (b.hidden = true));
    return { limit: window.innerHeight - 2 * 48, chrome, gap, steps: heights };
  });
}

/** Every step of the open form dialog, with «Додатково» opened, fits the window minus 96 px. */
export async function expectFormStepsFit(page: Page): Promise<FormStepMeasures> {
  const m = await measureFormSteps(page);
  for (const h of m.steps) expect(m.chrome + h).toBeLessThanOrEqual(m.limit);
  return m;
}

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/**
 * BUD-05@PoC FR 8 (S-139 «Витратити з цілі», boards PocPlanGoalSpend / PocPlanGoalSpendStep2) in a real browser at the
 * board's size, 1280 × 880 px: the dialog has no scrolling (jsdom has no layout, so the unit test cannot measure it),
 * with six rows, «Ще N транзакцій · показати наступні 6» and a chosen pair, so the line «Обрано … · у цілі залишиться …»
 * is in view. The API is answered in the browser with synthetic goals, accounts and transactions.
 */
test.use({ viewport: { width: 1280, height: 880 } });

const eur = (amount: string) => ({ amount, currency: "EUR" });
const GOAL = "a0000000-0000-4000-8000-000000000001";
const ACC = "b0000000-0000-4000-8000-000000000001";
const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const MERCHANTS = [
  "Booking.com",
  "Wizz Air",
  "Rozetka",
  "Нова пошта",
  "Uber",
  "Сільпо",
  "A",
  "B",
  "C",
  "D",
  "E",
];

async function answer(page: Page, goalName = "Відпустка в Італії") {
  await page.route("**/v1/goals", (route) =>
    route.fulfill(
      json({
        goals: [
          {
            achieved: false,
            canContribute: true,
            collected: eur("2100.00"),
            contributedThisMonth: eur("0"),
            contributions: [],
            createdOn: "2026-07-14",
            emergencyMonths: null,
            forecastDate: null,
            id: GOAL,
            name: goalName,
            overdue: false,
            overTarget: null,
            pace: null,
            part: {
              accountId: ACC,
              freeBalance: eur("3500.00"),
              kind: "envelope",
              startAmount: eur("1000.00"),
            },
            progressPercent: "52.5",
            requiredMonthly: null,
            spends: [],
            target: eur("4000.00"),
            targetDate: null,
            template: "travel",
            version: 1,
          },
        ],
      }),
    ),
  );
  await page.route("**/v1/accounts**", (route) =>
    route.fulfill(
      json({
        items: [
          {
            id: ACC,
            name: "Ощадний",
            kind: "savings",
            group: "cash",
            status: "active",
            number: { last4: "5106", masked: "··5106" },
            currencies: [
              {
                currency: "EUR",
                amount: eur("5000.00"),
                approximate: false,
                equivalent: null,
                rateDate: null,
                restricted: false,
              },
            ],
          },
        ],
        nextCursor: null,
      }),
    ),
  );
  await page.route("**/v1/space", (route) =>
    route.fulfill(json({ name: "Дім", dataRegion: "eu", reportingCurrency: "EUR" })),
  );
  await page.route("**/v1/transactions?**", (route) =>
    route.fulfill(
      json({
        count: MERCHANTS.length,
        from: 1,
        items: MERCHANTS.map((m, i) => ({
          id: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          accountId: ACC,
          amount: eur(i === 0 ? "-640.00" : i === 1 ? "-386.40" : "-10.00"),
          type: "expense",
          date: "2026-10-29",
          counterparty: m,
          description: null,
          status: "posted",
          hidden: false,
          transfer: null,
        })),
      }),
    ),
  );
}

test("BUD-05@PoC FR 8: «Витратити з цілі» at 1280 × 880 — six rows, «Ще N…» and two chosen; the dialog body does not scroll and the sum line is in view", async ({
  page,
}) => {
  await answer(page);
  await page.goto("/#/planning/goals");
  await page.getByRole("button", { name: "Витратити" }).click();
  const dialog = page.getByRole("dialog", { name: "Витратити з «Відпустка в Італії»" });
  await expect(dialog.getByText("Booking.com")).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Booking\.com/ }).check();
  await dialog.getByRole("checkbox", { name: /Wizz Air/ }).check();
  await expect(dialog.getByRole("button", { name: /^Ще\s5\sтранзакцій/ })).toBeVisible();
  const m = await page.locator("dialog.ws-dialog[open]").evaluate((d) => {
    const body = d.querySelector<HTMLElement>(".ws-dialog-body")!;
    const line = d.querySelector<HTMLElement>(".goal-spend-sum[aria-live]")!;
    const bar = d.querySelector<HTMLElement>(".ws-dialog-actions")!;
    return {
      scroll: body.scrollHeight,
      client: body.clientHeight,
      lineBottom: line.getBoundingClientRect().bottom,
      barTop: bar.getBoundingClientRect().top,
      bottom: d.getBoundingClientRect().bottom,
    };
  });
  expect(m.scroll).toBeLessThanOrEqual(m.client);
  expect(m.lineBottom).toBeLessThanOrEqual(m.barTop);
  expect(m.bottom).toBeLessThanOrEqual(880);
});

const LONG_NAME =
  "Відпустка всією родиною в Італії наступного літа з поїздками до Риму, Флоренції, Венеції та на узбережжя";

test("BUD-05@PoC FR 1, CMP-61@PoC AC11: a goal card with a long name keeps its title block wide and the «⋯» at the end of the header", async ({
  page,
}) => {
  await answer(page, LONG_NAME);
  await page.goto("/#/planning/goals");
  const card = page.getByRole("region", { name: LONG_NAME });
  await expect(card).toBeVisible();
  const m = await card.evaluate((c) => {
    const rect = (sel: string) => c.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
    const head = rect(".goal-card-head");
    const title = rect(".goal-card-title");
    const more = rect(".goal-card-head button[aria-label='Ще дії']");
    const h2 = c.querySelector<HTMLElement>(".goal-card-title h2")!;
    return {
      head: head.width,
      title: title.width,
      moreRight: more.right,
      headRight: head.right,
      h2Height: h2.getBoundingClientRect().height,
      lineHeight: Number.parseInt(getComputedStyle(h2).lineHeight, 10),
    };
  });
  await page.screenshot({ path: process.env["WS_SHOT"] ?? "test-results/goals-1280.png" });
  expect(m.title).toBeGreaterThan(m.head * 0.5);
  expect(m.moreRight).toBeGreaterThan(m.headRight - 24);
  // A heading of a few lines, not one character per line.
  expect(m.h2Height).toBeLessThan(m.lineHeight * 6);
});

test("CMP-61@PoC AC11: the «⋯» of MoreActions in the gallery is only as wide as its button", async ({
  page,
}) => {
  await page.goto("/#/gallery/tokens");
  const root = page.locator('figure[data-case="many"] .ws-menu-root');
  await root.scrollIntoViewIfNeeded();
  const w = (await root.boundingBox())!.width;
  expect(w).toBeLessThan(64);
});

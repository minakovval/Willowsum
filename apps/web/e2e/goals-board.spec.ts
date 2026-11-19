import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/**
 * BUD-05@PoC FR 4 (issue #583, boards PocPlanGoalCard / PocPlanGoals) in a real browser at 1280 × 880 px: the card with a
 * long goal name and a long account name — no horizontal scroll, the tiles inside the card, «Внести» and «Витратити» 8 px
 * apart, «Де лежать гроші» and «Внески» inside the one card, no empty «Проєкція» slot. Synthetic data, answered in the browser.
 */
test.use({ viewport: { width: 1280, height: 880 } });

const eur = (amount: string) => ({ amount, currency: "EUR" });
const G1 = "a0000000-0000-4000-8000-000000000001";
const G2 = "a0000000-0000-4000-8000-000000000002";
const ACC = "b0000000-0000-4000-8000-000000000001";
const NAME = "Відпустка всією родиною в Італії наступного літа з поїздками до Риму, Флоренції та Венеції";
const WORD = "Надзвичайнодовгаоднословеснаназвацілібезжоднихпробілівдлятест";
const ACCOUNT = "Накопичувальний рахунок для відпустки з дуже довгою назвою у банку";
const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const goal = (id: string, name: string, over: Record<string, unknown>) => ({
  achieved: false,
  canContribute: true,
  collected: eur("2100.00"),
  contributedThisMonth: eur("250.00"),
  contributions: [
    { id: "c0000000-0000-4000-8000-000000000001", date: "2026-11-01", amount: eur("250.00") },
    { id: "c0000000-0000-4000-8000-000000000002", date: "2026-10-01", amount: eur("250.00") },
  ],
  createdOn: "2026-07-14",
  emergencyMonths: null,
  forecastDate: "2027-06-15",
  id,
  name,
  overdue: false,
  overTarget: null,
  pace: eur("250.00"),
  part: { accountId: ACC, freeBalance: eur("3500.00"), kind: "envelope", startAmount: eur("1000.00") },
  progressPercent: "52.5",
  requiredMonthly: eur("238"),
  spends: [],
  target: eur("4000.00"),
  targetDate: "2027-07-01",
  template: "travel",
  version: 1,
  ...over,
});

async function answer(page: Page, goals: unknown[]) {
  await page.route("**/v1/goals", (route) => route.fulfill(json({ goals })));
  await page.route("**/v1/accounts**", (route) =>
    route.fulfill(
      json({
        items: [
          {
            id: ACC,
            name: ACCOUNT,
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
}

test("BUD-05@PoC FR 4: the card with a long goal name and a long account name fits 1280 px and follows the board", async ({
  page,
}) => {
  await answer(page, [
    goal(G1, NAME, {}),
    goal(G2, WORD, {
      template: "emergency",
      part: { accountId: ACC, freeBalance: null, kind: "account", startAmount: eur("0") },
    }),
  ]);
  await page.goto("/#/planning/goals");
  const card = page.getByRole("region", { name: NAME });
  await expect(card).toBeVisible();
  const m = await page.evaluate(() => {
    const r = (el: Element) => el.getBoundingClientRect();
    const c = document.querySelector(".goal-card")!;
    const actions = [...document.querySelectorAll(".goal-card-actions button")].map((b) => r(b));
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tilesInside: [...c.querySelectorAll(".goal-fact")].every((t) => r(t).right <= r(c).right),
      tiles: c.querySelectorAll(".goal-fact").length,
      gap: actions.length > 1 ? actions[1]!.left - actions[0]!.right : -1,
      linksInside: [...c.querySelectorAll(".goal-links")].length,
      cards: [...document.querySelectorAll<HTMLElement>("[data-plan-region='detail'] .ws-card")].filter(
        (el) => el.offsetParent !== null,
      ).length,
      projection: getComputedStyle(document.querySelector("[data-plan-region='projection']")!).display,
    };
  });
  await page.screenshot({ path: process.env["WS_SHOT"] ?? "test-results/goals-board-1280.png" });
  expect(m.overflow).toBe(0);
  expect(m.tilesInside).toBe(true);
  expect(m.tiles).toBe(4);
  expect(m.gap).toBe(8);
  expect(m.linksInside).toBe(2);
  expect(m.cards).toBe(1);
  expect(m.projection).toBe("none");
  await page.getByRole("link", { name: new RegExp(WORD) }).click();
  const second = page.getByRole("region", { name: WORD });
  await expect(second).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBe(0);
  await page.screenshot({
    path: (process.env["WS_SHOT"] ?? "test-results/goals-board-1280.png").replace(/\.png$/, "-account.png"),
  });
});

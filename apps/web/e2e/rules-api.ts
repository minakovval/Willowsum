import type { Page } from "@playwright/test";

/** S-197 «Правила категорій» answered in the browser with synthetic data and a stateful order (shared by the rules specs). */
export const ID = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const CATEGORY = "00000000-0000-4000-8000-0000000000c1";

export async function answerApi(page: Page) {
  let order = [1, 2, 3, 4];
  const rule = (n: number) => ({
    id: ID(n),
    position: order.indexOf(n) + 1,
    conditions: [{ field: "merchant", operator: "equals", value: `Мерчант ${n}` }],
    accountIds: [],
    categoryId: CATEGORY,
    enabled: true,
    needsAttention: null,
    appliedCount: 0,
    tags: [],
  });
  await page.route("**/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/v1/session")
      return json({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      });
    if (pathname === "/v1/category-rules" && method === "GET")
      return json({ items: [...order].map((n) => rule(n)) });
    const move = /\/v1\/category-rules\/(.+)\/move$/.exec(pathname);
    if (move && method === "POST") {
      const n = Number(move[1]!.slice(-1));
      const { position } = route.request().postDataJSON() as { position: number };
      order = order.filter((x) => x !== n);
      order.splice(position - 1, 0, n);
      return json({ items: order.map((x) => rule(x)) });
    }
    if (pathname === "/v1/categories") return json({ groups: [] });
    if (pathname === "/v1/accounts") return json({ items: [], nextCursor: null });
    if (pathname === "/v1/category-rule-runs") return json({ items: [] });
    return json({});
  });
}

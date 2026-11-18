import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, problem, renderAt, resetAuthState, type Reply } from "../auth/testing.tsx";
import { optionalLimits, overspend, periodFromHash, stateOf, type Row } from "./budget/model.ts";

/** Security probes of PR 545 (BUD-02@PoC d)): what S-121 asks the API, what it shows on a refusal, text not HTML, money. */
const G = "9a000000-0000-4000-8000-000000000001";
const C1 = "c0000000-0000-4000-8000-000000000001";
const EVIL = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>`;
const eur = (amount: string) => ({ amount, currency: "EUR" });
const BUDGET = {
  budget: {
    id: "b0000000-0000-4000-8000-000000000001",
    createdOn: "2026-09-03",
    currency: "EUR",
    firstPeriod: "2026-09",
    incomePlan: eur("100.00"),
    limits: [],
    proportional: null,
    version: 1,
  },
};
const TREE = {
  groups: [
    {
      id: G,
      systemKey: null,
      kind: "expense",
      name: EVIL,
      renamed: false,
      tone: "neutral",
      categories: [
        {
          id: C1,
          groupId: G,
          systemKey: null,
          kind: "expense",
          name: EVIL,
          renamed: false,
          icon: "shopping",
          color: "#336699",
          iconTone: "white",
          essential: false,
          hidden: false,
          deletable: true,
        },
      ],
    },
  ],
};
const PERIOD = {
  period: "2026-11",
  mode: "current",
  currency: "EUR",
  approximate: { nearestRateCount: 0, unavailableCount: 0 },
  groups: [
    {
      groupId: G,
      categories: [
        {
          categoryId: C1,
          groupId: G,
          limit: eur("10.00"),
          mandatory: false,
          spent: eur("12.00"),
          remaining: eur("-2.00"),
        },
      ],
    },
  ],
  incomeActual: eur("100.00"),
  incomePlan: eur("100.00"),
  outsidePlan: { categories: [], total: eur("0.00") },
  plannedSavings: eur("0.00"),
  proportional: null,
  totals: { limits: eur("10.00"), spent: eur("12.00"), remaining: eur("-2.00") },
};
const ok = (over: Record<string, Reply> = {}) =>
  fakeApi({
    "GET /v1/budget": { status: 200, body: BUDGET },
    "GET /v1/categories": { status: 200, body: TREE },
    "GET /v1/budget/periods/2026-11": { status: 200, body: PERIOD },
    ...over,
  });
const row = (remaining: { amount: string; currency: string } | null, over: Partial<Row> = {}): Row => ({
  id: "r",
  name: "",
  groupId: G,
  mandatory: false,
  limit: null,
  spent: null,
  remaining,
  state: null,
  ...over,
});

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BUD-02@PoC d) security probes PR545", () => {
  it("BUD-02@PoC П-5: the page only sends body-less GETs to the budget, period and categories paths — no space id, no query", async () => {
    const seen: string[] = [];
    const record = (reply: Reply) =>
      ((_c: unknown, url: URL) => (seen.push(url.pathname + url.search), reply)) as never;
    const { client, calls } = ok({
      "GET /v1/budget": record({ status: 200, body: BUDGET }),
      "GET /v1/categories": record({ status: 200, body: TREE }),
      "GET /v1/budget/periods/2026-11": record({ status: 200, body: PERIOD }),
    });
    renderAt("#/planning/budget", client);
    await screen.findByRole("table");
    const own = calls.filter((c) => c.path !== "/v1/space" && c.path !== "/v1/session");
    for (const c of own) expect(c).toMatchObject({ method: "GET", body: undefined });
    expect(own.map((c) => c.path).sort()).toEqual([
      "/v1/budget",
      "/v1/budget/periods/2026-11",
      "/v1/categories",
    ]);
    expect(seen.sort()).toEqual(["/v1/budget", "/v1/budget/periods/2026-11", "/v1/categories"]);
  });

  it("BUD-02@PoC FR 16: a period of the address that is not YYYY-MM never reaches the request path", async () => {
    for (const bad of [
      "../../space",
      "2026-13",
      "2026-11/../../x",
      "2026-11%2F..",
      "2026-1",
      " 2026-11",
      "2026-11\n",
    ])
      expect(periodFromHash(`#/planning/budget?period=${bad}`)).toBeNull();
    const { client, calls } = ok();
    renderAt("#/planning/budget?period=..%2F..%2Fspace", client);
    await screen.findByRole("table");
    expect(calls.filter((c) => c.path.startsWith("/v1/budget/periods/")).map((c) => c.path)).toEqual([
      "/v1/budget/periods/2026-11",
    ]);
  });

  it.each([
    ["without a session", 401, "UNAUTHENTICATED"],
    ["for a scoped member or with the flag off", 404, "NOT_FOUND"],
    ["without the permission", 403, "FORBIDDEN"],
  ])(
    "BUD-02@PoC П-5: a refusal of the budget %s shows only the error card and asks nothing more",
    async (_n, status, code) => {
      const { client, calls } = ok({ "GET /v1/budget": problem(status, code) });
      renderAt("#/planning/budget", client);
      expect(await screen.findByText("Не вдалося завантажити бюджет")).toBeTruthy();
      expect(
        calls.filter((c) => c.path.startsWith("/v1/budget/periods/") || c.path === "/v1/categories"),
      ).toEqual([]);
      expect(document.querySelector(".bud-table")).toBeNull();
      expect(document.querySelector("#bud-income-title")).toBeNull();
      // Not the «no budget» state either: a refusal is not told apart as «there is none».
      expect(screen.queryByRole("heading", { level: 2, name: "Бюджету ще немає" })).toBeNull();
      const card = document.querySelector("[role='alert']")!.textContent ?? "";
      expect(card).not.toContain(code);
      expect(card).not.toMatch(/urn:|€|\d{4}-\d{2}/);
    },
  );

  it("BUD-02@PoC П-5: a refused period after a readable budget shows no amounts of it", async () => {
    const { client } = ok({ "GET /v1/budget/periods/2026-11": problem(404, "NOT_FOUND") });
    renderAt("#/planning/budget", client);
    expect(await screen.findByText("Не вдалося завантажити бюджет")).toBeTruthy();
    expect(document.body.textContent).not.toContain("€");
  });

  it("BUD-02@PoC FR 9: a category or group name with markup is shown as text — in the table, the menu and the chip", async () => {
    const { client } = ok();
    renderAt("#/planning/budget", client);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    const item = [...document.querySelectorAll<HTMLElement>("[role='menuitemcheckbox']")].find((e) =>
      e.textContent?.includes("<img"),
    )!;
    fireEvent.click(item);
    await waitFor(() => expect(document.querySelector(".ws-filter-chip")).not.toBeNull());
    expect(document.querySelector(".bud-name")!.textContent).toBe(EVIL);
    expect(document.querySelector(".bud-group th")!.textContent).toBe(EVIL);
    expect(document.querySelector(".ws-filter-chip")!.textContent).toContain("<img");
    expect(document.querySelectorAll("img, script:not([src])").length).toBe(0);
    expect(document.querySelector("[onerror]")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("BUD-02@PoC FR 19: the overspend is an exact decimal sum — no JS number on the way", () => {
    expect(
      overspend([row(eur("-0.10")), row(eur("-0.20")), row(eur("0.00")), row(eur("5.00")), row(null)]),
    ).toEqual({
      count: 2,
      amount: "0.3",
      currency: "EUR",
    });
    expect(overspend([row(eur("-9007199254740993.01")), row(eur("-0.02"))])?.amount).toBe(
      "9007199254740993.03",
    );
    expect(overspend([row(eur("0.00")), row(eur("1.00"))])).toBeNull();
  });

  it("BUD-02@PoC FR 19 (DS-23 FR 4): the base of the overspend shade sums only the limits of optional categories, exactly", () => {
    expect(
      optionalLimits([
        row(null, { limit: eur("0.10") }),
        row(null, { limit: eur("0.20") }),
        row(null, { limit: eur("9007199254740993.00") }),
        row(null, { limit: eur("500.00"), mandatory: true }),
        row(null),
      ]),
    ).toBe("9007199254740993.3");
  });

  // BUD-02@PoC FR 1: one budget — one currency. The API holds it today; the client must not add across currencies.
  it("BUD-02@PoC FR 1, FR 19: remainders in two currencies are never added into one amount", () => {
    const mixed = overspend([row(eur("-10.00")), row({ amount: "-400.00", currency: "UAH" })]);
    expect(mixed === null || mixed.amount !== "410").toBe(true);
  });

  it("BUD-02@PoC FR 1 (DS-23 FR 4): limits in two currencies are never added into the base of the overspend shade", () => {
    const limits = [
      row(null, { limit: eur("10.00") }),
      row(null, { limit: { amount: "400.00", currency: "UAH" } }),
    ];
    expect(optionalLimits(limits)).not.toBe("410");
  });

  it("BUD-02@PoC FR 9 (owner 2026-11-18): a limit of 0 is «перевищено» only with spending", () => {
    expect(stateOf(eur("150.00"), eur("0.00"), false)).toBe("over");
    expect(stateOf(eur("0.00"), eur("0.00"), false)).toBe("notStarted");
  });
});

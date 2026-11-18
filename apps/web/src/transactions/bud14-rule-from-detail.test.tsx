import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, resetAuthState, type Reply } from "../auth/testing.tsx";
import { Card } from "./TransactionDetailPage.tsx";
import type { DetailData } from "./detail.ts";

/**
 * BUD-14@PoC FR 13 (follow-up of #511, issue #516): the pencil «Змінити правило» on S-047 «Деталь транзакції» opens
 * `RuleDialog`. Only the card of the detail is rendered, with the fake API. Synthetic data only.
 */
const ACC = "00000000-0000-4000-8000-000000000001";
const FOOD = "00000000-0000-4000-8000-0000000000c1";
const TX = "00000000-0000-4000-8000-0000000000aa";
const RULE = "00000000-0000-4000-8000-0000000000e1";

const GROUPS = [
  {
    id: "g1",
    systemKey: null,
    kind: "expense",
    name: "Щоденне",
    renamed: false,
    tone: "#5872D2",
    categories: [
      {
        id: FOOD,
        groupId: "g1",
        systemKey: null,
        kind: "expense",
        name: "Продукти",
        renamed: false,
        icon: "shapes",
        color: "#5872D2",
        iconTone: "white",
        essential: null,
        hidden: false,
        deletable: true,
      },
    ],
  },
];

function detail(counterparty: string | null): DetailData {
  return {
    transaction: {
      id: TX,
      accountId: ACC,
      amount: { amount: "-240.00", currency: "EUR" },
      type: "expense",
      date: "2026-03-01",
      counterparty,
      description: null,
      status: "posted",
      source: "import",
      hidden: false,
      split: null,
      transfer: null,
      mergedInto: null,
      mergedDuplicates: [],
      note: null,
      tags: [],
      review: null,
      version: 1,
      recordedAt: "2026-03-01T09:14:00Z",
    },
    category: { name: "Продукти", tone: 1 },
    categorySource: "rule",
    account: "Поточний ··4417",
    possibleDuplicate: false,
    names: new Map(),
    splitCategories: [],
  } as unknown as DetailData;
}

const storedRule = {
  id: RULE,
  position: 1,
  conditions: [{ field: "merchant", operator: "equals", value: "Сільпо" }],
  accountIds: [],
  categoryId: FOOD,
  enabled: true,
  needsAttention: null,
  appliedCount: 3,
  tags: [],
};

function show(counterparty: string | null, rules: unknown[], over: Record<string, Reply> = {}) {
  const fake = fakeApi({
    "GET /v1/category-rules": { status: 200, body: { items: rules } },
    "GET /v1/categories": { status: 200, body: { groups: GROUPS } },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [
          {
            id: ACC,
            name: "Поточний",
            number: { last4: "4417" },
            currencies: [{ currency: "EUR" }],
            status: "active",
          },
        ],
        nextCursor: null,
      },
    },
    "POST /v1/category-rules/matches": {
      status: 200,
      body: { count: 0, totals: [], truncated: false, items: [] },
    },
    ...over,
  });
  render(
    <I18nProvider initialLocale="uk">
      <HideAmountsProvider>
        <AuthApiProvider value={fake.client}>
          <Card data={detail(counterparty)} reload={() => undefined} replace={() => undefined} />
        </AuthApiProvider>
      </HideAmountsProvider>
    </I18nProvider>,
  );
  return fake;
}

vi.setConfig({ testTimeout: 20000 });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("BUD-14@PoC FR 13: S-047 «Змінити правило»", () => {
  it("BUD-14@PoC FR 13: the pencil «Змінити правило» opens the editor of the rule of this merchant", async () => {
    show("Сільпо", [storedRule]);
    fireEvent.click(screen.getByRole("button", { name: "Змінити правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    expect((within(dialog).getByRole("textbox", { name: "Значення" }) as HTMLInputElement).value).toBe(
      "Сільпо",
    );
    expect(within(dialog).getByRole("button", { name: /Категорія/ }).textContent).toContain("Продукти");
  });

  it("BUD-14@PoC FR 13: without a rule of the merchant the pencil opens a new rule with «Мерчант дорівнює <мерчант>» filled in", async () => {
    const fake = show("ТОВ Ромашка", [storedRule], {
      "POST /v1/category-rules": {
        status: 201,
        body: { ...storedRule, id: "00000000-0000-4000-8000-0000000000e2", duplicateOf: null },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Змінити правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    expect((within(dialog).getByRole("textbox", { name: "Значення" }) as HTMLInputElement).value).toBe(
      "ТОВ Ромашка",
    );
    expect(within(dialog).getByRole("combobox", { name: "Поле" }).textContent).toContain("Мерчант");
    expect(within(dialog).getByRole("combobox", { name: "Оператор" }).textContent).toContain("дорівнює");
    // Nothing is created by opening it; the category is still to choose.
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/category-rules")).toHaveLength(0);
    expect(within(dialog).getAllByRole("textbox", { name: "Значення" })).toHaveLength(1);
  });

  it("BUD-14@PoC FR 13: Escape closes the editor and the transaction stays as it was", async () => {
    show("Сільпо", [storedRule]);
    fireEvent.click(screen.getByRole("button", { name: "Змінити правило" }));
    const dialog = await screen.findByRole("dialog", { name: "Правило категорії" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("BUD-14@PoC FR 13: a transaction without a merchant has no pencil", () => {
    show(null, []);
    expect(screen.queryByRole("button", { name: "Змінити правило" })).toBeNull();
  });

  it("BUD-14@PoC FR 13: when the rules cannot be read the pencil shows the load error, not an empty editor", async () => {
    show("Сільпо", [], { "GET /v1/category-rules": { status: 500, body: {} } });
    fireEvent.click(screen.getByRole("button", { name: "Змінити правило" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Не вдалося завантажити правила");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

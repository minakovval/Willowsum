import { act, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, problem, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import { AuthApiProvider } from "../auth/api.ts";
import { resetTracked } from "./bulk.ts";
import { ReviewQueue } from "./ReviewQueue.tsx";
import { resetReviewCount } from "./reviewCount.ts";

/**
 * BUD-12@PoC b): «Відмінити» after the confirmation of a whole group (FR 6, FR 14, AC11, AC12) on the bulk actions
 * of the merged server part (`POST /v1/bulk-actions/{id}/undo`). Only `ReviewQueue` is rendered, with a fake API that
 * answers as the server does. Synthetic data only.
 */
const FOOD = "00000000-0000-4000-8000-0000000000c3";
const OTHER = "00000000-0000-4000-8000-0000000000c5";
const ids = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`);
const nm = (text: string) =>
  new RegExp(`^${text.replace(/[.*+?^${"$"}{}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s")}$`);
const FAR = () => new Date(Date.now() + 24 * 3600_000).toISOString();

function group(id: string, name: string | null, count: number, suggested: string | null) {
  return {
    id,
    count,
    counterparty: name ? name.toUpperCase() : null,
    merchant: name
      ? { id: "00000000-0000-4000-8000-0000000d0001", initials: name[0], intermediary: false, name }
      : null,
    mixedCategories: false,
    oldest: "2026-10-01",
    suggestedCategoryId: suggested,
    totals: [{ amount: "-100.00", currency: "EUR" }],
  };
}

function report(id: string, action: string, count: number, undo: Record<string, unknown>) {
  return {
    id,
    action,
    background: false,
    status: "completed",
    count,
    processed: count,
    changed: count,
    skipped: { unavailable: 0, unchanged: 0, conflict: 0, invalid: 0 },
    skippedRecords: [],
    undo: { available: true, until: FAR(), restored: 0, notRestored: 0, ...undo },
    createdAt: "2026-11-18T10:00:00Z",
    endedAt: "2026-11-18T10:00:01Z",
  };
}

/** A queue of `total` transactions with one group of `n`; confirming removes the group, undoing puts it back. */
function space({
  g,
  n,
  total,
  undo = {},
  undoReply,
  setUndoReply,
}: {
  g: ReturnType<typeof group>;
  n: number;
  total: number;
  undo?: Record<string, unknown>;
  undoReply?: Reply;
  /** A mixed group: «Підтвердити» sets the category first (action a0), then confirms it (a1). */
  setUndoReply?: Reply;
}) {
  const members = ids(500, n);
  const state = { groups: [g, group("g-rest", "Нова пошта", total - n, null)], left: total };
  const api = fakeApi({
    "GET /v1/categories": {
      status: 200,
      body: {
        groups: [
          {
            id: "grp",
            kind: "expense",
            name: "Витрати",
            categories: [FOOD, OTHER].map((id, i) => ({
              id,
              groupId: "grp",
              systemKey: null,
              kind: "expense",
              name: i ? "Інше" : "Продукти",
              renamed: false,
              icon: "budget",
              color: "#5872D2",
              iconTone: "white",
              essential: null,
              hidden: false,
              deletable: true,
            })),
          },
        ],
      },
    },
    "GET /v1/transaction-review": () => ({ status: 200, body: { count: state.left } }),
    "GET /v1/transaction-review/merchant-groups": () => ({
      status: 200,
      body: {
        count: state.groups.length,
        items: state.groups,
        page: 1,
        pageSize: 100,
        transactionCount: state.left,
        truncated: false,
      },
    }),
    [`GET /v1/transaction-review/merchant-groups/${g.id}/transactions`]: {
      status: 200,
      body: { items: members, nextCursor: null },
    },
    "POST /v1/category-rules": { status: 201, body: { id: "r1" } },
    "POST /v1/bulk-actions": (call) => {
      if ((call.body as { action: string }).action === "transactions.set-category")
        return { status: 201, body: report("a0", "transactions.set-category", n, undo) };
      state.groups = state.groups.slice(1);
      state.left -= n;
      return { status: 201, body: report("a1", "transactions.confirm-category", n, undo) };
    },
    "POST /v1/bulk-actions/a1/undo":
      undoReply ??
      (() => {
        state.groups = [g, ...state.groups];
        state.left += n;
        return { status: 200, body: report("a1", "transactions.confirm-category", n, { restored: n }) };
      }),
    ...(setUndoReply ? { "POST /v1/bulk-actions/a0/undo": setUndoReply } : {}),
  });
  return { api, state };
}

const progress = () => plain(document.querySelector(".ws-progress-text")?.textContent);
const undoCalls = (api: ReturnType<typeof fakeApi>) =>
  api.calls.filter((c) => c.method === "POST" && c.path === "/v1/bulk-actions/a1/undo");

function open(api: ReturnType<typeof fakeApi>) {
  return render(
    <I18nProvider initialLocale="uk">
      <AuthApiProvider value={api.client}>
        <ReviewQueue />
      </AuthApiProvider>
    </I18nProvider>,
  );
}
async function confirmGroup(count: number) {
  await act(async () => screen.getByRole("button", { name: nm(`Підтвердити ${count}`) }).click());
  await waitFor(() => expect(document.querySelector(".ws-toast")).not.toBeNull());
}
const toastText = () => plain(document.querySelector(".ws-toast")!.textContent);

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetTracked();
  resetReviewCount();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BUD-12@PoC b): «Відмінити» after a group", () => {
  it("BUD-12@PoC AC12: «Відмінити» on the toast of a group of 18 undoes it with the id of the action — the 18 are back in the queue, progress shows the previous values", async () => {
    const { api } = space({ g: group("g-silpo", "Сільпо", 18, FOOD), n: 18, total: 103 });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    await confirmGroup(18);
    await waitFor(() => expect(progress()).toBe("18 з 103 · лишилось 85"));
    expect(toastText()).toContain("Категорію підтверджено для 18 транзакцій");

    await act(async () => screen.getByRole("button", { name: "Відмінити" }).click());
    await waitFor(() => expect(progress()).toBe("0 з 103 · лишилось 103"));
    expect(undoCalls(api)).toHaveLength(1);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
  });

  it("BUD-12@PoC AC12: when the API says `undo.available` = ні, the toast has no «Відмінити»", async () => {
    const { api } = space({
      g: group("g-silpo", "Сільпо", 18, FOOD),
      n: 18,
      total: 103,
      undo: { available: false, until: null },
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    await confirmGroup(18);
    expect(toastText()).toContain("Категорію підтверджено для 18 транзакцій");
    expect(screen.queryByRole("button", { name: "Відмінити" })).toBeNull();
  });

  it("BUD-12@PoC FR 6: after the deadline of the API «Відмінити» calls nothing and the error pattern «Дію не виконано» shows; progress stays", async () => {
    const { api } = space({
      g: group("g-silpo", "Сільпо", 18, FOOD),
      n: 18,
      total: 103,
      undo: { until: new Date(Date.now() + 60_000).toISOString() },
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    await confirmGroup(18);
    // 24 hours later: the window the API reported is over.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 25 * 3600_000);
    await act(async () => screen.getByRole("button", { name: "Відмінити" }).click());
    await waitFor(() => expect(toastText()).toContain("Дію не виконано"));
    expect(undoCalls(api)).toHaveLength(0);
    expect(progress()).toBe("18 з 103 · лишилось 85");
    expect(screen.queryByRole("button", { name: "Відмінити" })).toBeNull();
  });

  it("BUD-12@PoC FR 6: when the API refuses (BULK_UNDO_UNAVAILABLE) the error pattern shows with its code and nothing comes back", async () => {
    const { api } = space({
      g: group("g-silpo", "Сільпо", 18, FOOD),
      n: 18,
      total: 103,
      undoReply: problem(409, "BULK_UNDO_UNAVAILABLE"),
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    await confirmGroup(18);
    await act(async () => screen.getByRole("button", { name: "Відмінити" }).click());
    await waitFor(() => expect(toastText()).toContain(`Дію не виконано · Код: ${SUPPORT_ID}`));
    expect(undoCalls(api)).toHaveLength(1);
    expect(progress()).toBe("18 з 103 · лишилось 85");
  });

  it("BUD-12@PoC FR 6: a mixed group undoes confirm-category before set-category; when the second undo fails, the queue is reloaded and the partial-undo text shows", async () => {
    const { api } = space({
      g: { ...group("g-silpo", "Сільпо", 18, FOOD), mixedCategories: true },
      n: 18,
      total: 103,
      setUndoReply: problem(500, "INTERNAL"),
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    await confirmGroup(18);
    await act(async () => screen.getByRole("button", { name: "Відмінити" }).click());
    await waitFor(() => expect(toastText()).toContain("Відмінено частково"));
    const undos = api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/undo")).map((c) => c.path);
    expect(undos).toEqual(["/v1/bulk-actions/a1/undo", "/v1/bulk-actions/a0/undo"]);
    // The confirmations came back before the failure: progress and the group show them.
    expect(progress()).toBe("0 з 103 · лишилось 103");
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
  });

  it("BUD-12@PoC FR 6: a partial undo (confirm-category undone, set-category refused) shows its own text, not «Дію не виконано»", async () => {
    const { api } = space({
      g: { ...group("g-silpo", "Сільпо", 18, FOOD), mixedCategories: true },
      n: 18,
      total: 103,
      setUndoReply: problem(500, "INTERNAL"),
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    await confirmGroup(18);
    await act(async () => screen.getByRole("button", { name: "Відмінити" }).click());
    await waitFor(() =>
      expect(toastText()).toBe("Відмінено частково: транзакції знову в черзі, але категорію не повернуто"),
    );
    expect(toastText()).not.toContain("Дію не виконано");
  });

  it("BUD-12@PoC FR 6: a partial undo with `undo.notRestored` = 3 shows that count", async () => {
    const { api } = space({
      g: { ...group("g-silpo", "Сільпо", 18, FOOD), mixedCategories: true },
      n: 18,
      total: 103,
      // The first undo (confirm-category) reports 3 transactions it could not restore.
      undoReply: {
        status: 200,
        body: report("a1", "transactions.confirm-category", 18, { restored: 15, notRestored: 3 }),
      },
      setUndoReply: problem(500, "INTERNAL"),
    });
    open(api);
    await screen.findByRole("heading", { name: nm("Сільпо · 18 транзакцій") });
    await confirmGroup(18);
    await act(async () => screen.getByRole("button", { name: "Відмінити" }).click());
    await waitFor(() =>
      expect(toastText()).toBe("Відмінено частково: не відновлено 3. Категорію не повернуто"),
    );
  });
});

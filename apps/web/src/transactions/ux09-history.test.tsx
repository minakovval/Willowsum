import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, resetAuthState, type Call, type Reply } from "../auth/testing.tsx";
import { accountPath } from "../routing/routes.ts";
import { resetNavigationSession } from "../routing/session.ts";
import { filteredTransactionsPath } from "./filters.ts";
import { TransactionsPage } from "./TransactionsPage.tsx";

/**
 * UX-09@PoC AC 3, AC 4, FR 9: the list of «Транзакції» alone (no App): from an account card with its filter, and
 * back from a record with the page, the filters and the scroll position. Synthetic data only.
 */
const SAVINGS = "00000000-0000-4000-8000-000000000003";
const CURRENT = "00000000-0000-4000-8000-000000000001";
const eur = (amount: string) => ({ amount, currency: "EUR" });
const txId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tx = (n: number) => ({
  id: txId(n),
  accountId: n % 2 ? CURRENT : SAVINGS,
  amount: eur(`-${n}.50`),
  type: "expense",
  date: `2026-11-${String(((n - 1) % 28) + 1).padStart(2, "0")}`,
  counterparty: `Мерчант ${n}`,
  description: null,
  status: "posted",
  source: "manual",
  hidden: false,
  split: null,
  transfer: null,
  mergedInto: null,
  mergedDuplicates: [],
  note: null,
  tags: [],
  review: null,
  version: 1,
  recordedAt: "2026-11-02T09:14:00Z",
});
const ALL = Array.from({ length: 60 }, (_, i) => tx(i + 1));
const total = (amount: string) => ({
  total: eur(amount),
  converted: false,
  approximate: false,
  nearestRateCount: 0,
  partial: false,
  noRateCount: 0,
});
const account = (id: string, name: string, last4: string) => ({
  id,
  kind: "current",
  group: "cash",
  name,
  institution: null,
  number: { last4, masked: `••${last4}` },
  status: "active",
  closedOn: null,
  source: "manual",
  updatedOn: "2026-11-02",
  favourite: false,
  inProfileCurrency: { total: eur("1.00"), approximate: false, unavailableCount: 0 },
  currencies: [],
  creditCard: null,
  loan: null,
});

function listReply(_call: Call, url: URL): Reply {
  const q = url.searchParams;
  const only = q
    .getAll("filter")
    .find((f) => f.startsWith("accountId.eq:"))
    ?.slice("accountId.eq:".length);
  const shown = ALL.filter((t) => !only || t.accountId === only);
  const page = Number(q.get("page") ?? "1");
  const size = Number(q.get("pageSize") ?? "25");
  const items = shown.slice((page - 1) * size, page * size);
  return {
    status: 200,
    body: {
      items,
      page,
      pageSize: size,
      count: shown.length,
      from: items.length ? (page - 1) * size + 1 : 0,
      to: (page - 1) * size + items.length,
      summary: {
        currency: "EUR",
        income: total("1.00"),
        expense: total("-1.00"),
        difference: total("0.00"),
      },
    },
  };
}

function open() {
  const categories: Record<string, Reply> = {};
  for (const t of ALL)
    categories[`GET /v1/transactions/${t.id}/category`] = {
      status: 200,
      body: { transactionId: t.id, categoryId: null, source: "manual" },
    };
  const { client } = fakeApi({
    ...categories,
    "GET /v1/transactions": listReply,
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [account(CURRENT, "Поточний", "4417"), account(SAVINGS, "Ощадний", "1180")],
        nextCursor: null,
      },
    },
    "GET /v1/transaction-tags": { status: 200, body: { items: [] } },
    "GET /v1/categories": { status: 200, body: { groups: [] } },
    "GET /v1/transaction-review": { status: 200, body: { count: 0 } },
    "GET /v1/transfer-proposals": { status: 200, body: { items: [], count: 0, more: false } },
  });
  return render(
    <I18nProvider>
      <AuthApiProvider value={client}>
        <HideAmountsProvider>
          <TransactionsPage />
        </HideAmountsProvider>
      </AuthApiProvider>
    </I18nProvider>,
  );
}

const loaded = () =>
  waitFor(() =>
    expect(document.querySelectorAll(".ws-tx-row-table:not(.ws-tx-head)").length).toBeGreaterThan(0),
  );
const range = () => plain(document.querySelector(".ws-pagination__range")?.textContent);
const chips = () => [...document.querySelectorAll(".ws-filter-chip")].map((c) => plain(c.textContent));

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

describe("UX-09@PoC history", () => {
  it("UX-09@PoC AC 3: from the account card the list opens with the chip «Рахунок: Ощадний», and «Назад» returns to the card, not to «Бюджет»", async () => {
    // The user came from «Планування › Бюджет» to the card, then pressed the link of the card.
    window.location.hash = "#/planning/budget";
    window.location.hash = `#${accountPath(SAVINGS)}`;
    window.location.hash = `#${filteredTransactionsPath({ account: SAVINGS })}`;
    open();
    await waitFor(() => expect(chips()).toEqual(["Рахунок: Ощадний ··1180"]));
    // The link's query is replaced in the address, so the entry before is the card.
    expect(window.location.hash).toBe("#/money/transactions");
    await new Promise<void>((resolve) => {
      window.addEventListener("hashchange", () => resolve(), { once: true });
      window.history.back();
    });
    expect(window.location.hash).toBe(`#${accountPath(SAVINGS)}`);
  });

  it("UX-09@PoC AC 4: on page 2 with a filter and a scroll, opening a record and «Назад» restores the same page, filters and position", async () => {
    window.location.hash = `#${filteredTransactionsPath({ account: SAVINGS })}`;
    const first = open();
    await waitFor(() => expect(chips()).toEqual(["Рахунок: Ощадний ··1180"]));
    await loaded();
    await waitFor(() => expect(range()).toBe("1–25 з 30"));
    fireEvent.click(screen.getByRole("button", { name: /Наступна/ }));
    await waitFor(() => expect(range()).toBe("26–30 з 30"));
    Object.defineProperty(window, "scrollY", { value: 640, configurable: true });
    act(() => void window.dispatchEvent(new Event("scroll")));
    // Opening a record is another page: the list unmounts; «Назад» mounts it again.
    first.unmount();
    cleanup();
    open();
    await waitFor(() => expect(range()).toBe("26–30 з 30"));
    expect(chips()).toEqual(["Рахунок: Ощадний ··1180"]);
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 640));
  });
});

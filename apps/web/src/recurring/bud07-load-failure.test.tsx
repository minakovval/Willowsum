import { cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, renderAt, resetAuthState } from "../auth/testing.tsx";
import { useLoad } from "./data.ts";

/**
 * BUD-07@PoC «Стани інтерфейсу» error, DS-04@PoC FR 13: a load that fails for any reason — an account number the
 * mask does not know, a malformed answer — ends in the error state with «Спробувати ще раз», never in «loading».
 */
const ACC = "9b0e7a6e-0000-4000-8000-000000000001";
const PAGE = "#/planning/recurring";
const FORM = "#/planning/recurring/new";

const money = { amount: "17.99", currency: "EUR" };
const PAYMENT = {
  id: "p1",
  name: "YouTube",
  type: "expense",
  frequency: "month",
  expectedAmount: money,
  anchorDate: "2026-08-03",
  nextDate: "2026-11-18",
  endDate: null,
  categoryId: null,
  accountId: ACC,
  merchantId: null,
  source: "manual",
  subscription: true,
  variable: false,
  createdOn: "2026-11-01",
  version: 1,
};

const account = (last4: string) => ({
  id: ACC,
  name: "Рахунок IBAN",
  kind: "current",
  status: "active",
  group: "cash",
  number: { last4, masked: `••${last4}` },
  currencies: [{ currency: "EUR" }],
  closedOn: null,
  creditCard: null,
  inProfileCurrency: { approximate: false, total: null, unavailableCount: 0 },
  institution: null,
  loan: null,
  source: "manual",
  updatedOn: "2026-11-01T10:00:00Z",
});

function api(accounts: unknown) {
  return fakeApi({
    "GET /v1/recurring/payments": { status: 200, body: { items: [PAYMENT] } },
    "GET /v1/recurring/proposals": { status: 200, body: { items: [], more: false } },
    "GET /v1/accounts": { status: 200, body: accounts },
    "GET /v1/categories": { status: 200, body: { groups: [] } },
  });
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("BUD-07@PoC non-numeric account number and failed loads", () => {
  it("DS-04@PoC FR 13: an account whose last 4 characters hold a letter is shown with the mask and those 4 characters as they are, the list still shows", async () => {
    renderAt(PAGE, api({ items: [account("12AB")], nextCursor: null }).client);
    await screen.findByRole("table");
    const row = screen.getByRole("rowheader", { name: /YouTube/ }).closest("tr")!;
    const text = plain(row.textContent);
    expect(text).toContain("Рахунок IBAN ··12AB");
  });

  it("DS-04@PoC FR 13: a numeric number keeps the mask «··4417»", async () => {
    renderAt(PAGE, api({ items: [account("4417")], nextCursor: null }).client);
    await screen.findByRole("table");
    expect(plain(screen.getByRole("rowheader", { name: /YouTube/ }).closest("tr")!.textContent)).toContain(
      "Рахунок IBAN ··4417",
    );
  });

  it("BUD-07@PoC «Стани інтерфейсу» error: a load that throws shows the error state and «Спробувати ще раз» reads again", async () => {
    let broken = true;
    const { client } = fakeApi({
      "GET /v1/recurring/payments": { status: 200, body: { items: [PAYMENT] } },
      "GET /v1/recurring/proposals": { status: 200, body: { items: [], more: false } },
      "GET /v1/accounts": () =>
        broken
          ? { status: 200, body: { items: null, nextCursor: null } }
          : { status: 200, body: { items: [account("4417")], nextCursor: null } },
      "GET /v1/categories": { status: 200, body: { groups: [] } },
    });
    renderAt(PAGE, client);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading").textContent).toBe("Не вдалося завантажити регулярні платежі");
    broken = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    await screen.findByRole("table");
  });

  it("BUD-07@PoC «Стани інтерфейсу» error: the «Додати вручну» form shows the error state when its load throws", async () => {
    renderAt(FORM, api({ items: null, nextCursor: null }).client);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
  });

  it("useLoad: a rejected load becomes the error state", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthApiProvider value={fakeApi({}).client}>{children}</AuthApiProvider>
    );
    const { result } = renderHook(() => useLoad(() => Promise.reject(new RangeError("boom"))), { wrapper });
    await waitFor(() => expect(result.current.result.state).toBe("error"));
  });

  it("useLoad: a load that throws synchronously becomes the error state", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthApiProvider value={fakeApi({}).client}>{children}</AuthApiProvider>
    );
    const { result } = renderHook(
      () =>
        useLoad(() => {
          throw new RangeError("boom");
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.result.state).toBe("error"));
  });
});

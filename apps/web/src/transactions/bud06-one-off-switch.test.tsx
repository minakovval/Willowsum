import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { useState } from "react";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import { Card } from "./TransactionDetailPage.tsx";
import type { DetailData, TransactionDetail } from "./detail.ts";

/**
 * BUD-06@PoC FR 8, AC4: the switch «Одноразова витрата» in S-047 «Деталь транзакції» on `PUT …/one-off` (#685). Only the
 * card is rendered, with the fake API; synthetic data only.
 */
const TX = "00000000-0000-4000-8000-0000000000aa";
const URL_PUT = `PUT /v1/transactions/${TX}/one-off`;

function data(over: Partial<TransactionDetail> = {}, oneOffOn = true): DetailData {
  return {
    transaction: {
      id: TX,
      accountId: "00000000-0000-4000-8000-000000000001",
      amount: { amount: "-3500.00", currency: "EUR" },
      type: "expense",
      date: "2026-03-01",
      counterparty:
        "Ремонт даху Ремонт даху Ремонт даху Ремонт даху Ремонт даху ДуженадтоДовгаНазваБезПробілівДляПеревіркиПереносу",
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
      oneOff: false,
      review: null,
      version: 1,
      recordedAt: "2026-03-01T09:14:00Z",
      ...over,
    },
    category: { name: "Дім", tone: 1 },
    categorySource: "manual",
    account: "Поточний ··4417",
    possibleDuplicate: false,
    names: new Map(),
    splitCategories: [],
    oneOffOn,
  } as unknown as DetailData;
}

function Host({ start }: { start: DetailData }) {
  const [d, setD] = useState(start);
  return <Card data={d} reload={() => undefined} replace={(transaction) => setD({ ...d, transaction })} />;
}

function show(start: DetailData, put?: Reply | (() => Promise<Reply>)) {
  const fake = fakeApi(
    put
      ? {
          [URL_PUT]: typeof put === "function" ? put : put,
        }
      : {},
  );
  render(
    <I18nProvider initialLocale="uk">
      <HideAmountsProvider>
        <AuthApiProvider value={fake.client}>
          <Host start={start} />
        </AuthApiProvider>
      </HideAmountsProvider>
    </I18nProvider>,
  );
  return fake;
}

const SWITCH = { name: "Одноразова витрата" };

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("BUD-06@PoC FR 8: «Одноразова витрата» in the details", () => {
  it("BUD-06@PoC FR 8: an expense that is no side of a transfer shows the switch with the hint, off by default", () => {
    show(data());
    const sw = screen.getByRole("switch", SWITCH);
    expect((sw as HTMLInputElement).checked).toBe(false);
    const hint = plain(document.getElementById(sw.getAttribute("aria-describedby") ?? "")?.textContent);
    expect(hint).toMatch(/лишається у своєму місяці/);
    expect(hint).toMatch(/не враховується в середніх за 3, 6 і 12 міс\./);
    expect(hint).toMatch(/майстрі «Створити за моїми витратами»/);
    expect(hint).toMatch(/«Подушці безпеки»/);
  });

  it("BUD-06@PoC FR 8: no switch for an income, a side of a transfer, or while the flag is off", () => {
    show(data({ amount: { amount: "900.00", currency: "EUR" }, type: "income" } as never));
    expect(screen.queryByRole("switch", SWITCH)).toBeNull();
    cleanup();
    show(data({ transfer: { pairId: "p", counterpartTransactionId: "q" } } as never));
    expect(screen.queryByRole("switch", SWITCH)).toBeNull();
    cleanup();
    show(data({}, false));
    expect(screen.queryByRole("switch", SWITCH)).toBeNull();
  });

  it("BUD-06@PoC AC4: turning it on saves `{ oneOff: true }` and shows the transaction the API answers with", async () => {
    const fake = show(data(), { status: 200, body: data({ oneOff: true }).transaction });
    fireEvent.click(screen.getByRole("switch", SWITCH));
    await waitFor(() => expect((screen.getByRole("switch", SWITCH) as HTMLInputElement).checked).toBe(true));
    expect(fake.calls.filter((c) => c.method === "PUT")).toEqual([
      expect.objectContaining({ path: `/v1/transactions/${TX}/one-off`, body: { oneOff: true } }),
    ]);
  });

  it("BUD-06@PoC AC4: turning it off saves `{ oneOff: false }`", async () => {
    const fake = show(data({ oneOff: true }), { status: 200, body: data({ oneOff: false }).transaction });
    fireEvent.click(screen.getByRole("switch", SWITCH));
    await waitFor(() => expect((screen.getByRole("switch", SWITCH) as HTMLInputElement).checked).toBe(false));
    expect(fake.calls.find((c) => c.method === "PUT")?.body).toEqual({ oneOff: false });
  });

  it("BUD-06@PoC FR 8: while saving the switch keeps its value, is disabled and «Зберігаємо…» shows (no optimistic UI)", async () => {
    let release: (r: Reply) => void = () => undefined;
    show(data(), () => new Promise<Reply>((r) => (release = r)));
    fireEvent.click(screen.getByRole("switch", SWITCH));
    const sw = await screen.findByRole("switch", SWITCH);
    await waitFor(() => expect((sw as HTMLInputElement).disabled).toBe(true));
    expect((sw as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Зберігаємо…");
    release({ status: 200, body: data({ oneOff: true }).transaction });
    await waitFor(() => expect((screen.getByRole("switch", SWITCH) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole("switch", SWITCH) as HTMLInputElement).disabled).toBe(false);
  });

  it("BUD-06@PoC FR 8: 400 `oneOff: not_expense` says only an expense can be marked, with the code", async () => {
    show(data(), {
      status: 400,
      body: {
        ...(problem(400, "VALIDATION_FAILED") as { body: object }).body,
        errors: [{ in: "body", path: "oneOff", issue: "not_expense" }],
      },
      headers: { "content-type": "application/problem+json" },
    });
    fireEvent.click(screen.getByRole("switch", SWITCH));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Одноразовою можна позначити лише витрату.");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
    expect((screen.getByRole("switch", SWITCH) as HTMLInputElement).checked).toBe(false);
  });

  it("BUD-06@PoC FR 8: 409 `TRANSACTION_IN_TRANSFER` says a side of a transfer is not an expense, with the code", async () => {
    show(data(), problem(409, "TRANSACTION_IN_TRANSFER"));
    fireEvent.click(screen.getByRole("switch", SWITCH));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Сторона переказу між власними рахунками не є витратою");
    expect(alert.textContent).toContain(`Код: ${SUPPORT_ID}`);
  });

  it("BUD-06@PoC FR 8: a lost connection shows the common error and the switch can be tried again", async () => {
    show(data(), "network");
    fireEvent.click(screen.getByRole("switch", SWITCH));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("switch", SWITCH) as HTMLInputElement).disabled).toBe(false);
  });
});

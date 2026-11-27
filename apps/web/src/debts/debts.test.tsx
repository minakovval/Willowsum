import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, renderAt, resetAuthState, SUPPORT_ID } from "../auth/testing.tsx";
import type { Debt } from "./api.ts";
import { DebtsScreen } from "./DebtsScreen.tsx";

/**
 * BUD-19@PoC b) — the page «Борги» (S-143) and its tab «Прогрес» (S-146) on `GET /v1/debts` (canvas PocPlanDebts,
 * PocPlanDebtsEmpty, PocPlanDebtProgress). Synthetic debts only.
 */
const LOAN = "0f6b1c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const CARD = "1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
const PARENTS = "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e";
const eur = (amount: string) => ({ amount, currency: "EUR" });

const loan: Debt = {
  accountId: LOAN,
  kind: "loan",
  name: "Автокредит",
  balance: eur("4100.00"),
  annualRate: "9.9",
  monthlyPayment: eur("310.00"),
  cardMonthlyAmount: null,
  termsMissing: false,
  base: {
    status: "paid",
    months: 15,
    payoffMonth: "2028-02",
    totalInterest: eur("262.10"),
    schedule: [],
    cappedOneOffs: [],
  },
  progress: { paidPercent: 34, remainingMonths: 15, plan: { status: "ahead", amount: eur("80.00") } },
  plan: null,
};
/** A loan whose 90 € does not cover the month's interest of 100 € (FR 3). */
const stuckLoan: Debt = {
  ...loan,
  accountId: CARD,
  name: "Універсальна",
  balance: eur("5000.00"),
  annualRate: "24",
  monthlyPayment: eur("90.00"),
  base: {
    status: "not-decreasing",
    months: null,
    payoffMonth: null,
    totalInterest: null,
    schedule: [],
    cappedOneOffs: [],
  },
  progress: { paidPercent: 27, remainingMonths: null, plan: { status: "behind", amount: eur("15.50") } },
};
/** A credit card without «Зменшувати на … / міс.» (FLW-44@PoC FR 1): no rate, no payment, no calculation yet. */
const card: Debt = {
  accountId: CARD,
  kind: "credit-card",
  name: "Універсальна",
  balance: eur("800.00"),
  annualRate: null,
  monthlyPayment: null,
  cardMonthlyAmount: null,
  termsMissing: true,
  base: null,
  progress: { paidPercent: 27, remainingMonths: null, plan: { status: "behind", amount: eur("15.50") } },
  plan: null,
};
/** The same card with 200 € a month: 800 ÷ 200 — 4 months, no interest (FLW-44@PoC AC9). */
const cardWithAmount: Debt = {
  ...card,
  cardMonthlyAmount: eur("200.00"),
  termsMissing: false,
  base: {
    status: "paid",
    months: 4,
    payoffMonth: "2027-03",
    totalInterest: eur("0"),
    schedule: [],
    cappedOneOffs: [],
  },
};
const parents: Debt = {
  accountId: PARENTS,
  kind: "loan",
  name: "Позика від батьків",
  balance: eur("600.00"),
  annualRate: null,
  monthlyPayment: null,
  cardMonthlyAmount: null,
  termsMissing: true,
  base: null,
  progress: { paidPercent: 60, remainingMonths: null, plan: { status: "none", amount: null } },
  plan: null,
};

const withDebts = (debts: Debt[]) => fakeApi({ "GET /v1/debts": { status: 200, body: { debts } } });
const heading = () => screen.getByRole("heading", { level: 1 });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("BUD-19@PoC S-143 «Борги»", () => {
  it("BUD-19@PoC FR 11: «Борги» of «Планування» has the tabs «Борги · План погашення · Стратегія · Прогрес»", async () => {
    renderAt("#/planning/debts", withDebts([loan]).client);
    const nav = screen.getByRole("navigation", { name: "Основна навігація" });
    expect(within(nav).getByRole("link", { name: "Борги" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Борги", "План погашення", "Стратегія", "Прогрес"]);
    expect(screen.getByRole("tab", { name: "Борги" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Борги" })).toBeTruthy();
    expect(await screen.findByText("Автокредит")).toBeTruthy();
    expect(document.title).toBe("Willowsum · Борги");
  });

  it("BUD-19@PoC FR 11: → moves to the next tab and opens it; Home and End go to the first and the last", () => {
    renderAt("#/planning/debts", withDebts([loan]).client);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Борги" }), { key: "ArrowRight" });
    expect(window.location.hash).toBe("#/planning/debts/plan");
    expect(document.activeElement?.textContent).toBe("План погашення");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Борги" }), { key: "End" });
    expect(window.location.hash).toBe("#/planning/debts/progress");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Борги" }), { key: "ArrowLeft" });
    expect(window.location.hash).toBe("#/planning/debts/progress");
  });

  it("BUD-19@PoC AC9: «›» of the debt row opens that account's settings in «Гроші»; no «›» in the page heading", async () => {
    renderAt("#/planning/debts", withDebts([loan]).client);
    const row = (await screen.findByText("Автокредит")).closest("tr")!;
    expect(plain(within(row).getByText(/4 100,00/).textContent)).toBe("4 100,00 €");
    expect(plain(within(row).getByText(/9,9/).textContent)).toBe("9,9 %");
    expect(plain(within(row).getByText(/310,00/).textContent)).toBe("310,00 €");
    const open = within(row).getByRole("link", { name: "Відкрити рахунок «Автокредит»" });
    expect(open.getAttribute("href")).toBe(`#/money/accounts/${LOAN}/settings`);
    fireEvent.focus(open);
    expect(screen.getByRole("tooltip").textContent).toBe("Відкрити рахунок");
    expect(heading().parentElement!.querySelector("a, button")).toBeNull();
    expect(screen.queryByText(/Активи/)).toBeNull();
    window.location.hash = open.getAttribute("href")!;
    await waitFor(() => expect(heading().textContent).toBe("Налаштування рахунку"));
    expect(
      within(screen.getByRole("navigation", { name: "Хлібні крихти" })).getByText("Рахунки"),
    ).toBeTruthy();
  });

  it("BUD-19@PoC AC10: without credit cards and loans — «Боргів не додано»; «Додати рахунок» opens «Новий рахунок» with the type «Кредит»", async () => {
    renderAt("#/planning/debts", withDebts([]).client);
    expect(await screen.findByRole("heading", { name: "Боргів не додано" })).toBeTruthy();
    expect(
      screen.getByText(
        "Кредити, кредитні картки й позики — це рахунки типу «Кредит» і «Кредитна картка» в «Гроші › Рахунки»",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    const add = screen.getByRole("link", { name: "Додати рахунок" });
    expect(add.getAttribute("href")).toBe("#/money/accounts/new?type=loan");
    window.location.hash = add.getAttribute("href")!;
    // S-052 opens over «Рахунки» with «Кредит» chosen (FIN-01@PoC c2).
    const form = await screen.findByRole("dialog", { name: "Новий рахунок" });
    expect((within(form).getByRole("combobox", { name: /^Тип рахунку/ }) as HTMLSelectElement).value).toBe(
      "loan",
    );
  });

  it("BUD-19@PoC FR 1, FR 2: the terms come from the account; a debt without a rate or payment asks for them and is not calculated", async () => {
    renderAt("#/planning/debts", withDebts([loan, parents]).client);
    const row = (await screen.findByText("Позика від батьків")).closest("tr")!;
    expect(within(row).getByText("Немає ставки або платежу")).toBeTruthy();
    expect(within(row).getAllByText("—")).toHaveLength(2);
    const loanRow = screen.getByText("Автокредит").closest("tr")!;
    expect(plain(within(loanRow).getByText(/через/).textContent)).toBe("через 15 міс.");
    expect(within(loanRow).getByText(/лют\. 2028/)).toBeTruthy();
    const summary = screen.getByRole("region", { name: "Підсумок боргів" });
    expect(within(summary).getByText("Боргів").nextElementSibling?.textContent).toBe("2");
    expect(within(summary).getByText(/лютий 2028/)).toBeTruthy();
    expect(plain(within(summary).getByText(/крім/).textContent)).toBe(
      "через 15 міс. · крім: Позика від батьків",
    );
  });

  it("BUD-19@PoC FR 3: a debt whose payment does not cover the monthly interest shows no date — «За цих умов борг не зменшується»", async () => {
    renderAt("#/planning/debts", withDebts([stuckLoan]).client);
    const note = await screen.findByText("«Універсальна»: за цих умов борг не зменшується.");
    expect(note.closest('[role="note"]')).toBeTruthy();
    const row = screen.getAllByText("Універсальна")[0]!.closest("tr")!;
    expect(within(row).getByText("Борг не зменшується")).toBeTruthy();
    expect(within(row).queryByText(/через/)).toBeNull();
    expect(screen.getByRole("link", { name: "План погашення" }).getAttribute("href")).toBe(
      "#/planning/debts/plan",
    );
  });

  it("FLW-44@PoC FR 1, AC8: a credit card without «Зменшувати на … / міс.» shows its balance and the hint to enter it — no rate, payment, end date or «не зменшується» note", async () => {
    renderAt("#/planning/debts", withDebts([loan, card]).client);
    const row = (await screen.findByText("Універсальна")).closest("tr")!;
    expect(within(row).getByText("800,00 €")).toBeTruthy();
    expect(within(row).queryByText(/%/)).toBeNull();
    expect(within(row).queryByText(/через|Борг не зменшується|Немає ставки/)).toBeNull();
    const hint = within(row).getByRole("link", { name: "Вкажіть, скільки щомісяця гасите з картки" });
    expect(hint.getAttribute("href")).toBe("#/planning/debts/plan");
    expect(screen.queryByText(/Універсальна»: за цих умов/)).toBeNull();
    const summary = screen.getByRole("region", { name: "Підсумок боргів" });
    expect(within(summary).getByText("Боргів").nextElementSibling?.textContent).toBe("2");
    // Рішення ведучого (2026-11-27; власник не схвалював; FLW-44 code): the card without the amount is not in the
    // debt-free date, so the summary names it after «крім».
    expect(plain(within(summary).getByText(/крім/).textContent)).toContain("крім: Універсальна");
    // The loan beside it keeps every column.
    expect(within(screen.getByText("Автокредит").closest("tr")!).getByText(/через/)).toBeTruthy();
  });

  it("FLW-44@PoC AC9, FR 1: a card of 800 € with 200 € a month shows the amount and its end date in 4 months; still no rate", async () => {
    renderAt("#/planning/debts", withDebts([loan, cardWithAmount]).client);
    const row = (await screen.findByText("Універсальна")).closest("tr")!;
    expect(within(row).getByText("200,00 €")).toBeTruthy();
    expect(row.querySelector('[data-label="Ставка"]')?.textContent).toBe("—");
    expect(plain(within(row).getByText(/через/).textContent)).toBe("через 4 міс.");
    expect(within(row).getByText(/березень 2027|бер/)).toBeTruthy();
    const summary = screen.getByRole("region", { name: "Підсумок боргів" });
    expect(within(summary).queryByText(/крім/)).toBeNull();
  });

  it("BUD-19@PoC FR 10: the result is marked «Розрахунок за введеними даними, не фінансова порада»", async () => {
    renderAt("#/planning/debts", withDebts([loan]).client);
    const disclaimer = await screen.findByText("Розрахунок за введеними даними, не фінансова порада.");
    expect(disclaimer.closest('[role="note"]')).toBeTruthy();
  });

  it("loading: the skeleton under the tabs; error: «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …»", async () => {
    let fail = true;
    const { client } = fakeApi({
      "GET /v1/debts": () => (fail ? problem(500, "INTERNAL") : { status: 200, body: { debts: [loan] } }),
    });
    renderAt("#/planning/debts", client);
    expect(document.querySelector(".ws-skeleton")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("✕ Помилка")).toBeTruthy();
    expect(within(alert).getByText("Не вдалося завантажити борги.")).toBeTruthy();
    expect(within(alert).getByText(`Код: ${SUPPORT_ID}`)).toBeTruthy();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText("Автокредит")).toBeTruthy();
  });

  it("the function switched off for the space (flag debts.payoff: 404) keeps the page's plain empty state", async () => {
    renderAt("#/planning/debts", fakeApi({ "GET /v1/debts": problem(404, "NOT_FOUND") }).client);
    expect(await screen.findByRole("heading", { name: "Тут поки нічого немає" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("BUD-19@PoC S-146 «Прогрес»", () => {
  it("BUD-19@PoC AC8: «Погашено N %» and «Залишилось N міс.» are shown; there is no «Поділитися»", async () => {
    renderAt("#/planning/debts/progress", withDebts([loan, card]).client);
    expect(heading().textContent).toBe("Прогрес");
    expect(screen.getByRole("tab", { name: "Прогрес" }).getAttribute("aria-selected")).toBe("true");
    expect(plain((await screen.findByText(/^Залишилось\s\d/)).textContent)).toBe("Залишилось 15 міс.");
    const bar = screen.getByRole("progressbar", { name: "Погашено: Автокредит" });
    expect(bar.getAttribute("aria-valuenow")).toBe("34");
    expect(screen.getByRole("columnheader", { name: "Погашено" })).toBeTruthy();
    expect(plain(screen.getByText(/^34/).textContent)).toBe("34 %");
    expect(screen.queryByRole("button", { name: /Поділитися/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Поділитися/ })).toBeNull();
  });

  it("BUD-19@PoC FR 7: «Погашено» is a bar, not a ring; «План» — ahead, on plan, behind, or the badge «Плану немає»", async () => {
    const onTrack: Debt = {
      ...loan,
      accountId: PARENTS,
      name: "Іпотека",
      progress: { paidPercent: 24, remainingMonths: 119, plan: { status: "on-track", amount: null } },
    };
    const none: Debt = { ...parents, accountId: "3c4d5e6f-7a8b-4c3d-9e4f-5a6b7c8d9e0f" };
    renderAt("#/planning/debts/progress", withDebts([loan, card, onTrack, none]).client);
    const ahead = await screen.findByText(/Випереджає план/);
    expect(plain(ahead.textContent)).toBe("▲ Випереджає план · 80,00 €");
    expect(ahead.className).toBe("debts-plan--better");
    const behind = screen.getByText(/Відстає від плану/);
    expect(plain(behind.textContent)).toBe("▼ Відстає від плану · 15,50 €");
    expect(behind.className).toBe("debts-plan--worse");
    expect(screen.getByText("— За планом")).toBeTruthy();
    expect(screen.getByText("Плану немає").className).toContain("debts-badge");
    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    expect(plain(screen.getByText(/^Залишилось\s\d/).textContent)).toBe("Залишилось 119 міс.");
  });

  it("BUD-19@PoC FR 8: no sharing of the progress as an image", async () => {
    renderAt("#/planning/debts/progress", withDebts([loan]).client);
    await screen.findByText(/^Залишилось\s\d/);
    expect(screen.queryByText(/Поділитися|зображенням/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Завантажити|Поділитися/ })).toBeNull();
  });

  it("BUD-19@PoC FR 10: «Прогрес» is marked as a calculation from the data entered, not advice", async () => {
    renderAt("#/planning/debts/progress", withDebts([loan]).client);
    expect(await screen.findByText("Розрахунок за введеними даними, не фінансова порада.")).toBeTruthy();
  });
});

/**
 * BUD-19@PoC b) part 2 — «План погашення» (S-144) and «Стратегія» (S-145) on `POST /v1/debts/{id}/scenario`, `PUT
 * /v1/debts/{id}/plan` and `POST /v1/debts/strategy` (boards PocPlanDebtPlan, PocPlanDebtPlanGrows,
 * PocPlanDebtStrategy). The screen is rendered alone, without the whole App. Every figure comes from the fake server:
 * the browser calculates nothing.
 */
const VISA = "3c4d5e6f-7a8b-4c3d-9e4f-5a6b7c8d9e0f";
const MASTER = "4d5e6f7a-8b9c-4d4e-8f5a-6b7c8d9e0f1a";
const GBP_LOAN = "5e6f7a8b-9c0d-4e5f-9a6b-7c8d9e0f1a2b";
const at = (balance: string) => ({ amount: balance, currency: "EUR" });
const calc = (
  months: number,
  month: string,
  interest: string,
  schedule: [string, string][] = [
    ["2027-01", "4750.00"],
    ["2027-02", "4400.00"],
  ],
) => ({
  status: "paid" as const,
  months,
  payoffMonth: month,
  totalInterest: at(interest),
  schedule: schedule.map(([m, b]) => ({ month: m, balance: at(b) })),
  cappedOneOffs: [] as string[],
});
const stuck = {
  status: "not-decreasing" as const,
  months: null,
  payoffMonth: null,
  totalInterest: null,
  schedule: [],
  cappedOneOffs: [] as string[],
};
// Rated loans (BUD-19 AC1, AC3 after #733: «Visa Loan», «Mastercard Loan»).
const visa: Debt = {
  ...loan,
  accountId: VISA,
  kind: "loan",
  name: "Visa Loan",
  balance: at("5000.00"),
  annualRate: "24",
  monthlyPayment: at("250.00"),
  base: calc(26, "2029-01", "1449.37"),
  plan: null,
};
const master: Debt = {
  ...visa,
  accountId: MASTER,
  name: "Mastercard Loan",
  balance: at("1500.00"),
  annualRate: "18",
  monthlyPayment: at("40.00"),
};
const renderTab = (tab: "plan" | "strategy", client: ReturnType<typeof fakeApi>["client"]) =>
  render(
    <AuthApiProvider value={client}>
      <DebtsScreen tab={tab} />
    </AuthApiProvider>,
  );
const scenarioPath = (id: string) => `POST /v1/debts/${id}/scenario`;
const planApi = (over: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({
    "GET /v1/debts": { status: 200, body: { debts: [visa] } },
    [scenarioPath(VISA)]: { status: 200, body: { base: visa.base, scenario: visa.base, saving: null } },
    ...over,
  });
const field = (name: RegExp) => screen.getByRole("textbox", { name });

describe("BUD-19@PoC S-144 «План погашення»", () => {
  it("BUD-19@PoC AC1: «Visa Loan» 5 000 € at 24 % and 250 € — «Погашення через 26 міс.», the month, «Відсотки за весь строк», marked as a calculation", async () => {
    const api = planApi();
    renderTab("plan", api.client);
    expect(await screen.findByText("Погашення через 26 міс.")).toBeTruthy();
    expect(plain(screen.getByText(/січень 2029/).textContent)).toContain("відсотки за весь строк 1 449,37 €");
    expect(field(/Залишок/).getAttribute("value")).toMatch(/5.000,00/);
    expect(field(/Ставка річних/).getAttribute("value")).toBe("24");
    expect(field(/Регулярний платіж/).getAttribute("value")).toMatch(/250,00/);
    expect(screen.getByText("Розрахунок за введеними даними, не фінансова порада.")).toBeTruthy();
    // The debt's own data is sent as it is: no override.
    expect(api.calls.find((c) => c.path === `/v1/debts/${VISA}/scenario`)?.body).toEqual({});
  });

  it("BUD-19@PoC FR 1: the debt has «Додатковий платіж / міс.», «Додати разовий платіж», «Як рахуємо» and the link to the account's settings", async () => {
    renderTab("plan", planApi().client);
    await screen.findByText("Погашення через 26 міс.");
    expect(field(/Додатковий платіж/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Додати разовий платіж" })).toBeTruthy();
    const how = screen.getByRole("button", { name: "Як рахуємо" });
    expect(how.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(how);
    expect(screen.getByText(/залишок × ставка річних ÷ 12/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Налаштування рахунку" }).getAttribute("href")).toBe(
      `#/money/accounts/${VISA}/settings`,
    );
  });

  it("BUD-19@PoC AC2: an extra 100 € / month asks the server for the scenario; «На 9 міс. раніше, економія на відсотках 502,38 €» and both lines on the chart", async () => {
    const api = planApi({
      [scenarioPath(VISA)]: (call: { body?: unknown }) => ({
        status: 200,
        body:
          call.body && "extraMonthly" in (call.body as object)
            ? {
                base: visa.base,
                scenario: calc(17, "2028-04", "946.99", [["2027-01", "4650.00"]]),
                saving: { months: 9, interest: at("502.38") },
              }
            : { base: visa.base, scenario: visa.base, saving: null },
      }),
    });
    renderTab("plan", api.client);
    await screen.findByText("Погашення через 26 міс.");
    fireEvent.change(field(/Додатковий платіж/), { target: { value: "100" } });
    expect(await screen.findByText("Погашення через 17 міс.")).toBeTruthy();
    expect(plain(screen.getByText(/відсотки за весь строк 946,99/).textContent)).toContain("946,99 €");
    expect(plain(screen.getByText(/На 9 міс. раніше/).textContent)).toBe(
      "На 9 міс. раніше, економія на відсотках 502,38 €",
    );
    expect(api.calls.filter((c) => c.path === `/v1/debts/${VISA}/scenario`).at(-1)?.body).toEqual({
      extraMonthly: "100.00",
    });
    const chart = screen.getByRole("img", { name: /Графік залишку боргу/ });
    expect(chart.querySelectorAll("path")).toHaveLength(2);
    expect(api.calls.some((c) => c.method === "PUT" || c.method === "PATCH")).toBe(false);
  });

  it("BUD-19@PoC EC5: a one-off payment is sent as a month and a decimal string; a one-off above the balance is capped with a hint", async () => {
    const api = planApi({
      [scenarioPath(VISA)]: {
        status: 200,
        body: {
          base: visa.base,
          scenario: { ...calc(20, "2028-09", "1000.00"), cappedOneOffs: ["5000.00"] },
          saving: { months: 6, interest: at("449.37") },
        },
      },
    });
    renderTab("plan", api.client);
    await screen.findByText("Погашення через 26 міс.");
    fireEvent.click(screen.getByRole("button", { name: "Додати разовий платіж" }));
    fireEvent.change(screen.getByLabelText("Місяць разового платежу"), { target: { value: "2027-06-01" } });
    fireEvent.change(field(/Сума разового платежу/), { target: { value: "9000" } });
    await screen.findByText("Погашення через 20 міс.");
    expect(api.calls.filter((c) => c.path === `/v1/debts/${VISA}/scenario`).at(-1)?.body).toEqual({
      oneOffs: [{ month: "2027-06", amount: "9000.00" }],
    });
    expect(screen.getByText("Разовий платіж більший за залишок — враховано лише залишок.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Прибрати разовий платіж" }));
    expect(screen.queryByLabelText("Місяць разового платежу")).toBeNull();
  });

  it("BUD-19@PoC AC4: a payment below the monthly interest shows no date — «За цих умов борг не зменшується»", async () => {
    const api = planApi({
      [scenarioPath(VISA)]: { status: 200, body: { base: stuck, scenario: stuck, saving: null } },
    });
    renderTab("plan", api.client);
    expect(await screen.findByText("За цих умов борг не зменшується")).toBeTruthy();
    expect(screen.queryByText(/Погашення через/)).toBeNull();
    expect(screen.getByText("Графіка немає: за цих умов борг не зменшується")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Зберегти план" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("BUD-19@PoC EC1: a payment that does not cover the monthly interest (90 € against 100 €) has no payoff date", async () => {
    const api = planApi({
      [scenarioPath(VISA)]: { status: 200, body: { base: stuck, scenario: stuck, saving: null } },
    });
    renderTab("plan", api.client);
    expect(await screen.findByText("За цих умов борг не зменшується")).toBeTruthy();
    expect(screen.queryByText(/Погашення через/)).toBeNull();
    expect(screen.queryByText(/2029|2028/)).toBeNull();
  });

  it("BUD-19@PoC FR 2: a debt without a rate or a payment asks for both; nothing is calculated until both are there", async () => {
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [parents] } },
      [scenarioPath(PARENTS)]: {
        status: 200,
        body: { base: stuck, scenario: calc(20, "2028-09", "700.00"), saving: null },
      },
    });
    renderTab("plan", api.client);
    expect(await screen.findByText("Вкажіть ставку і платіж, щоб розрахувати план")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(field(/Ставка річних/), { target: { value: "7,5" } });
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(field(/Регулярний платіж/), { target: { value: "50" } });
    expect(await screen.findByText("Погашення через 20 міс.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({
      annualRate: "7.5",
      monthlyPayment: "50.00",
    });
    expect(screen.queryByText("Вкажіть ставку і платіж, щоб розрахувати план")).toBeNull();
  });

  it("BUD-19@PoC FR 2: a rate outside 0–100 is refused in the field and not sent", async () => {
    const api = planApi();
    renderTab("plan", api.client);
    await screen.findByText("Погашення через 26 міс.");
    const before = api.calls.length;
    fireEvent.change(field(/Ставка річних/), { target: { value: "120" } });
    expect(screen.getByText(/Введіть ставку від 0 до 100/)).toBeTruthy();
    expect(api.calls.length).toBe(before);
  });

  it("BUD-19@PoC AC6: «Зберегти план» with a 20 % rate saves the assumption and «Додати до запланованих витрат»; the debt's own data is not written", async () => {
    const api = planApi({
      [`PUT /v1/debts/${VISA}/plan`]: { status: 200, body: {} },
    });
    renderTab("plan", api.client);
    await screen.findByText("Погашення через 26 міс.");
    const planned = screen.getByRole("checkbox", { name: /Додати до запланованих витрат/ });
    expect((planned as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(field(/Ставка річних/), { target: { value: "20" } });
    fireEvent.change(field(/Додатковий платіж/), { target: { value: "100" } });
    await waitFor(() => expect((planned as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(planned);
    const gets = api.calls.filter((c) => c.method === "GET").length;
    await waitFor(() => expect(screen.getByRole("button", { name: "Зберегти план" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Зберегти план" }));
    expect(await screen.findByText("План збережено")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({
      annualRate: "20",
      extraMonthly: "100.00",
      addToPlannedExpenses: true,
    });
    // The debts are read again for «Збережений план»; nothing else is written (the account's rate stays 24 %).
    await waitFor(() => expect(api.calls.filter((c) => c.method === "GET").length).toBeGreaterThan(gets));
    expect(api.calls.filter((c) => c.method !== "GET" && c.method !== "POST" && c.method !== "PUT")).toEqual(
      [],
    );
  });

  it("BUD-19@PoC FR 5: a plan that fails to save says «Не вдалося зберегти план — повторіть спробу»", async () => {
    const api = planApi({ [`PUT /v1/debts/${VISA}/plan`]: problem(500, "INTERNAL") });
    renderTab("plan", api.client);
    await screen.findByText("Погашення через 26 міс.");
    fireEvent.click(screen.getByRole("button", { name: "Зберегти план" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Не вдалося зберегти план — повторіть спробу",
    );
    // FR 5: without an extra payment there is nothing to add to the planned expenses.
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ addToPlannedExpenses: false });
  });

  it("BUD-19@PoC FR 2: a saved plan fills the fields with its assumptions and is marked «Збережений план»", async () => {
    const saved: Debt = {
      ...visa,
      plan: {
        id: "6f7a8b9c-0d1e-4f6a-8b7c-8d9e0f1a2b3c",
        addToPlannedExpenses: true,
        annualRate: "20",
        balance: at("5000.00"),
        extraMonthly: at("100.00"),
        monthlyPayment: at("250.00"),
        months: 16,
        oneOffs: [],
        payoffMonth: "2028-03",
        startMonth: "2026-11",
        totalInterest: at("800.00"),
        version: 1,
      },
    };
    const api = planApi({ "GET /v1/debts": { status: 200, body: { debts: [saved] } } });
    renderTab("plan", api.client);
    expect(await screen.findByText("Збережений план")).toBeTruthy();
    expect(field(/Ставка річних/).getAttribute("value")).toBe("20");
    expect(field(/Додатковий платіж/).getAttribute("value")).toMatch(/100,00/);
    // The scenario request goes out from an effect after the plan renders and the fake records it a tick later.
    await waitFor(() => expect(api.calls.some((c) => c.path === `/v1/debts/${VISA}/scenario`)).toBe(true));
    expect(api.calls.find((c) => c.path === `/v1/debts/${VISA}/scenario`)?.body).toEqual({
      annualRate: "20",
      extraMonthly: "100.00",
    });
  });

  it("BUD-19@PoC AC11: the chart's view button is inactive with the tooltip and the name «Вигляд: Лінії»; no view menu opens", async () => {
    renderTab("plan", planApi().client);
    await screen.findByText("Погашення через 26 міс.");
    const view = screen.getByRole("button", { name: "Вигляд: Лінії" });
    expect(view.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(view);
    expect(screen.getByRole("tooltip").textContent).toBe("Вигляд: Лінії");
    fireEvent.click(view);
    fireEvent.keyDown(view, { key: "Enter" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.getAttribute("aria-expanded")).toBeNull();
  });

  it("BUD-19@PoC FR 10: the text alternative of the chart is the table of the balance by month", async () => {
    renderTab("plan", planApi().client);
    await screen.findByText("Погашення через 26 міс.");
    const table = within(screen.getByText("Таблиця залишку за місяцями").closest("details")!).getByRole(
      "table",
    );
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(plain(rows[1]!.textContent)).toContain("4 750,00 €");
  });

  it("BUD-19@PoC FR 4: a recalculation shows an indicator on the chart; a failed one says so and «Спробувати ще раз» asks again", async () => {
    let attempts = 0;
    const api = planApi({
      [scenarioPath(VISA)]: () => {
        attempts += 1;
        return attempts === 1
          ? { status: 200, body: { base: visa.base, scenario: visa.base, saving: null } }
          : attempts === 2
            ? problem(500, "INTERNAL")
            : {
                status: 200,
                body: { base: visa.base, scenario: calc(17, "2028-04", "946.99"), saving: null },
              };
      },
    });
    renderTab("plan", api.client);
    await screen.findByText("Погашення через 26 міс.");
    fireEvent.change(field(/Додатковий платіж/), { target: { value: "100" } });
    expect(screen.getByText("Перераховуємо…")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("Не вдалося розрахувати сценарій");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText("Погашення через 17 міс.")).toBeTruthy();
  });

  it("BUD-19@PoC EC6: a calculation over 1200 months stops with «Розрахунок перевищує 100 років — збільште платіж»", async () => {
    const over = { ...stuck, status: "over-limit" as const };
    const api = planApi({
      [scenarioPath(VISA)]: { status: 200, body: { base: over, scenario: over, saving: null } },
    });
    renderTab("plan", api.client);
    expect(await screen.findByText("Розрахунок перевищує 100 років — збільште платіж")).toBeTruthy();
  });

  it("BUD-19@PoC FR 1: with several debts the debt is chosen from the list and shows that debt's terms", async () => {
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [visa, master] } },
      [scenarioPath(VISA)]: { status: 200, body: { base: visa.base, scenario: visa.base, saving: null } },
      [scenarioPath(MASTER)]: {
        status: 200,
        body: { base: calc(40, "2030-03", "900.00"), scenario: calc(40, "2030-03", "900.00"), saving: null },
      },
    });
    renderTab("plan", api.client);
    await screen.findByText("Погашення через 26 міс.");
    fireEvent.change(screen.getByRole("combobox", { name: "Борг" }), { target: { value: MASTER } });
    expect(await screen.findByText("Погашення через 40 міс.")).toBeTruthy();
    expect(field(/Ставка річних/).getAttribute("value")).toBe("18");
  });
});

describe("BUD-19@PoC S-145 «Стратегія»", () => {
  const strategy = {
    avalanche: {
      status: "paid",
      months: 24,
      payoffMonth: "2028-11",
      totalInterest: at("1581.51"),
      debts: [
        { accountId: MASTER, months: 13, payoffMonth: "2027-12" },
        { accountId: VISA, months: 24, payoffMonth: "2028-11" },
      ],
    },
    snowball: {
      status: "paid",
      months: 25,
      payoffMonth: "2028-12",
      totalInterest: at("1728.57"),
      debts: [
        { accountId: MASTER, months: 9, payoffMonth: "2027-08" },
        { accountId: VISA, months: 25, payoffMonth: "2028-12" },
      ],
    },
    excluded: [{ accountId: PARENTS, reason: "terms-missing" }],
    included: [VISA, MASTER],
  };
  // Loans without a payment of their own: the minimum is entered on the screen (FR 2).
  const v100: Debt = { ...visa, monthlyPayment: null };
  const m40: Debt = { ...master, monthlyPayment: null };
  const minimum = (name: string) =>
    screen.findByRole("textbox", { name: new RegExp(`Мін. платіж: ${name}`) });
  const typeMinimum = async (name: string, value: string) =>
    fireEvent.change(await minimum(name), { target: { value } });
  const enterMinimums = async (api: ReturnType<typeof strategyApi>) => {
    renderTab("strategy", api.client);
    await typeMinimum("Visa", "100");
    await typeMinimum("Mastercard", "40");
  };
  const strategyApi = (debts: Debt[] = [v100, m40, parents]) =>
    fakeApi({
      "GET /v1/debts": { status: 200, body: { debts } },
      "POST /v1/debts/strategy": { status: 200, body: strategy },
    });

  it("BUD-19@PoC FR 6: «Усього на борги / міс.» starts at the sum of the entered minimum payments, the rest goes to one debt; the minimums reach the request as decimal strings", async () => {
    const api = strategyApi();
    await enterMinimums(api);
    const total = await screen.findByRole("textbox", { name: /Усього на борги/ });
    expect(total.getAttribute("value")).toMatch(/140,00/);
    expect(plain(screen.getByText(/мінімальні платежі 140/).textContent)).toBe(
      "мінімальні платежі 140,00 € · решта 0,00 € — на один борг за стратегією",
    );
    await waitFor(() => expect(api.calls.some((c) => c.path === "/v1/debts/strategy")).toBe(true));
    expect(api.calls.filter((c) => c.path === "/v1/debts/strategy").at(-1)?.body).toEqual({
      total: { amount: "140", currency: "EUR" },
      debts: [
        { accountId: VISA, minimumPayment: "100.00" },
        { accountId: MASTER, minimumPayment: "40.00" },
      ],
    });
  });

  it("BUD-19@PoC AC3: 340 € for the two loans — Avalanche 24 міс. / 1 581,51 €, Snowball 25 міс. / 1 728,57 €; the difference 147,06 € is neutral, with no «рекомендовано»", async () => {
    const api = strategyApi();
    await enterMinimums(api);
    fireEvent.change(await screen.findByRole("textbox", { name: /Усього на борги/ }), {
      target: { value: "340" },
    });
    expect(await screen.findByText("Усі борги погашено за 24 міс.")).toBeTruthy();
    expect(screen.getByText("Усі борги погашено за 25 міс.")).toBeTruthy();
    expect(plain(screen.getByText(/відсотки 1 581,51/).textContent)).toBe(
      "листопад 2028 р. · відсотки 1 581,51 €",
    );
    expect(plain(screen.getByText(/відсотки 1 728,57/).textContent)).toContain("1 728,57 €");
    expect(plain(screen.getByText(/різниця у відсотках/).textContent)).toBe(
      "Avalanche — 24 міс., Snowball — 25 міс.; різниця у відсотках — 147,06 €.",
    );
    expect(screen.queryByText(/рекомендова/i)).toBeNull();
    expect(api.calls.filter((c) => c.path === "/v1/debts/strategy").at(-1)?.body).toMatchObject({
      total: { amount: "340", currency: "EUR" },
    });
  });

  it("BUD-19@PoC FR 6: the switch «Avalanche» / «Snowball» shows the payoff order of the chosen strategy; Mastercard closes earlier under Snowball", async () => {
    await enterMinimums(strategyApi());
    await screen.findByText("Усі борги погашено за 24 міс.");
    const rowsOf = () =>
      within(screen.getByRole("heading", { name: /Порядок погашення/ }).closest("section")!)
        .getAllByRole("row")
        .slice(1)
        .map((r) => plain(r.textContent));
    expect(screen.getByRole("heading", { name: "Порядок погашення · Avalanche" })).toBeTruthy();
    expect(rowsOf()[0]).toContain("Mastercard Loan");
    expect(rowsOf()[0]).toContain("через 13 міс.");
    fireEvent.click(screen.getByRole("radio", { name: /Snowball/ }));
    expect(screen.getByRole("heading", { name: "Порядок погашення · Snowball" })).toBeTruthy();
    expect(rowsOf()[0]).toContain("через 9 міс.");
    expect((screen.getByRole("radio", { name: /Snowball/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("BUD-19@PoC FR 2: a debt without a minimum payment is asked for it and takes no part until it is entered; the debt the server leaves out says why", async () => {
    const api = strategyApi();
    renderTab("strategy", api.client);
    expect(await screen.findByText(/Вкажіть мінімальний платіж і ставку/)).toBeTruthy();
    expect(await minimum("Visa")).toBeTruthy();
    expect(screen.getByText("Немає боргів зі ставкою і платежем для розрахунку")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    await typeMinimum("Visa", "100");
    await waitFor(() => expect(api.calls.some((c) => c.path === "/v1/debts/strategy")).toBe(true));
    expect(api.calls.find((c) => c.path === "/v1/debts/strategy")?.body).toEqual({
      total: { amount: "100", currency: "EUR" },
      debts: [{ accountId: VISA, minimumPayment: "100.00" }],
    });
    const row = await screen.findByRole("row", { name: /Позика від батьків/ });
    expect(plain(row.textContent)).toContain("не бере участі в розрахунку · Немає ставки або платежу");
  });

  it("BUD-19@PoC EC2: a debt without a rate is asked for the rate too and sends it as a decimal string", async () => {
    const api = strategyApi([{ ...v100, annualRate: null }]);
    renderTab("strategy", api.client);
    await typeMinimum("Visa", "100");
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /Ставка річних, %: Visa/ }), {
      target: { value: "24" },
    });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/v1/debts/strategy")).toBe(true));
    expect(api.calls.find((c) => c.path === "/v1/debts/strategy")?.body).toEqual({
      total: { amount: "100", currency: "EUR" },
      debts: [{ accountId: VISA, minimumPayment: "100.00", annualRate: "24" }],
    });
  });

  it("BUD-19@PoC FR 6: a total below the minimum payments is refused in the field and nothing is calculated", async () => {
    const api = strategyApi();
    await enterMinimums(api);
    const total = await screen.findByRole("textbox", { name: /Усього на борги/ });
    await screen.findByText("Усі борги погашено за 24 міс.");
    const before = api.calls.length;
    fireEvent.change(total, { target: { value: "100" } });
    expect(plain(screen.getByText(/Сума менша за мінімальні платежі/).textContent)).toContain("140,00 €");
    expect(api.calls.length).toBe(before);
  });

  it("BUD-19@PoC FR 6: debts in two currencies are never added: the total counts one currency, chosen in «Валюта»", async () => {
    const gbp: Debt = {
      ...visa,
      accountId: GBP_LOAN,
      name: "Barclays",
      balance: { amount: "900.00", currency: "GBP" },
      monthlyPayment: { amount: "60", currency: "GBP" },
    };
    const api = strategyApi([v100, { ...gbp, monthlyPayment: { amount: "60.00", currency: "GBP" } }]);
    renderTab("strategy", api.client);
    await typeMinimum("Visa", "100");
    const total = await screen.findByRole("textbox", { name: /Усього на борги/ });
    expect(total.getAttribute("value")).toMatch(/100,00/);
    fireEvent.change(screen.getByRole("combobox", { name: "Валюта" }), { target: { value: "GBP" } });
    expect(screen.getByRole("textbox", { name: /Усього на борги/ }).getAttribute("value")).toMatch(/60,00/);
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === "/v1/debts/strategy").at(-1)?.body).toEqual({
        total: { amount: "60", currency: "GBP" },
      }),
    );
  });

  it("BUD-19@PoC FR 10: «Стратегія» is marked as a calculation from the data entered, not advice", async () => {
    renderTab("strategy", strategyApi().client);
    expect(await screen.findByText("Розрахунок за введеними даними, не фінансова порада.")).toBeTruthy();
  });

  it("BUD-19@PoC FR 6: a strategy that fails to calculate says so and «Спробувати ще раз» asks again", async () => {
    let n = 0;
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [{ ...v100, monthlyPayment: at("100.00") }] } },
      "POST /v1/debts/strategy": () =>
        ++n === 1 ? problem(500, "INTERNAL") : { status: 200, body: strategy },
    });
    renderTab("strategy", api.client);
    expect((await screen.findByRole("alert")).textContent).toContain("Не вдалося розрахувати стратегії");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByText("Усі борги погашено за 24 міс.")).toBeTruthy();
  });
});

/**
 * FLW-44@PoC / BUD-19@PoC: a credit card in «План погашення» and «Стратегія» with the user's «Зменшувати на … / міс.»
 * (owner decision 2026-11-27). Texts «Зменшувати на … / міс.» and «Вкажіть, скільки щомісяця гасите з картки» —
 * варіант від агента, потребує погодження (canvas PocPlanDebtsTexts).
 */
describe("FLW-44@PoC a credit card with «Зменшувати на … / міс.»", () => {
  const noInterest = calc(4, "2027-03", "0", [
    ["2026-12", "600.00"],
    ["2027-01", "400.00"],
    ["2027-02", "200.00"],
    ["2027-03", "0"],
  ]);

  it("BUD-19@PoC AC5, FLW-44@PoC AC8: a card without the amount asks for it — no rate and no regular payment field; nothing is calculated until it is entered", async () => {
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [card] } },
      [scenarioPath(CARD)]: { status: 200, body: { base: noInterest, scenario: noInterest, saving: null } },
    });
    renderTab("plan", api.client);
    // The prompt in place of the result and the field's hint.
    expect(await screen.findAllByText("Вкажіть, скільки щомісяця гасите з картки")).toHaveLength(2);
    const amount = field(/Зменшувати на … \/ міс\./);
    expect(amount.getAttribute("value")).toBe("");
    expect(field(/Залишок/).getAttribute("value")).toMatch(/800,00/);
    expect(screen.queryByRole("textbox", { name: /Ставка річних/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Регулярний платіж/ })).toBeNull();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(amount, { target: { value: "200" } });
    expect(await screen.findByText("Погашення через 4 міс.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ monthlyPayment: "200.00" });
  });

  it("FLW-44@PoC AC9: 800 € at 200 € a month — «Погашення через 4 міс.», no interest; «Зберегти план» keeps the amount as the card's plan setting", async () => {
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [card] } },
      [scenarioPath(CARD)]: { status: 200, body: { base: noInterest, scenario: noInterest, saving: null } },
      [`PUT /v1/debts/${CARD}/plan`]: { status: 200, body: {} },
    });
    renderTab("plan", api.client);
    fireEvent.change(await screen.findByRole("textbox", { name: /Зменшувати на/ }), {
      target: { value: "200" },
    });
    expect(await screen.findByText("Погашення через 4 міс.")).toBeTruthy();
    expect(plain(screen.getByText(/березень 2027/).textContent)).toContain("відсотки за весь строк 0,00 €");
    // The amount alone is the card's base, not a scenario beside it.
    expect(screen.getAllByText(/Погашення через/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Зберегти план" }));
    expect(await screen.findByText("План збережено")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({
      monthlyPayment: "200.00",
      addToPlannedExpenses: false,
    });
  });

  it("FLW-44@PoC FR 1: a card with its saved amount starts from it and sends no override", async () => {
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [cardWithAmount] } },
      [scenarioPath(CARD)]: { status: 200, body: { base: noInterest, scenario: noInterest, saving: null } },
    });
    renderTab("plan", api.client);
    expect(await screen.findByText("Погашення через 4 міс.")).toBeTruthy();
    expect(field(/Зменшувати на/).getAttribute("value")).toMatch(/200,00/);
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({});
  });

  const both = {
    avalanche: {
      status: "paid",
      months: 30,
      payoffMonth: "2029-05",
      totalInterest: at("1100.00"),
      debts: [
        { accountId: CARD, months: 4, payoffMonth: "2027-03" },
        { accountId: VISA, months: 30, payoffMonth: "2029-05" },
      ],
    },
    snowball: {
      status: "paid",
      months: 30,
      payoffMonth: "2029-05",
      totalInterest: at("1120.00"),
      debts: [
        { accountId: CARD, months: 2, payoffMonth: "2027-01" },
        { accountId: VISA, months: 30, payoffMonth: "2029-05" },
      ],
    },
    excluded: [],
    included: [VISA, CARD],
  };
  const rated: Debt = { ...visa, monthlyPayment: at("150.00") };

  it("FLW-44@PoC AC9, FR 4: the card's 200 € is in «Усього на борги / міс.» and its end date is in the order; less than the payments — the warning, nothing calculated", async () => {
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [rated, cardWithAmount] } },
      "POST /v1/debts/strategy": { status: 200, body: both },
    });
    renderTab("strategy", api.client);
    const total = await screen.findByRole("textbox", { name: /Усього на борги/ });
    expect(total.getAttribute("value")).toMatch(/350,00/);
    // A card with its amount asks for nothing.
    expect(screen.queryByRole("textbox", { name: /Зменшувати на/ })).toBeNull();
    expect(await screen.findAllByText("Усі борги погашено за 30 міс.")).toHaveLength(2);
    expect(api.calls.find((c) => c.path === "/v1/debts/strategy")?.body).toEqual({
      total: { amount: "350", currency: "EUR" },
    });
    const cardRow = screen.getAllByText("Універсальна").at(-1)!.closest("tr")!;
    expect(plain(cardRow.textContent)).toContain("200,00 €");
    expect(plain(cardRow.textContent)).toContain("через 4 міс.");
    const before = api.calls.length;
    fireEvent.change(total, { target: { value: "300" } });
    expect(plain(screen.getByText(/Сума менша за мінімальні платежі/).textContent)).toContain("350,00 €");
    expect(api.calls.length).toBe(before);
  });

  it("FLW-44@PoC AC8, FR 4: a card without the amount takes no part; its «Зменшувати на … / міс.» entered here sends the amount only, never a rate", async () => {
    const api = fakeApi({
      "GET /v1/debts": { status: 200, body: { debts: [rated, card] } },
      "POST /v1/debts/strategy": (call: { body?: unknown }) => ({
        status: 200,
        body:
          call.body && "debts" in (call.body as object)
            ? both
            : { ...both, included: [VISA], excluded: [{ accountId: CARD, reason: "terms-missing" }] },
      }),
    });
    renderTab("strategy", api.client);
    const amount = await screen.findByRole("textbox", { name: /Зменшувати на … \/ міс\.: Універсальна/ });
    expect(screen.queryByRole("textbox", { name: /Ставка річних, %: Універсальна/ })).toBeNull();
    expect(screen.getByText("Вкажіть, скільки щомісяця гасите з картки")).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.path === "/v1/debts/strategy")).toBe(true));
    expect(api.calls.find((c) => c.path === "/v1/debts/strategy")?.body).toEqual({
      total: { amount: "150", currency: "EUR" },
    });
    const left = (await screen.findAllByText("Універсальна")).at(-1)!.closest("tr")!;
    expect(plain(left.textContent)).toContain(
      "не бере участі в розрахунку · Вкажіть, скільки щомісяця гасите з картки",
    );
    fireEvent.change(amount, { target: { value: "200" } });
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === "/v1/debts/strategy").at(-1)?.body).toEqual({
        total: { amount: "350", currency: "EUR" },
        debts: [{ accountId: CARD, minimumPayment: "200.00" }],
      }),
    );
  });
});

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, problem, renderAt, resetAuthState, SUPPORT_ID } from "../auth/testing.tsx";
import type { Debt } from "./api.ts";

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
const card: Debt = {
  accountId: CARD,
  kind: "credit-card",
  name: "Універсальна",
  balance: eur("5000.00"),
  annualRate: "24",
  monthlyPayment: eur("90.00"),
  termsMissing: false,
  base: {
    status: "not-decreasing",
    months: null,
    payoffMonth: null,
    totalInterest: null,
    schedule: [],
    cappedOneOffs: [],
  },
  progress: { paidPercent: 27, remainingMonths: null, plan: { status: "behind", amount: eur("15.50") } },
  plan: null,
};
const parents: Debt = {
  accountId: PARENTS,
  kind: "loan",
  name: "Позика від батьків",
  balance: eur("600.00"),
  annualRate: null,
  monthlyPayment: null,
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
    renderAt("#/planning/debts", withDebts([card]).client);
    const note = await screen.findByText("«Універсальна»: за цих умов борг не зменшується.");
    expect(note.closest('[role="note"]')).toBeTruthy();
    const row = screen.getAllByText("Універсальна")[0]!.closest("tr")!;
    expect(within(row).getByText("Борг не зменшується")).toBeTruthy();
    expect(within(row).queryByText(/через/)).toBeNull();
    expect(screen.getByRole("link", { name: "План погашення" }).getAttribute("href")).toBe(
      "#/planning/debts/plan",
    );
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

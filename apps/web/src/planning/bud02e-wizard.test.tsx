import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../auth/testing.tsx";
import { BudgetWizardPage } from "./budget/WizardPage.tsx";

/**
 * BUD-02@PoC e) (wave 2, row 124): the wizard S-122 «Спосіб», S-123 «Період», S-124 «Ліміти». The page alone, on the
 * budget API (`GET /v1/budget/wizard`, `GET /v1/budget`, `GET /v1/categories`, `GET /v1/space`, `POST /v1/budget`).
 * Boards: PocPlanBudgetWiz1, Wiz1NoHist, Wiz2, Wiz3, PocPlanBudgetTexts. The figures are synthetic and the server's:
 * the screen computes none of them. «Розподіл» (S-287, AC6, AC7) and the bottom strip wait for wave 2 row 31.
 */
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });
const category = (n: number, groupId: string, name: string) => ({
  id: id(n),
  groupId,
  systemKey: null,
  kind: "expense",
  name,
  renamed: false,
  icon: "tag",
  color: "#112233",
  iconTone: "white",
  essential: null,
  hidden: false,
  deletable: true,
});
const TREE = {
  groups: [
    {
      id: id(100),
      systemKey: null,
      kind: "expense",
      name: "Щоденне",
      renamed: false,
      tone: "x",
      categories: [category(1, id(100), "Продукти"), category(2, id(100), "Транспорт")],
    },
    {
      id: id(101),
      systemKey: null,
      kind: "income",
      name: "Дохід",
      renamed: false,
      tone: "x",
      categories: [{ ...category(3, id(101), "Зарплата"), kind: "income" }],
    },
  ],
};
const starts = (mid: boolean) =>
  mid
    ? [
        {
          start: "period-start",
          firstPeriod: "2026-11",
          from: "2026-11-01",
          to: "2026-11-30",
          days: null,
          daysInPeriod: null,
        },
        {
          start: "next-period",
          firstPeriod: "2026-12",
          from: "2026-12-01",
          to: "2026-12-31",
          days: null,
          daysInPeriod: null,
        },
        {
          start: "proportional",
          firstPeriod: "2026-11",
          from: "2026-11-18",
          to: "2026-11-30",
          days: 13,
          daysInPeriod: 30,
        },
      ]
    : [
        {
          start: "period-start",
          firstPeriod: "2026-11",
          from: "2026-11-01",
          to: "2026-11-30",
          days: null,
          daysInPeriod: null,
        },
      ];
const wizard = (over: { available?: boolean; months?: number; mid?: boolean } = {}) => ({
  today: over.mid === false ? "2026-11-01" : "2026-11-18",
  midPeriod: over.mid !== false,
  starts: starts(over.mid !== false),
  fromSpending: {
    available: over.available !== false,
    historyMonths: over.months ?? 7,
    incomePlan: over.available === false ? null : eur("5600.00"),
    incomeIrregular: false,
    categories:
      over.available === false
        ? []
        : [
            { categoryId: id(1), average: eur("405.00"), limit: eur("410.00") },
            { categoryId: id(2), average: eur("158.20"), limit: eur("160.00") },
          ],
  },
});

function mount(over: Record<string, Reply> = {}) {
  const api = fakeApi({
    "GET /v1/budget": { status: 200, body: { budget: null } },
    "GET /v1/budget/wizard": { status: 200, body: wizard() },
    "GET /v1/categories": { status: 200, body: TREE },
    "GET /v1/space": { status: 200, body: { name: "Дім", dataRegion: "eu", reportingCurrency: "EUR" } },
    "POST /v1/budget": { status: 201, body: { id: "b1" } },
    ...over,
  });
  render(
    <I18nProvider>
      <AuthApiProvider value={api.client}>
        <BudgetWizardPage />
      </AuthApiProvider>
    </I18nProvider>,
  );
  return api;
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  window.location.hash = "#/planning/budget/new";
});
afterEach(cleanup);

const next = () => fireEvent.click(screen.getByRole("button", { name: /Далі/ }));
const postBody = (api: ReturnType<typeof mount>) =>
  api.calls.find((c) => c.method === "POST" && c.path === "/v1/budget")?.body as {
    firstPeriod: string;
    proportional: boolean;
    incomePlan?: { amount: string; currency: string };
    limits: { categoryId: string; amount: { amount: string } }[];
  };

describe("BUD-02@PoC e) S-122 «Спосіб»", () => {
  it("BUD-02@PoC FR 2: the step offers «Створити за моїми витратами» and «Почати з нуля» with the budget currency", async () => {
    mount();
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    expect(screen.getByText("Валюта бюджету — EUR.")).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([true, false]);
    expect(screen.getByText("Створити за моїми витратами")).toBeTruthy();
    expect(screen.getByText("Почати з нуля")).toBeTruthy();
    expect(plain(document.body.textContent)).toContain("Є 7 повних місяців категоризованих транзакцій.");
    expect(plain(document.body.textContent)).toContain(
      "План доходу — середній дохід за ці місяці: 5 600,00 €",
    );
  });

  it("BUD-02@PoC EC 2: with fewer than 3 months the first option is inactive with the reason, «Почати з нуля» is chosen", async () => {
    mount({ "GET /v1/budget/wizard": { status: 200, body: wizard({ available: false, months: 2 }) } });
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0]!.disabled).toBe(true);
    expect(radios[1]!.checked).toBe(true);
    expect(plain(document.body.textContent)).toContain(
      "Потрібно щонайменше 3 місяці категоризованих транзакцій · зараз є 2 повні місяці",
    );
  });
});

describe("BUD-02@PoC e) S-123 «Період»", () => {
  it("BUD-02@PoC AC15 and EC 3: in the middle of a month three starts are shown, none chosen, and «Далі» is inactive until one is", async () => {
    mount();
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    next();
    await screen.findByRole("heading", { name: "Період бюджету" });
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, false, false]);
    expect(screen.getByText("З 1 листопада")).toBeTruthy();
    expect(screen.getByText("З наступного місяця (1 грудня)")).toBeTruthy();
    expect(screen.getByText("Пропорційно на 18–30 листопада (13/30)")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /тиждень/i })).toBeNull();
    const button = screen.getByRole("button", { name: /Далі/ });
    expect(button.getAttribute("aria-disabled") === "true" || (button as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText("Оберіть, як порахувати перший період")).toBeTruthy();
    fireEvent.click(radios[2]!);
    expect(screen.getByRole("button", { name: /Далі/ }).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("BUD-02@PoC FR 5: on the first of a month there is no choice of a start", async () => {
    mount({ "GET /v1/budget/wizard": { status: 200, body: wizard({ mid: false }) } });
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    next();
    await screen.findByRole("heading", { name: "Період бюджету" });
    expect(screen.queryAllByRole("radio").length).toBe(0);
    next();
    await screen.findByRole("heading", { name: "Ліміти категорій" });
  });
});

describe("BUD-02@PoC e) S-124 «Ліміти» and the creation", () => {
  async function toLimits(api = mount()) {
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    next();
    fireEvent.click((await screen.findAllByRole("radio"))[2]!);
    next();
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    return api;
  }

  it("BUD-02@PoC AC1: an amount that does not parse keeps «Створити бюджет» inactive and nothing is sent in its place", async () => {
    const api = await toLimits();
    const income = screen.getByRole("textbox", { name: /План доходу на місяць/ });
    fireEvent.change(income, { target: { value: "12,345" } });
    fireEvent.blur(income);
    const limit = screen.getByRole("textbox", { name: "Ліміт: Продукти" });
    fireEvent.change(limit, { target: { value: "abc" } });
    fireEvent.blur(limit);
    const create = screen.getByRole("button", { name: /Створити бюджет/ });
    expect(create.getAttribute("aria-disabled") === "true" || (create as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(plain(document.body.textContent)).toContain(
      "Щоб продовжити, виправте: План доходу на місяць, Продукти",
    );
    fireEvent.click(create);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    // Corrected: the button works again and the corrected amounts go as typed.
    fireEvent.change(income, { target: { value: "5000" } });
    fireEvent.blur(income);
    fireEvent.change(limit, { target: { value: "300" } });
    fireEvent.blur(limit);
    fireEvent.click(screen.getByRole("button", { name: "Створити бюджет" }));
    await waitFor(() => expect(postBody(api)).toBeTruthy());
    expect(postBody(api).incomePlan?.amount).toBe("5000.00");
    expect(postBody(api).limits[0]!.amount.amount).toBe("300.00");
  });

  it("BUD-02@PoC AC1: an empty income plan is not sent as 0", async () => {
    const api = await toLimits();
    const income = screen.getByRole("textbox", { name: /План доходу на місяць/ });
    fireEvent.change(income, { target: { value: "" } });
    fireEvent.blur(income);
    fireEvent.click(screen.getByRole("button", { name: "Створити бюджет" }));
    await waitFor(() => expect(postBody(api)).toBeTruthy());
    expect(postBody(api).incomePlan).toBeUndefined();
  });

  it("BUD-02@PoC AC1: «Назад» and «Далі» keep the edited limits", async () => {
    await toLimits();
    const field = screen.getByRole("textbox", { name: "Ліміт: Транспорт" });
    fireEvent.change(field, { target: { value: "170" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    next();
    expect(plain((screen.getByRole("textbox", { name: "Ліміт: Транспорт" }) as HTMLInputElement).value)).toBe(
      "170,00",
    );
  });

  it("BUD-02@PoC AC1: an invalid amount left behind by «Назад» does not keep «Створити бюджет» inactive when the step opens again", async () => {
    const api = await toLimits();
    const limit = screen.getByRole("textbox", { name: "Ліміт: Продукти" });
    fireEvent.change(limit, { target: { value: "abc" } });
    fireEvent.blur(limit);
    expect(plain(document.body.textContent)).toContain("Щоб продовжити, виправте");
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    next();
    expect(plain(document.body.textContent)).not.toContain("Щоб продовжити, виправте");
    fireEvent.click(screen.getByRole("button", { name: "Створити бюджет" }));
    await waitFor(() => expect(postBody(api)).toBeTruthy());
  });

  it("BUD-02@PoC AC1: «За моїми витратами» fills the limits and the income plan with the server's figures; they can be changed and go as decimal strings", async () => {
    const api = mount();
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    next();
    fireEvent.click((await screen.findAllByRole("radio"))[2]!);
    next();
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    expect(screen.getByText("Продукти")).toBeTruthy();
    expect(screen.queryByText("Зарплата")).toBeNull();
    expect(plain(document.body.textContent)).toContain("405,00 €");
    expect((screen.getByRole("textbox", { name: "Ліміт: Продукти" }) as HTMLInputElement).value).toBe(
      "410,00",
    );
    expect(
      plain((screen.getByRole("textbox", { name: /План доходу на місяць/ }) as HTMLInputElement).value),
    ).toBe("5 600,00");
    const field = screen.getByRole("textbox", { name: "Ліміт: Транспорт" });
    fireEvent.change(field, { target: { value: "170" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Створити бюджет" }));
    await waitFor(() => expect(postBody(api)).toBeTruthy());
    const body = postBody(api);
    expect(body.firstPeriod).toBe("2026-11");
    expect(body.proportional).toBe(true);
    expect(body.incomePlan).toEqual({ amount: "5600.00", currency: "EUR" });
    expect(body.limits.map((l) => [l.categoryId, l.amount.amount])).toEqual([
      [id(1), "410.00"],
      [id(2), "170.00"],
    ]);
  });

  it("BUD-02@PoC FR 2: «Почати з нуля» opens the limits without amounts and creates a budget without limits", async () => {
    const api = mount();
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    next();
    fireEvent.click((await screen.findAllByRole("radio"))[1]!);
    next();
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    expect((screen.getByRole("textbox", { name: "Ліміт: Продукти" }) as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Середнє 3 міс.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Створити бюджет" }));
    await waitFor(() => expect(postBody(api)).toBeTruthy());
    const body = postBody(api);
    expect(body.limits).toEqual([]);
    expect(body.proportional).toBe(false);
    expect(body.incomePlan).toBeUndefined();
  });

  it("BUD-02 e) error state: a refused creation shows the error and keeps the entered amounts", async () => {
    const api = mount({ "POST /v1/budget": problem(500, "INTERNAL") });
    await screen.findByRole("heading", { name: "Як створити бюджет?" });
    next();
    fireEvent.click((await screen.findAllByRole("radio"))[0]!);
    next();
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    fireEvent.click(screen.getByRole("button", { name: "Створити бюджет" }));
    await screen.findByText("Не вдалося створити бюджет. Спробуйте ще раз");
    expect((screen.getByRole("textbox", { name: "Ліміт: Продукти" }) as HTMLInputElement).value).toBe(
      "410,00",
    );
    expect(api.calls.filter((c) => c.method === "POST").length).toBe(1);
  });

  it("BUD-02 e) error state: a failed load shows «Не вдалося завантажити бюджет» with a retry", async () => {
    mount({ "GET /v1/budget/wizard": problem(500, "INTERNAL") });
    await screen.findByText("Не вдалося завантажити бюджет");
    expect(screen.getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
  });
});

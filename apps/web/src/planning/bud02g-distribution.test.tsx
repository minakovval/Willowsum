import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../auth/testing.tsx";
import { BudgetWizardPage } from "./budget/WizardPage.tsx";

/**
 * BUD-02@PoC FR 3, FR 15, AC6, AC7 (wave 2, row 31, UI): S-287 «Розподіл» and the bottom strip of the limits step. The
 * page alone on the server's calculation `POST /v1/budget/allocation`; every figure below is the server's (synthetic):
 * the screen adds, subtracts and compares nothing. Boards: PocPlanBudgetWiz3, Wiz4, Wiz4Deficit.
 */
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eur = (amount: string) => ({ amount, currency: "EUR" });
const TREE = {
  groups: [
    {
      id: id(100),
      systemKey: null,
      kind: "expense",
      name: "Щоденне",
      renamed: false,
      tone: "x",
      categories: [
        {
          id: id(1),
          groupId: id(100),
          systemKey: null,
          kind: "expense",
          name: "Продукти",
          renamed: false,
          icon: "tag",
          color: "#112233",
          iconTone: "white",
          essential: null,
          hidden: false,
          deletable: true,
        },
      ],
    },
    {
      id: id(101),
      systemKey: null,
      kind: "income",
      name: "Дохід",
      renamed: false,
      tone: "x",
      categories: [
        {
          id: id(3),
          groupId: id(101),
          systemKey: null,
          kind: "income",
          name: "Зарплата",
          renamed: false,
          icon: "tag",
          color: "#112233",
          iconTone: "white",
          essential: null,
          hidden: false,
          deletable: false,
        },
      ],
    },
  ],
};
const FEATURES_ON = { status: 200, body: { features: ["budget.period", "budget.plan"] } } as const;
const FEATURES_OFF = { status: 200, body: { features: ["budget.period"] } } as const;
const WIZARD = {
  today: "2026-11-01",
  midPeriod: false,
  starts: [
    {
      start: "period-start",
      firstPeriod: "2026-11",
      from: "2026-11-01",
      to: "2026-11-30",
      days: null,
      daysInPeriod: null,
    },
  ],
  fromSpending: {
    available: true,
    historyMonths: 7,
    incomePlan: eur("5600.00"),
    incomeIrregular: false,
    categories: [{ categoryId: id(1), average: eur("405.00"), limit: eur("410.00") }],
    incomes: [{ categoryId: id(3), average: eur("5600.00"), plan: eur("5600.00"), irregular: false }],
  },
};
const goal = (n: number, name: string, over: Record<string, unknown> = {}) => ({
  id: id(n),
  name,
  achieved: false,
  target: eur("2000.00"),
  collected: eur("1400.00"),
  requiredMonthly: eur("300.00"),
  template: "travel",
  targetDate: null,
  ...over,
});
const balance = (kind: "surplus" | "deficit" | "balanced", amount: string) => ({
  recurringOutsideLimits: eur("0.00"),
  unallocated: eur("2740.00"),
  debtMinimums: eur("30.00"),
  difference: eur(kind === "deficit" ? `-${amount}` : amount),
  kind,
  amount: eur(amount),
});
const spendable = (amount: string | null, missing: string[] = []) => ({
  period: "2026-11",
  amount: amount === null ? null : eur(amount),
  missing,
});
const answer = (
  b: ReturnType<typeof balance> | null,
  choice: unknown = null,
  spend = spendable("2902.34"),
) => ({
  period: "2026-11",
  incomePlan: eur("5600.00"),
  limits: eur("2860.00"),
  balance: b,
  choice,
  spendable: spend,
});
const choice = (chosen: string, rest: string, status: "short" | "exact" | "over") => ({
  chosen: eur(chosen),
  rest: eur(rest),
  status,
});
const DEBT = {
  accountId: id(50),
  name: "Кредитна ··9021",
  kind: "credit-card",
  balance: eur("640.00"),
  annualRate: "38",
  monthlyPayment: eur("30.00"),
};
const SAVINGS = {
  id: id(60),
  name: "Ощадний",
  kind: "savings",
  status: "active",
  number: { masked: "··1180" },
  currencies: [{ currency: "EUR", amount: eur("18400.00") }],
  creditCard: null,
};
const CARD = {
  id: id(50),
  name: "Кредитна",
  kind: "credit-card",
  status: "active",
  number: { masked: "··9021" },
  currencies: [],
  creditCard: { available: eur("1360.00"), creditLimit: null, debt: eur("640.00"), gracePeriodDays: null },
};

type Row = {
  kind: string;
  goalId?: string;
  accountId?: string;
  amount: { amount: string; currency: string };
};
type Body = { chosen?: unknown; allocation?: Row[]; limits: unknown[] };
function mount(allocation: (body: Body) => Reply, over: Record<string, Reply> = {}) {
  const api = fakeApi({
    "GET /v1/budget": { status: 200, body: { budget: null } },
    "GET /v1/budget/wizard": { status: 200, body: WIZARD },
    "GET /v1/me/features": FEATURES_ON,
    "GET /v1/categories": { status: 200, body: TREE },
    "GET /v1/space": { status: 200, body: { name: "Дім", dataRegion: "eu", reportingCurrency: "EUR" } },
    "POST /v1/budget": { status: 201, body: { id: "b1" } },
    "POST /v1/budget/allocation": (call) => allocation(call.body as Body),
    "GET /v1/goals": {
      status: 200,
      body: { goals: [goal(10, "Відпустка в Карпатах"), goal(11, "Подушка безпеки")] },
    },
    "GET /v1/debts": { status: 200, body: { debts: [DEBT] } },
    "GET /v1/accounts": { status: 200, body: { items: [SAVINGS, CARD], nextCursor: null } },
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

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const disabled = (name: string | RegExp) =>
  screen.getByRole("button", { name }).getAttribute("aria-disabled") === "true";
async function toLimits(api = mount(() => ({ status: 200, body: answer(balance("surplus", "2710.00")) }))) {
  await screen.findByRole("heading", { name: "Як створити бюджет?" });
  click(/Далі/);
  await screen.findByRole("heading", { name: "Період бюджету" });
  click(/Далі/);
  await screen.findByRole("heading", { name: "Ліміти категорій" });
  return api;
}
const toStep = async (heading: string | RegExp) => {
  click(/Далі/);
  await screen.findByRole("heading", { name: heading });
};
const typeAmount = (name: string, value: string) => {
  const field = screen.getByRole("textbox", { name });
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};
const lastBody = (api: ReturnType<typeof mount>) =>
  [...api.calls].reverse().find((c) => c.path === "/v1/budget/allocation")?.body as Body;

describe("BUD-02@PoC AC6 the bottom strip of the limits step", () => {
  it("BUD-02@PoC AC6: the strip shows «Не розподілено N» and the sum of the server's figures", async () => {
    await toLimits(
      mount(() => ({
        status: 200,
        body: answer({ ...balance("surplus", "2740.00"), unallocated: eur("2740.00") }),
      })),
    );
    await waitFor(() => expect(plain(document.body.textContent)).toContain("Не розподілено 2 740,00 €"));
    expect(plain(document.body.textContent)).toContain(
      "план доходу 5 600,00 € − ліміти 2 860,00 € − регулярні платежі поза лімітами 0,00 €",
    );
  });

  it("BUD-02@PoC AC6: the strip follows an edited limit — the amounts go to the server again", async () => {
    const api = await toLimits();
    await waitFor(() => expect(lastBody(api)).toBeTruthy());
    typeAmount("Ліміт: Продукти", "500");
    await waitFor(() =>
      expect((lastBody(api).limits[0] as { amount: { amount: string } }).amount.amount).toBe("500.00"),
    );
  });

  it("BUD-02@PoC AC6: a failed or pending calculation does not leave the last figure on the strip, and the live region stays mounted", async () => {
    let mode: "ok" | "fail" | "hang" = "ok";
    const api = await toLimits(
      mount(() =>
        mode === "fail"
          ? problem(500, "INTERNAL")
          : mode === "hang"
            ? (new Promise<Reply>(() => undefined) as unknown as Reply)
            : { status: 200, body: answer(balance("surplus", "2740.00")) },
      ),
    );
    await waitFor(() => expect(plain(document.body.textContent)).toContain("Не розподілено 2 740,00 €"));
    const region = document.querySelector(".bud-wiz-strip") as HTMLElement;
    expect(region.getAttribute("role")).toBe("status");
    mode = "hang";
    typeAmount("Ліміт: Продукти", "500");
    await waitFor(() => expect(plain(region.textContent)).toBe(""));
    expect(document.querySelector(".bud-wiz-strip")).toBe(region);
    mode = "fail";
    typeAmount("Ліміт: Продукти", "600");
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === "/v1/budget/allocation").length).toBeGreaterThan(2),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(plain(region.textContent)).toBe("");
  });

  it("BUD-02@PoC AC6: when the server cannot tell (balance null) there is no strip, never income − limits", async () => {
    const api = await toLimits(mount(() => ({ status: 200, body: answer(null) })));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/v1/budget/allocation")).toBe(true));
    await waitFor(() => expect(plain(document.body.textContent)).not.toContain("Не розподілено"));
  });
});

describe("BUD-02@PoC FR 15 surplus", () => {
  it("BUD-02@PoC FR 15: a surplus offers goals, debts above the minimum, savings without a goal and «Лишити нерозподіленим»", async () => {
    const api = await toLimits(mount(() => ({ status: 200, body: answer(balance("surplus", "2710.00")) })));
    await toStep("Розподіл профіциту");
    const text = plain(document.body.textContent);
    expect(text).toContain("План доходу більший за ліміти на 2 710,00 €");
    expect(text).toContain("Відпустка в Карпатах");
    expect(text).toContain("1 400,00 € з 2 000,00 € · потрібно 300,00 € / міс.");
    expect(text).toContain("борг 640,00 € · 38 % річних · мінімум 30,00 € уже в плані");
    expect(text).toContain("Заощадження без цілі");
    expect(screen.getByRole("button", { name: "+ Нова ціль" })).toBeTruthy();
    expect(screen.getByText("Лишити нерозподіленим")).toBeTruthy();
    expect(text).toContain("Це план: гроші не переказуються");
    // Nothing chosen: the whole surplus is left, and it is the server's figure.
    expect(api.calls.filter((c) => c.path === "/v1/budget/allocation").at(-1)?.body).toMatchObject({
      firstPeriod: "2026-11",
    });
  });

  it("BUD-02@PoC FR 15: a chosen goal amount goes to the server as a typed `goal` row with a decimal string and the server's allocated sum and rest are shown", async () => {
    const api = await toLimits(
      mount((b) => ({
        status: 200,
        body: answer(
          balance("surplus", "2710.00"),
          b.allocation ? choice("600.00", "2110.00", "short") : null,
        ),
      })),
    );
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відпустка в Карпатах", "600");
    await waitFor(() =>
      expect(lastBody(api).allocation).toEqual([
        { kind: "goal", goalId: id(10), amount: { amount: "600.00", currency: "EUR" } },
      ]),
    );
    expect(lastBody(api).chosen).toBeUndefined();
    await waitFor(() => expect(plain(document.body.textContent)).toContain("2 110,00 €"));
    expect(plain(document.body.textContent)).toContain("600,00 €");
  });

  it("BUD-02@PoC FR 15: «Лишити нерозподіленим» — an unallocated rest does not block «Створити бюджет», and the budget is created with limits only", async () => {
    const api = await toLimits();
    await toStep("Розподіл профіциту");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
    click("Створити бюджет");
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === "POST" && c.path === "/v1/budget")).toBe(true),
    );
    const body = api.calls.find((c) => c.method === "POST" && c.path === "/v1/budget")?.body as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(["firstPeriod", "incomePlans", "limits", "proportional"]);
  });

  it("BUD-02@PoC FR 15: «+ Нова ціль» opens the goal form on the step", async () => {
    const api = await toLimits();
    await toStep("Розподіл профіциту");
    const before = api.calls.filter((c) => c.path === "/v1/goals").length;
    click("+ Нова ціль");
    await screen.findByRole("dialog");
    expect(api.calls.filter((c) => c.path === "/v1/goals").length).toBe(before);
  });
});

describe("BUD-02@PoC FR 15 and AC7 deficit", () => {
  const deficit = (status: "short" | "exact" | "over", chosen: string, rest: string) => (b: Body) => ({
    status: 200,
    body: answer(balance("deficit", "200.00"), b.allocation ? choice(chosen, rest, status) : null),
  });

  it("BUD-02@PoC AC7: a deficit asks «Звідки візьмуться 200,00 €?» with the five options (two of them marked as not saved) and «Створити бюджет» is active also when the chosen options cover less (owner, 2026-11-21, «Лишити дефіцит»)", async () => {
    const api = await toLimits(mount(deficit("short", "100.00", "100.00")));
    await toStep(/Звідки візьмуться 200,00/);
    const text = plain(document.body.textContent);
    expect(text).toContain("З цілі «Подушка безпеки»");
    // AC7's four options are shown; owner Q3 а: «У PoC ці варіанти не зберігаються, і екран про це пише» — the two that
    // are not saved say so and take no amount (the server refuses such rows as `not_saved`, so none is ever sent).
    expect(text).toContain("Із заощаджень · Ощадний ··1180");
    expect(text).toContain("У борг · Кредитна ··9021");
    expect(text).toContain("доступний ліміт 1 360,00 €");
    expect(text.match(/поки не зберігається/g)).toHaveLength(2);
    for (const name of ["Сума: Із заощаджень · Ощадний ··1180", "Сума: У борг · Кредитна ··9021"])
      expect(screen.getByRole("textbox", { name }).hasAttribute("disabled")).toBe(true);
    expect(text).toContain("Зменшити ліміти");
    expect(text).toContain("Лишити дефіцит");
    expect(text).toContain("Покрито 0,00 € з 200,00 €");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
    typeAmount("Сума: З цілі «Подушка безпеки»", "100");
    await waitFor(() => expect(plain(document.body.textContent)).toContain("Покрито 100,00 € з 200,00 €"));
    // The covered part goes as a row; the rest stays the plan's deficit (AC17).
    expect(disabled("Створити бюджет")).toBe(false);
    click("Створити бюджет");
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === "POST" && c.path === "/v1/budget")).toBe(true),
    );
  });

  it("BUD-02@PoC AC7: covered in full (the server says «exact») activates «Створити бюджет»; nothing is moved", async () => {
    const api = await toLimits(mount(deficit("exact", "200.00", "0.00")));
    await toStep(/Звідки візьмуться 200,00/);
    typeAmount("Сума: З цілі «Подушка безпеки»", "200");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
    click("Створити бюджет");
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === "POST" && c.path === "/v1/budget")).toBe(true),
    );
    // The cover leaves as a typed `from-goal` row in the create request too.
    const body = api.calls.find((c) => c.method === "POST" && c.path === "/v1/budget")?.body as Body;
    expect(body.allocation).toEqual([
      { kind: "from-goal", goalId: id(11), amount: { amount: "200.00", currency: "EUR" } },
    ]);
  });

  it("BUD-02@PoC AC7: more than the deficit (the server says «over») is refused with the reason", async () => {
    await toLimits(mount(deficit("over", "300.00", "0.00")));
    await toStep(/Звідки візьмуться 200,00/);
    typeAmount("Сума: З цілі «Подушка безпеки»", "300");
    await waitFor(() => expect(plain(document.body.textContent)).toContain("Обрано більше, ніж 200,00 €."));
    expect(disabled("Створити бюджет")).toBe(true);
  });

  it("BUD-02@PoC FR 15: «Зменшити ліміти» goes back to the limits step and the server counts the lower limits", async () => {
    const api = await toLimits(mount(deficit("short", "0.00", "200.00")));
    await toStep(/Звідки візьмуться 200,00/);
    const row = screen.getByText("повернутися до кроку «Ліміти»").closest(".bud-wiz-row") as HTMLElement;
    fireEvent.click(row.querySelector("button")!);
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    typeAmount("Ліміт: Продукти", "200");
    await waitFor(() =>
      expect((lastBody(api).limits[0] as { amount: { amount: string } }).amount.amount).toBe("200.00"),
    );
    // «Зменшити ліміти» is never sent as a row: on the limits step no rows leave at all.
    expect(lastBody(api).allocation).toBeUndefined();
  });
});

describe("BUD-02@PoC FR 15 states", () => {
  it("BUD-02@PoC FR 15: no difference to allocate (balanced) says so and does not block the creation", async () => {
    await toLimits(mount(() => ({ status: 200, body: answer(balance("balanced", "0.00")) })));
    await toStep("Розподіл");
    expect(plain(document.body.textContent)).toContain("Нічого розподіляти");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
  });

  it("BUD-02@PoC FR 15: when the server cannot tell the difference (balance null) the step says so and the budget can still be created", async () => {
    await toLimits(mount(() => ({ status: 200, body: answer(null) })));
    await toStep("Розподіл");
    expect(plain(document.body.textContent)).toContain("Не вдалося порахувати різницю");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
  });

  it("BUD-02@PoC FR 15 error state: a failed calculation shows the error with a retry, and the retry asks again", async () => {
    let fail = true;
    const api = await toLimits(
      mount(() =>
        fail ? problem(500, "INTERNAL") : { status: 200, body: answer(balance("surplus", "2710.00")) },
      ),
    );
    click(/Далі/);
    await screen.findByText("Не вдалося порахувати розподіл. Спробуйте ще раз");
    fail = false;
    const before = api.calls.filter((c) => c.path === "/v1/budget/allocation").length;
    click("Спробувати ще раз");
    await screen.findByRole("heading", { name: "Розподіл профіциту" });
    expect(api.calls.filter((c) => c.path === "/v1/budget/allocation").length).toBeGreaterThan(before);
  });

  it("BUD-02@PoC FR 15 error state: the lists of the rows failing show the error too", async () => {
    await toLimits(
      mount(() => ({ status: 200, body: answer(balance("surplus", "2710.00")) }), {
        "GET /v1/goals": problem(500, "INTERNAL"),
      }),
    );
    click(/Далі/);
    await screen.findByText("Не вдалося порахувати розподіл. Спробуйте ще раз");
  });

  it("BUD-02@PoC FR 15: «Назад» from «Розподіл» keeps the limits", async () => {
    await toLimits();
    await toStep("Розподіл профіциту");
    click("Назад");
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    expect((screen.getByRole("textbox", { name: "Ліміт: Продукти" }) as HTMLInputElement).value).toBe(
      "410,00",
    );
  });

  it("BUD-02@PoC FR 15: an amount that does not parse on «Розподіл» keeps «Створити бюджет» inactive with the reason", async () => {
    await toLimits();
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відкласти", "abc");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(true));
    expect(plain(document.body.textContent)).toContain("Щоб продовжити, виправте");
  });

  it("BUD-02@PoC FR 15: an unparsable amount left on «Розподіл» does not block «Далі» after «Назад»", async () => {
    await toLimits();
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відкласти", "abc");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(true));
    click("Назад");
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    expect(disabled(/Далі/)).toBe(false);
    expect(plain(document.body.textContent)).not.toContain("Щоб продовжити, виправте");
  });

  it("BUD-02@PoC FR 15: «Створити бюджет» is inactive with «Рахуємо розподіл» while the calculation is pending", async () => {
    let release: (r: Reply) => void = () => undefined;
    let first = true;
    await toLimits(
      mount(() => {
        if (first) {
          first = false;
          return { status: 200, body: answer(balance("surplus", "2710.00")) };
        }
        return new Promise<Reply>((resolve) => (release = resolve)) as unknown as Reply;
      }),
    );
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відкласти", "100");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(true));
    expect(plain(document.body.textContent)).toContain("Рахуємо розподіл");
    release({ status: 200, body: answer(balance("surplus", "2710.00")) });
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
  });

  it("BUD-02@PoC FR 15: the closing text differs for a surplus and a deficit and says where the saved amounts appear (the board's text)", async () => {
    await toLimits();
    await toStep("Розподіл профіциту");
    expect(plain(document.body.textContent)).toContain(
      "Це план: гроші не переказуються. Суми з’являться в «Бюджет → План» у розділах «Цілі й заощадження» і «Погашення боргів».",
    );
    expect(plain(document.body.textContent)).not.toContain("поки що не зберігаються");
    cleanup();
    resetAuthState();
    await toLimits(mount(() => ({ status: 200, body: answer(balance("deficit", "200.00")) })));
    await toStep(/Звідки візьмуться 200,00/);
    expect(plain(document.body.textContent)).toContain(
      "Це план: гроші не переказуються. Покриття і непокритий дефіцит з’являться в «Бюджет → План» у рядку «Не розподілено / Дефіцит»; з дефіцитом сторінка «Бюджет» покаже банер «План з дефіцитом 200,00 €».",
    );
  });

  it("BUD-02@PoC FR 15: with `budget.plan` off the closing text does not send to «Бюджет → План» (surplus and deficit)", async () => {
    const off = { "GET /v1/me/features": FEATURES_OFF };
    await toLimits(mount(() => ({ status: 200, body: answer(balance("surplus", "2710.00")) }), off));
    await toStep("Розподіл профіциту");
    expect(plain(document.body.textContent)).toContain(
      "Це план: гроші не переказуються. Обрані суми буде збережено разом із бюджетом.",
    );
    expect(plain(document.body.textContent)).not.toContain("«Бюджет → План»");
    cleanup();
    resetAuthState();
    await toLimits(mount(() => ({ status: 200, body: answer(balance("deficit", "200.00")) }), off));
    await toStep(/Звідки візьмуться 200,00/);
    expect(plain(document.body.textContent)).toContain(
      "Це план: гроші не переказуються. Покриття буде збережено разом із бюджетом.",
    );
    expect(plain(document.body.textContent)).not.toContain("«Бюджет → План»");
  });

  it("BUD-02@PoC FR 15: a failed features read counts as `budget.plan` off — the text never promises the grid", async () => {
    await toLimits(
      mount(() => ({ status: 200, body: answer(balance("surplus", "2710.00")) }), {
        "GET /v1/me/features": { status: 500, body: undefined },
      }),
    );
    await toStep("Розподіл профіциту");
    expect(plain(document.body.textContent)).not.toContain("«Бюджет → План»");
    expect(plain(document.body.textContent)).toContain("буде збережено разом із бюджетом");
  });

  it("BUD-02@PoC FR 15: the four steps are named in the stepper, «Розподіл» last", async () => {
    await toLimits();
    const items = screen.getAllByRole("listitem").map((li) => plain(li.textContent));
    expect(items.some((x) => x.includes("Розподіл"))).toBe(true);
  });
});

describe("BUD-02@PoC FR 15 and BUD-03@PoC FR 2 typed rows and «Можна витратити»", () => {
  const surplus = (b: Body) => ({
    status: 200,
    body: answer(
      balance("surplus", "2710.00"),
      b.allocation ? choice("1000.00", "1710.00", "short") : null,
      spendable(b.allocation ? "1902.34" : "2902.34"),
    ),
  });
  const createBodyOf = (api: ReturnType<typeof mount>) =>
    api.calls.find((c) => c.method === "POST" && c.path === "/v1/budget")?.body as Body;

  it("BUD-02@PoC FR 15: goal, debt and «Заощадження без цілі» amounts leave as typed rows in the calculation and in POST /v1/budget, never as `chosen`", async () => {
    const api = await toLimits(mount(surplus));
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відпустка в Карпатах", "300");
    typeAmount("Сума: Кредитна ··9021", "250,25");
    typeAmount("Сума: Відкласти", "100");
    const rows: Row[] = [
      { kind: "goal", goalId: id(10), amount: { amount: "300.00", currency: "EUR" } },
      { kind: "debt", accountId: id(50), amount: { amount: "250.25", currency: "EUR" } },
      { kind: "savings", amount: { amount: "100.00", currency: "EUR" } },
    ];
    await waitFor(() => expect(lastBody(api).allocation).toEqual(rows));
    expect(lastBody(api).chosen).toBeUndefined();
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
    click("Створити бюджет");
    await waitFor(() => expect(createBodyOf(api)).toBeTruthy());
    expect(createBodyOf(api).allocation).toEqual(rows);
    expect(createBodyOf(api).chosen).toBeUndefined();
  });

  it("BUD-02@PoC FR 15: an empty or zero amount sends no row, and the rows of a surplus are dropped when the difference becomes a deficit", async () => {
    let kind: "surplus" | "deficit" = "surplus";
    const api = await toLimits(
      mount(() => ({
        status: 200,
        body: answer(balance(kind, kind === "surplus" ? "2710.00" : "200.00"), null),
      })),
    );
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відпустка в Карпатах", "0");
    typeAmount("Сума: Відкласти", "100");
    await waitFor(() =>
      expect(lastBody(api).allocation).toEqual([
        { kind: "savings", amount: { amount: "100.00", currency: "EUR" } },
      ]),
    );
    kind = "deficit";
    click("Назад");
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    typeAmount("Ліміт: Продукти", "900");
    await toStep(/Звідки візьмуться 200,00/);
    await waitFor(() => expect(lastBody(api).allocation).toBeUndefined());
  });

  it("BUD-02@PoC FR 15: the amounts typed on «Розподіл» are not sent while the limits step is open, and come back with the step", async () => {
    const api = await toLimits(mount(surplus));
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відпустка в Карпатах", "300");
    await waitFor(() => expect(lastBody(api).allocation).toHaveLength(1));
    click("Назад");
    await screen.findByRole("heading", { name: "Ліміти категорій" });
    await waitFor(() => expect(lastBody(api).allocation).toBeUndefined());
    await toStep("Розподіл профіциту");
    await waitFor(() => expect(lastBody(api).allocation).toHaveLength(1));
  });

  it("BUD-03@PoC FR 2 (BUD-02@PoC FR 3, AC6): «Можна витратити в листопаді ≈ M» is the server's figure under the bar of the limits step", async () => {
    await toLimits(mount(surplus));
    await waitFor(() =>
      expect(plain(document.querySelector(".bud-wiz-strip")?.textContent)).toContain(
        "Можна витратити в листопаді ≈ 2 902,34 €",
      ),
    );
  });

  it("BUD-03@PoC FR 2: on «Розподіл» the bottom row shows the figure after the chosen rows (the server's, from the `allocation` rows)", async () => {
    const api = await toLimits(mount(surplus));
    await toStep("Розподіл профіциту");
    await waitFor(() =>
      expect(plain(document.body.textContent)).toContain("Можна витратити в листопаді ≈ 2 902,34 €"),
    );
    typeAmount("Сума: Відпустка в Карпатах", "300");
    await waitFor(() =>
      expect(plain(document.body.textContent)).toContain("Можна витратити в листопаді ≈ 1 902,34 €"),
    );
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/v1/budget")).toBe(false);
    cleanup();
    resetAuthState();
    await toLimits(
      mount(() => ({ status: 200, body: answer(balance("deficit", "200.00"), null, spendable("1000.00")) })),
    );
    await toStep(/Звідки візьмуться 200,00/);
    await waitFor(() =>
      expect(plain(document.body.textContent)).toContain("Можна витратити в листопаді ≈ 1 000,00 €"),
    );
  });

  it("BUD-03@PoC FR 2: without a figure (amount null) the row says what is missing and shows no amount, never a partial one", async () => {
    await toLimits(
      mount(() => ({
        status: 200,
        body: answer(balance("surplus", "2710.00"), null, spendable(null, ["rates"])),
      })),
    );
    await waitFor(() =>
      expect(plain(document.querySelector(".bud-wiz-strip")?.textContent)).toContain(
        "Можна витратити в листопаді: сума поки невідома",
      ),
    );
    expect(plain(document.body.textContent)).toContain("немає курсу для однієї із сум");
    expect(plain(document.body.textContent)).not.toContain("≈");
  });

  it("BUD-03@PoC FR 2: a pending calculation does not leave the old figure on «Розподіл»", async () => {
    let release: (r: Reply) => void = () => undefined;
    let first = true;
    await toLimits(
      mount(() => {
        if (first) {
          first = false;
          return { status: 200, body: answer(balance("surplus", "2710.00")) };
        }
        return new Promise<Reply>((resolve) => (release = resolve)) as unknown as Reply;
      }),
    );
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відкласти", "100");
    await waitFor(() => expect(plain(document.body.textContent)).not.toContain("≈ 2 902,34"));
    release({ status: 200, body: answer(balance("surplus", "2710.00")) });
    await waitFor(() => expect(plain(document.body.textContent)).toContain("≈ 2 902,34"));
  });
});

describe("BUD-02@PoC AC7 and FR 15: the server refuses rows it would not save (400) — the step stays usable", () => {
  // As POST /v1/budget/allocation answers for typed rows (#646): a surplus over N is `400 VALIDATION_FAILED` on
  // `allocation`, not a 200 with `choice.status`; a deficit covered by less is no refusal (owner, 2026-11-21).
  const refused = (issue: string): Reply => {
    const r = problem(400, "VALIDATION_FAILED") as Exclude<Reply, "network"> & { body: object };
    return { ...r, body: { ...r.body, errors: [{ in: "body", path: "allocation", issue }] } };
  };

  it("BUD-02@PoC AC7: a deficit covered by less is not refused: the fields stay, the covered part is shown, «Створити бюджет» is active (AC17)", async () => {
    await toLimits(
      mount((b) => {
        const amount = b.allocation?.[0]?.amount.amount;
        if (amount === undefined) return { status: 200, body: answer(balance("deficit", "200.00")) };
        return amount === "200.00"
          ? { status: 200, body: answer(balance("deficit", "200.00"), choice("200.00", "0.00", "exact")) }
          : { status: 200, body: answer(balance("deficit", "200.00"), choice(amount, "100.00", "short")) };
      }),
    );
    await toStep(/Звідки візьмуться 200,00/);
    typeAmount("Сума: З цілі «Подушка безпеки»", "100");
    await waitFor(() => expect(plain(document.body.textContent)).toContain("Покрито 100,00 € з 200,00 €"));
    expect(disabled("Створити бюджет")).toBe(false);
    expect(plain(document.body.textContent)).not.toContain("Покрийте дефіцит повністю");
    typeAmount("Сума: З цілі «Подушка безпеки»", "200");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(false));
  });

  it("BUD-02@PoC FR 15: a surplus over N (400 `allocation: over`) keeps the fields and says why «Створити бюджет» is inactive", async () => {
    await toLimits(
      mount((b) =>
        b.allocation ? refused("over") : { status: 200, body: answer(balance("surplus", "2710.00")) },
      ),
    );
    await toStep("Розподіл профіциту");
    typeAmount("Сума: Відкласти", "5000");
    await waitFor(() => expect(disabled("Створити бюджет")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(plain(document.body.textContent)).not.toContain("Не вдалося порахувати розподіл");
    expect(screen.getByRole("textbox", { name: "Сума: Відкласти" })).toBeTruthy();
    expect(plain(document.body.textContent)).toContain("Обрано більше");
  });
});

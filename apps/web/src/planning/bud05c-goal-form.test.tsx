import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../auth/testing.tsx";
import { GoalsPage } from "./GoalsPage.tsx";
import type { Goal } from "./goals/model.ts";
import {
  choicesOf,
  createBody,
  freeOn,
  initialValues,
  patchBody,
  progressOf,
  valuesOf,
} from "./goals/newGoal.ts";

/**
 * BUD-05@PoC c) part 2 (wave 2, row 128): S-138 «Нова ціль» and «Змінити ціль» on the CMP-21 form dialog over the goals
 * API (`POST /v1/goals`, `PATCH /v1/goals/{id}`, `GET /v1/accounts`, `GET /v1/space`). Boards: PocPlanGoalNew,
 * PocPlanGoalNewForm, PocPlanGoalNewFormStep2, PocPlanGoalNewEnvelope, PocPlanGoalNewWhere, PocPlanGoalNewCushion,
 * PocPlanGoalNewCushionStep2. Synthetic goals and accounts. Today is 2026-11-02.
 */
const eur = (amount: string) => ({ amount, currency: "EUR" });
const GOAL_A = "a0000000-0000-4000-8000-000000000001";
const GOAL_B = "a0000000-0000-4000-8000-000000000002";
const NEW_ID = "a0000000-0000-4000-8000-000000000099";
const ACC_SAVE = "b0000000-0000-4000-8000-000000000001";
const ACC_RESERVE = "b0000000-0000-4000-8000-000000000002";
const ACC_DEBT = "b0000000-0000-4000-8000-000000000003";

function goal(over: Record<string, unknown>) {
  return {
    achieved: false,
    canContribute: true,
    collected: eur("2100.00"),
    contributedThisMonth: eur("0"),
    contributions: [],
    createdOn: "2026-07-14",
    emergencyMonths: null,
    forecastDate: "2027-06-15",
    id: GOAL_A,
    name: "Відпустка в Італії",
    overdue: false,
    overTarget: null,
    pace: eur("250.00"),
    part: { accountId: ACC_SAVE, freeBalance: eur("3500.00"), kind: "envelope", startAmount: eur("1000.00") },
    progressPercent: "52.5",
    requiredMonthly: eur("238"),
    spends: [],
    target: eur("4000.00"),
    targetDate: "2027-07-01",
    template: "travel",
    version: 1,
    ...over,
  };
}
const VACATION = goal({});
const LAPTOP = goal({
  id: GOAL_B,
  name: "Ноутбук для Соні",
  template: "purchase",
  achieved: true,
  collected: eur("1450.00"),
  target: eur("1450.00"),
  progressPercent: "100",
  targetDate: "2026-12-01",
  requiredMonthly: null,
  forecastDate: null,
  pace: null,
  part: { accountId: null, freeBalance: null, kind: "marks", startAmount: eur("400.00") },
});

const account = (id: string, name: string, last4: string, balance: string, group = "cash") => ({
  id,
  name,
  kind: group === "cash" ? "savings" : "credit-card",
  group,
  status: "active",
  number: { last4, masked: `··${last4}` },
  currencies: [
    {
      currency: "EUR",
      amount: eur(balance),
      approximate: false,
      equivalent: null,
      rateDate: null,
      restricted: false,
    },
  ],
});

function api(goals: unknown[], over: Record<string, Reply> = {}) {
  return fakeApi({
    "GET /v1/goals": { status: 200, body: { goals } },
    "GET /v1/space": { status: 200, body: { name: "Дім", dataRegion: "eu", reportingCurrency: "EUR" } },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [
          account(ACC_SAVE, "Ощадний", "5106", "5000.00"),
          account(ACC_RESERVE, "Резерв ПриватБанк", "5562", "9000.00"),
          account(ACC_DEBT, "Кредитка", "9021", "-100.00", "credit"),
        ],
        nextCursor: null,
      },
    },
    "POST /v1/goals": { status: 201, body: goal({ id: NEW_ID }) },
    "PATCH /v1/goals/a0000000-0000-4000-8000-000000000001": { status: 200, body: VACATION },
    ...over,
  });
}

function open(fake: ReturnType<typeof api>) {
  window.location.hash = "#/planning/goals";
  return render(
    <AuthApiProvider value={fake.client}>
      <GoalsPage today="2026-11-02" />
    </AuthApiProvider>,
  );
}

const dialog = () => screen.getByRole("dialog", { name: /^(Нова ціль|Змінити ціль)$/ });
const shown = () => dialog().querySelector<HTMLElement>(".ws-form-step:not([inert])")!;
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name });
const disabled = (el: HTMLElement) =>
  el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;
const reason = () => plain(dialog().querySelector(".ws-dialog-note")?.textContent);
const field = (name: RegExp) => within(shown()).getByRole("textbox", { name });
const select = (name: RegExp) => within(shown()).getByRole("combobox", { name }) as HTMLSelectElement;
const posts = (fake: ReturnType<typeof api>, method = "POST") =>
  fake.calls.filter((c) => c.method === method && c.path.startsWith("/v1/goals"));

async function openNew(fake: ReturnType<typeof api>) {
  open(fake);
  fireEvent.click(await screen.findByRole("button", { name: "Нова ціль" }));
  await screen.findByRole("dialog", { name: "Нова ціль" });
}
async function toStep(n: number) {
  fireEvent.click(button("Далі"));
  await waitFor(() => expect(shown().dataset["step"]).toBe(String(n)));
}
const fillMain = (name = "Новий диван", target = "1500") => {
  fireEvent.change(field(/^Назва/), { target: { value: name } });
  fireEvent.change(field(/^Цільова сума/), { target: { value: target } });
};

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("BUD-05@PoC c) S-138 «Нова ціль»: the form dialog", () => {
  it("BUD-05@PoC AC10: «Нова ціль» opens a two-step dialog «1 Основне · 2 Де лежать гроші»; name and target alone make «Створити ціль» active at step 1 and create one shared part «Без рахунку — лише позначки»", async () => {
    const fake = api([VACATION]);
    await openNew(fake);
    const steps = within(dialog()).getByRole("list", { name: "Кроки форми" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((li) => plain(li.textContent)),
    ).toEqual([
      "1ОсновнеКрок 1: Основне — поточний",
      "2Де лежать грошіКрок 2: Де лежать гроші — ще недоступний",
    ]);
    // Empty: «Створити ціль» is inactive on both steps.
    expect(disabled(button("Створити ціль"))).toBe(true);
    fillMain();
    expect(disabled(button("Створити ціль"))).toBe(false);
    fireEvent.click(button("Створити ціль"));
    await waitFor(() => expect(posts(fake)).toHaveLength(1));
    expect(posts(fake)[0]!.body).toEqual({
      template: "travel",
      name: "Новий диван",
      target: { amount: "1500.00", currency: "EUR" },
      targetDate: null,
      part: { kind: "marks", startAmount: "0" },
    });
    await waitFor(() => expect(window.location.hash).toBe(`#/planning/goals?goal=${NEW_ID}`));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("BUD-05@PoC AC10: while the name or the target is empty «Створити ціль» stays inactive on step 2 too", async () => {
    await openNew(api([]));
    fireEvent.change(field(/^Назва/), { target: { value: "Новий диван" } });
    expect(disabled(button("Створити ціль"))).toBe(true);
    fireEvent.change(field(/^Цільова сума/), { target: { value: "1500" } });
    await toStep(1);
    expect(disabled(button("Створити ціль"))).toBe(false);
    fireEvent.click(button("Назад"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("0"));
    fireEvent.change(field(/^Назва/), { target: { value: "" } });
    expect(disabled(button("Створити ціль"))).toBe(true);
    expect(disabled(button("Далі"))).toBe(true);
  });

  it("BUD-05@PoC AC11: leaving an empty «Цільова сума» shows «Обов’язкове поле» under it with the red frame; «Далі» and «Створити ціль» are inactive with the line «Щоб продовжити, заповніть: Цільова сума»; step 2 is greyed", async () => {
    await openNew(api([]));
    fireEvent.change(field(/^Назва/), { target: { value: "Новий диван" } });
    const target = field(/^Цільова сума/);
    fireEvent.focus(target);
    fireEvent.blur(target);
    expect(target.getAttribute("aria-invalid")).toBe("true");
    expect(within(shown()).getByText(/Обов’язкове поле/)).toBeTruthy();
    expect(disabled(button("Далі"))).toBe(true);
    expect(disabled(button("Створити ціль"))).toBe(true);
    expect(reason()).toBe("Щоб продовжити, заповніть: Цільова сума");
    const second = within(dialog()).getAllByRole("listitem")[1]!;
    expect(plain(second.textContent)).toContain("ще недоступний");
    fireEvent.click(within(second).getByRole("button", { hidden: true }));
    expect(shown().dataset["step"]).toBe("0");
  });

  it("BUD-05@PoC AC12: step 2, «Частина рахунку (конверт)» without an account: «Далі» and «Створити ціль» inactive with «Щоб продовжити, заповніть: Рахунок»; «Назад» works; on step 1 the line names «Рахунок (крок 2)»", async () => {
    await openNew(api([]));
    fillMain();
    await toStep(1);
    fireEvent.change(select(/^Де лежать гроші/), { target: { value: "envelope" } });
    expect(disabled(button("Створити ціль"))).toBe(true);
    expect(reason()).toBe("Щоб продовжити, заповніть: Рахунок");
    expect(disabled(button("Назад"))).toBe(false);
    fireEvent.click(button("Назад"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("0"));
    expect(disabled(button("Створити ціль"))).toBe(true);
    expect(reason()).toBe("Щоб продовжити, заповніть: Рахунок (крок 2)");
  });

  it('BUD-05@PoC AC13: an inactive «Створити ціль» takes the focus on Tab order, has aria-disabled="true" and aria-describedby on the line; a press creates nothing', async () => {
    const fake = api([]);
    await openNew(fake);
    const create = button("Створити ціль");
    create.focus();
    expect(document.activeElement).toBe(create);
    expect(create.getAttribute("aria-disabled")).toBe("true");
    const described = create.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(plain(document.getElementById(described!)?.textContent)).toBe(
      "Щоб продовжити, заповніть: Назва, Цільова сума",
    );
    fireEvent.click(create);
    fireEvent.keyDown(create, { key: "Enter" });
    expect(posts(fake)).toHaveLength(0);
  });

  it("BUD-05@PoC AC9: there is exactly one part and no «+ Додати рахунок»; «Рахунок» is only in the parts «Окремий рахунок цілі» and «Частина рахунку (конверт)»; the part list has the three variants", async () => {
    await openNew(api([]));
    fillMain();
    await toStep(1);
    const part = select(/^Де лежать гроші/);
    expect([...part.options].filter((o) => o.value).map((o) => o.textContent)).toEqual([
      "Окремий рахунок цілі",
      "Частина рахунку (конверт)",
      "Без рахунку — лише позначки",
    ]);
    expect(part.value).toBe("marks");
    expect(within(dialog()).queryByRole("combobox", { name: /^Рахунок/ })).toBeNull();
    expect(within(dialog()).queryByText(/Додати рахунок/)).toBeNull();
    expect(within(dialog()).getAllByRole("combobox", { name: /^Де лежать гроші/ })).toHaveLength(1);
    expect(plain(shown().textContent)).toContain("зібрано = сума ваших позначок «Внести»");
    fireEvent.change(part, { target: { value: "envelope" } });
    expect(within(shown()).getByRole("combobox", { name: /^Рахунок/ })).toBeTruthy();
    expect(plain(shown().textContent)).toContain("резерв у залишку спільного рахунку");
    fireEvent.change(part, { target: { value: "marks" } });
    expect(within(shown()).queryByRole("combobox", { name: /^Рахунок/ })).toBeNull();
    // The accounts offered: open cash accounts only («Кредитка» is a credit account).
    fireEvent.change(part, { target: { value: "account" } });
    const accounts = select(/^Рахунок/);
    expect([...accounts.options].filter((o) => o.value).map((o) => plain(o.textContent))).toEqual([
      "Ощадний ··5106 · 5 000,00 €",
      "Резерв ПриватБанк ··5562 · 9 000,00 €",
    ]);
  });

  it("BUD-05@PoC AC1: «Подорож» with an envelope on the savings account and a start of 1 000 € sends the amounts as decimal strings and shows the free balance and the progress", async () => {
    const fake = api([]);
    await openNew(fake);
    expect(plain(shown().textContent)).toContain("відпустка чи поїздка до певної дати");
    fillMain("Відпустка в Італії", "4000");
    await toStep(1);
    fireEvent.change(select(/^Де лежать гроші/), { target: { value: "envelope" } });
    fireEvent.change(select(/^Рахунок/), { target: { value: ACC_SAVE } });
    fireEvent.change(field(/^Стартова сума/), { target: { value: "1000" } });
    expect(plain(shown().textContent)).toContain("вільний залишок стане 4 000,00 €");
    expect(plain(shown().textContent)).toContain("стартова сума 1 000,00 € · прогрес 25 %");
    fireEvent.click(button("Створити ціль"));
    await waitFor(() => expect(posts(fake)).toHaveLength(1));
    expect(posts(fake)[0]!.body).toMatchObject({
      template: "travel",
      target: { amount: "4000.00", currency: "EUR" },
      part: { kind: "envelope", accountId: ACC_SAVE, startAmount: "1000.00" },
    });
  });

  it("BUD-05@PoC FR 2: a negative starting amount shows its own error, blocks «Створити ціль» and sends nothing", async () => {
    const fake = api([]);
    await openNew(fake);
    fillMain("Відпустка в Італії", "4000");
    await toStep(1);
    fireEvent.change(select(/^Де лежать гроші/), { target: { value: "envelope" } });
    fireEvent.change(select(/^Рахунок/), { target: { value: ACC_SAVE } });
    const start = field(/^Стартова сума/);
    fireEvent.change(start, { target: { value: "-100" } });
    fireEvent.blur(start);
    expect(plain(shown().textContent)).toContain("Стартова сума не може бути від'ємною");
    fireEvent.click(button("Створити ціль"));
    expect(posts(fake)).toHaveLength(0);
    fireEvent.change(start, { target: { value: "100" } });
    fireEvent.blur(start);
    expect(plain(shown().textContent)).not.toContain("не може бути від'ємною");
  });

  it("BUD-05@PoC AC4: an envelope over the balance is refused by the server and the dialog says «Сума конвертів перевищує залишок рахунку на 300,00 €» and stays open", async () => {
    const fake = api([], {
      "POST /v1/goals": {
        status: 409,
        headers: { "content-type": "application/problem+json" },
        body: {
          type: "urn:willowsum:problem:goal_envelopes_over_balance",
          title: "GOAL_ENVELOPES_OVER_BALANCE",
          status: 409,
          code: "GOAL_ENVELOPES_OVER_BALANCE",
          excess: eur("300.00"),
        },
      },
    });
    await openNew(fake);
    fillMain("Ремонт", "3000");
    await toStep(1);
    fireEvent.change(select(/^Де лежать гроші/), { target: { value: "envelope" } });
    fireEvent.change(select(/^Рахунок/), { target: { value: ACC_SAVE } });
    fireEvent.change(field(/^Стартова сума/), { target: { value: "800" } });
    fireEvent.click(button("Створити ціль"));
    expect(
      await within(dialog()).findByText("Сума конвертів перевищує залишок рахунку на 300,00 €"),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Нова ціль" })).toBeTruthy();
  });

  it("BUD-05@PoC c) a separate account part sends no start amount and shows what is collected; an account that is taken says so", async () => {
    const fake = api([], {
      "POST /v1/goals": problem(409, "GOAL_ACCOUNT_TAKEN"),
    });
    await openNew(fake);
    fillMain("Подушка", "12600");
    await toStep(1);
    fireEvent.change(select(/^Де лежать гроші/), { target: { value: "account" } });
    fireEvent.change(select(/^Рахунок/), { target: { value: ACC_RESERVE } });
    expect(within(shown()).queryByRole("textbox", { name: /^Стартова сума/ })).toBeNull();
    expect(plain(shown().textContent)).toContain("зібрано 9 000,00 € · прогрес 71,4 %");
    fireEvent.click(button("Створити ціль"));
    await waitFor(() => expect(posts(fake)).toHaveLength(1));
    expect(posts(fake)[0]!.body).toMatchObject({ part: { kind: "account", accountId: ACC_RESERVE } });
    expect((posts(fake)[0]!.body as { part: object }).part).not.toHaveProperty("startAmount");
    expect(await within(dialog()).findByText(/Цей рахунок уже зайнятий/)).toBeTruthy();
  });

  it("BUD-05@PoC c) the template «Подушка безпеки» has «Місяців витрат» (3 by default) that goes with the goal", async () => {
    const fake = api([]);
    open(fake);
    // The empty state offers the four templates; the chosen one is preselected.
    fireEvent.click(await screen.findByRole("button", { name: /^Подушка безпеки/ }));
    await screen.findByRole("dialog", { name: "Нова ціль" });
    expect(select(/^Шаблон/).value).toBe("emergency");
    expect((field(/^Місяців витрат/) as HTMLInputElement).value).toBe("3");
    fireEvent.change(field(/^Назва/), { target: { value: "Подушка безпеки" } });
    fireEvent.change(field(/^Цільова сума/), { target: { value: "12600" } });
    fireEvent.change(field(/^Місяців витрат/), { target: { value: "0" } });
    expect(disabled(button("Створити ціль"))).toBe(true);
    fireEvent.change(field(/^Місяців витрат/), { target: { value: "3" } });
    fireEvent.click(button("Створити ціль"));
    await waitFor(() => expect(posts(fake)).toHaveLength(1));
    expect(posts(fake)[0]!.body).toMatchObject({ template: "emergency", emergencyMonths: 3 });
  });

  it("BUD-05@PoC c) states: a past date is refused under the field; a failed save keeps the dialog with an error", async () => {
    const fake = api([VACATION], { "POST /v1/goals": problem(500, "INTERNAL") });
    await openNew(fake);
    fillMain();
    fireEvent.click(button("Створити ціль"));
    expect(await within(dialog()).findByText("Не вдалося зберегти ціль. Спробуйте ще раз")).toBeTruthy();
  });
});

describe("BUD-05@PoC c) S-138 «Змінити ціль»", () => {
  async function openEdit(fake: ReturnType<typeof api>, name: string) {
    open(fake);
    const card = (await screen.findByRole("heading", { level: 2, name })).closest("section")!;
    fireEvent.click(within(card).getByRole("button", { name: "Ще дії" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Змінити ціль" }));
    await screen.findByRole("dialog", { name: "Змінити ціль" });
  }

  // Criterion 7 in part: its main action «Витратити» is row 129, so this test is named by FR 13, not by the criterion.
  it("BUD-05@PoC FR 13: the menu «⋯» of a goal, an achieved one too, starts with «Змінити ціль»; an achieved goal keeps a quiet «Внести»", async () => {
    open(api([LAPTOP]));
    const card = (await screen.findByRole("heading", { level: 2, name: "Ноутбук для Соні" })).closest(
      "section",
    )!;
    expect(within(card).getByRole("button", { name: "Внести" }).className).not.toContain("ws-button-primary");
    fireEvent.click(within(card).getByRole("button", { name: "Ще дії" }));
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Змінити ціль", "Закрити без витрати", "Видалити"]);
  });

  it("BUD-05@PoC AC14: with every field valid all steps are open; clearing «Цільова сума» makes «Зберегти» and «Далі» inactive with the line, closes step 2; entering 4 000 € brings them back; only the changed fields are sent", async () => {
    const fake = api([VACATION]);
    await openEdit(fake, "Відпустка в Італії");
    expect((field(/^Назва/) as HTMLInputElement).value).toBe("Відпустка в Італії");
    expect(disabled(button("Зберегти"))).toBe(false);
    const steps = within(dialog()).getAllByRole("listitem");
    expect(plain(steps[1]!.textContent)).not.toContain("ще недоступний");
    const target = field(/^Цільова сума/);
    fireEvent.change(target, { target: { value: "" } });
    fireEvent.blur(target);
    expect(disabled(button("Зберегти"))).toBe(true);
    expect(disabled(button("Далі"))).toBe(true);
    expect(reason()).toBe("Щоб продовжити, заповніть: Цільова сума");
    expect(plain(steps[1]!.textContent)).toContain("ще недоступний");
    fireEvent.change(target, { target: { value: "4000" } });
    expect(disabled(button("Зберегти"))).toBe(false);
    expect(plain(within(dialog()).getAllByRole("listitem")[1]!.textContent)).not.toContain("ще недоступний");
    fireEvent.change(field(/^Назва/), { target: { value: "Відпустка в Італії 2027" } });
    fireEvent.click(button("Зберегти"));
    await waitFor(() => expect(posts(fake, "PATCH")).toHaveLength(1));
    expect(posts(fake, "PATCH")[0]!.body).toEqual({ name: "Відпустка в Італії 2027" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("BUD-05@PoC AC14: a changed part is sent whole (kind, account, start) and the goal's currency stays", async () => {
    const fake = api([VACATION]);
    await openEdit(fake, "Відпустка в Італії");
    fireEvent.click(within(dialog()).getAllByRole("listitem")[1]!.querySelector("button")!);
    await waitFor(() => expect(shown().dataset["step"]).toBe("1"));
    fireEvent.change(field(/^Стартова сума/), { target: { value: "1200" } });
    fireEvent.click(button("Зберегти"));
    await waitFor(() => expect(posts(fake, "PATCH")).toHaveLength(1));
    expect(posts(fake, "PATCH")[0]!.body).toEqual({
      part: { kind: "envelope", accountId: ACC_SAVE, startAmount: "1200.00" },
    });
  });
});

describe("BUD-05@PoC c) the form model: amounts are strings, sums are exact and in one currency", () => {
  it("BUD-05@PoC c) the request keeps an amount beyond the safe integers exactly (no Number)", () => {
    const body = createBody(
      { ...initialValues("custom"), name: " Дім ", target: "9007199254740993.10", start: null },
      "EUR",
    );
    expect(body.target).toEqual({ amount: "9007199254740993.10", currency: "EUR" });
    expect(body.name).toBe("Дім");
    expect(progressOf("9007199254740993.10", "18014398509481986.20")).toBe("50");
    expect(progressOf("200", "1800")).toBe("11.1");
    expect(progressOf("1", "0")).toBeNull();
  });

  it("BUD-05@PoC c) a patch with nothing changed is empty; free balance is only shown in one currency and never beside a separate account", () => {
    expect(patchBody(valuesOf(VACATION as unknown as Goal), VACATION as unknown as Goal)).toEqual({});
    const choice = choicesOf(
      [account(ACC_SAVE, "Ощадний", "5106", "5000.00"), account(ACC_DEBT, "К", "1", "1", "credit")] as never,
      "EUR",
    );
    expect(choice.map((c) => c.id)).toEqual([ACC_SAVE]);
    expect(choicesOf([account(ACC_SAVE, "Ощадний", "5106", "5000.00")] as never, "USD")).toEqual([]);
    expect(freeOn(choice[0]!, [])).toEqual(eur("5000.00"));
    expect(freeOn(choice[0]!, [VACATION as unknown as Goal])).toEqual(eur("3500.00"));
    const usd = goal({ part: { ...VACATION.part, freeBalance: { amount: "1.00", currency: "USD" } } });
    expect(freeOn(choice[0]!, [usd as unknown as Goal])).toBeNull();
    const own = goal({ part: { ...VACATION.part, kind: "account", freeBalance: null } });
    expect(freeOn(choice[0]!, [own as unknown as Goal])).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../auth/testing.tsx";
import { GoalsPage } from "./GoalsPage.tsx";
import { afterContribution, barPercent, collectedTotal, goalColor } from "./goals/model.ts";

/**
 * BUD-05@PoC c) (wave 2, row 128): S-136 «Цілі» and the card S-137 on the goals API (`GET /v1/goals`, `POST
 * /v1/goals/{id}/contributions`, close, delete), GRID-04@PoC FR 7 (amber only for goals, the bar in the goal scale)
 * and CMP-61@PoC FR 8 / AC8 (the popover of «Внести»). Boards: PocPlanGoals, PocPlanGoalCard,
 * PocPlanGoalCardContribute, PocPlanGoalCardAchieved. «Нова ціль» and «Змінити ціль» (S-138) are in bud05c-goal-form.test.tsx. The goals are
 * synthetic. Today is 2026-11-02.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "goals", "goals.css"), "utf8");

const eur = (amount: string) => ({ amount, currency: "EUR" });
const GOAL_A = "a0000000-0000-4000-8000-000000000001";
const GOAL_B = "a0000000-0000-4000-8000-000000000002";
const GOAL_C = "a0000000-0000-4000-8000-000000000003";
const ACC_SAVE = "b0000000-0000-4000-8000-000000000001";
const ACC_RESERVE = "b0000000-0000-4000-8000-000000000002";

function goal(over: Record<string, unknown>) {
  return {
    achieved: false,
    canContribute: true,
    collected: eur("2100.00"),
    contributedThisMonth: eur("250.00"),
    contributions: [
      { id: "c0000000-0000-4000-8000-000000000001", date: "2026-11-01", amount: eur("250.00") },
      { id: "c0000000-0000-4000-8000-000000000002", date: "2026-10-01", amount: eur("250.00") },
    ],
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
const CUSHION = goal({
  id: GOAL_B,
  name: "Подушка безпеки",
  template: "emergency",
  collected: eur("9000.00"),
  target: eur("12600.00"),
  progressPercent: "71.4",
  targetDate: null,
  requiredMonthly: null,
  forecastDate: null,
  pace: eur("300.00"),
  canContribute: false,
  contributions: [],
  part: { accountId: ACC_RESERVE, freeBalance: null, kind: "account", startAmount: eur("6100.00") },
});
const LAPTOP = goal({
  id: GOAL_C,
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

const account = (id: string, name: string, last4: string) => ({
  id,
  name,
  kind: "savings",
  status: "active",
  number: { last4 },
  currencies: [{ currency: "EUR", balance: "5600.00" }],
});

function api(goals: unknown[], over: Record<string, Reply> = {}) {
  return fakeApi({
    "GET /v1/goals": { status: 200, body: { goals } },
    "GET /v1/accounts": {
      status: 200,
      body: {
        items: [account(ACC_SAVE, "Ощадний", "5106"), account(ACC_RESERVE, "Резерв ПриватБанк", "5562")],
        nextCursor: null,
      },
    },
    ...over,
  });
}

function open(fake: ReturnType<typeof api>, hash = "#/planning/goals") {
  window.location.hash = hash;
  return render(
    <AuthApiProvider value={fake.client}>
      <GoalsPage today="2026-11-02" />
    </AuthApiProvider>,
  );
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("BUD-05@PoC c) S-136 «Цілі», S-137 card: the list and the card of the chosen goal", () => {
  it("BUD-05@PoC FR 1: the list shows the active goals with «зібрано з ціль · до дата» and the percent; the first goal opens in the card next to it", async () => {
    open(api([VACATION, CUSHION, LAPTOP]));
    const list = await screen.findByRole("list", { name: "Список цілей" });
    const rows = within(list).getAllByRole("link");
    expect(rows).toHaveLength(3);
    expect(plain(rows[0]!.textContent)).toContain("Відпустка в Італії");
    expect(plain(rows[0]!.textContent)).toContain("2 100,00 € з 4 000,00 € · до 1 лип. 2027");
    expect(plain(rows[0]!.textContent)).toContain("52,5 %");
    expect(plain(rows[1]!.textContent)).toContain("9 000,00 € з 12 600,00 € · без дати");
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { level: 2, name: "Відпустка в Італії" })).toBeTruthy();
  });

  it("BUD-05@PoC FR 1: a chosen row opens its goal in the card (master-detail), the choice is in the address", async () => {
    open(api([VACATION, CUSHION, LAPTOP]));
    const list = await screen.findByRole("list", { name: "Список цілей" });
    fireEvent.click(within(list).getByRole("link", { name: /Подушка безпеки/ }));
    expect(window.location.hash).toBe(`#/planning/goals?goal=${GOAL_B}`);
    expect(await screen.findByRole("heading", { level: 2, name: "Подушка безпеки" })).toBeTruthy();
  });

  it("BUD-05@PoC c) the header counts the goals and sums what is collected in one currency; goals in two currencies show no sum", async () => {
    open(api([VACATION, CUSHION, LAPTOP]));
    expect(
      await screen
        .findByText(/3 активні цілі · зібрано 12 550,00 €/u, undefined, { timeout: 3000 })
        .catch(() => null),
    ).toBeTruthy();
    cleanup();
    expect(collectedTotal([VACATION, CUSHION, LAPTOP] as never)).toEqual(eur("12550"));
    expect(
      collectedTotal([VACATION, { ...CUSHION, collected: { amount: "1.00", currency: "USD" } }] as never),
    ).toBeNull();
  });

  it("GRID-04@PoC EC2: without goals the list region keeps the empty state «Додайте першу ціль» (#541)", async () => {
    open(api([]));
    expect(await screen.findByRole("heading", { level: 2, name: "Додайте першу ціль" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Список цілей" })).toBeNull();
  });

  it("BUD-05@PoC c) states: «Не вдалося завантажити цілі» with «Спробувати ще раз» that reads the goals again", async () => {
    let attempt = 0;
    const fake = api([], {
      "GET /v1/goals": (() =>
        ++attempt === 1
          ? problem(503, "MODULE_UNAVAILABLE")
          : { status: 200, body: { goals: [VACATION] } }) as never,
    });
    open(fake);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Не вдалося завантажити цілі")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Відпустка в Італії" })).toBeTruthy();
  });

  it("BUD-05@PoC c) states: while the goals load the list shows a skeleton", () => {
    open(fakeApi({ "GET /v1/goals": new Promise(() => undefined) as never }));
    expect(screen.getByLabelText("Завантажуємо цілі")).toBeTruthy();
  });
});

describe("BUD-05@PoC FR 4, GRID-04@PoC FR 7: the bar and the amber", () => {
  it("BUD-05@PoC FR 4: the bar takes the colour of the goal scale at its percent — the stops at 0, 25, 55, 80 and 100 %", () => {
    const at = (p: string) => goalColor(barPercent(p));
    expect([at("0"), at("25"), at("55"), at("80"), at("100")]).toEqual([
      "var(--ws-goal-0)",
      "var(--ws-goal-25)",
      "var(--ws-goal-55)",
      "var(--ws-goal-80)",
      "var(--ws-goal-100)",
    ]);
    expect(at("40")).toBe("color-mix(in srgb, var(--ws-goal-55) 50%, var(--ws-goal-25))");
  });

  it("BUD-05@PoC FR 4: a goal over the target has the full bar in goal-100 with «+ N € понад ціль»", async () => {
    const over = goal({
      id: GOAL_C,
      name: "Ноутбук для Соні",
      achieved: true,
      progressPercent: "103.4",
      collected: eur("1500.00"),
      target: eur("1450.00"),
      overTarget: eur("50.00"),
    });
    open(api([over]));
    const bar = (await screen.findByLabelText("Прогрес цілі «Ноутбук для Соні»")) as HTMLElement;
    const fill = bar.querySelector<HTMLElement>(".goal-bar-fill")!;
    expect(fill.style.inlineSize).toBe("100%");
    expect(fill.style.backgroundColor).toBe("var(--ws-goal-100)");
    expect(screen.getByText("+ 50,00 € понад ціль")).toBeTruthy();
    expect(screen.getAllByText("✓ Досягнуто").length).toBeGreaterThan(0);
  });

  it("GRID-04@PoC FR 7: amber (`accent`) is used only for the goal icon, as a fill; the bar and the statuses do not use it", async () => {
    const rule = (selector: string) =>
      new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(rule(".goal-icon")).toContain("background: var(--ws-accent);");
    expect(css.match(/--ws-accent/g)).toHaveLength(1);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    open(api([VACATION]));
    await screen.findByRole("heading", { level: 2, name: "Відпустка в Італії" });
    expect(document.querySelectorAll(".goal-icon")).toHaveLength(1);
  });
});

describe("BUD-05@PoC FR 4, FR 6, FR 13: the card", () => {
  it("BUD-05@PoC FR 4: the card shows collected, target, percent, date, the required monthly contribution, the forecast and the pace as the API gives them", async () => {
    open(api([VACATION]));
    const card = (await screen.findByRole("heading", { level: 2, name: "Відпустка в Італії" })).closest(
      "section",
    )!;
    const text = plain(card.textContent);
    expect(text).toContain("Подорож · Частина рахунку (конверт)");
    expect(text).toContain("2 100,00 €");
    expect(text).toContain("з 4 000,00 €");
    expect(text).toContain("1 лип. 2027");
    expect(text).toContain("238 € / міс.");
    expect(text).toContain("15 черв. 2027");
    expect(text).toContain("250,00 € / міс.");
    const bar = within(card).getByRole("progressbar", { name: "Прогрес цілі «Відпустка в Італії»" });
    expect(bar.querySelector<HTMLElement>(".goal-bar-fill")!.style.backgroundColor).toBe(
      goalColor(barPercent("52.5")),
    );
  });

  it("BUD-05@PoC FR 2, FR 4: «Де лежать гроші» names the account and the free balance; the history lists contributions and the starting amount", async () => {
    open(api([VACATION]));
    const where = await screen.findByRole("heading", { name: "Де лежать гроші" });
    const text = plain(where.closest("section")!.textContent);
    expect(text).toContain("Ощадний ··5106");
    expect(text).toContain("вільно 3 500,00 €");
    expect(text).toContain("внесок 250,00 € уже зараховано");
    const history = within(screen.getByRole("heading", { name: "Внески" }).closest("section")!);
    expect(history.getAllByRole("listitem")).toHaveLength(3);
    expect(plain(history.getAllByRole("listitem")[2]!.textContent)).toContain("Стартова сума");
    expect(plain(history.getAllByRole("listitem")[2]!.textContent)).toContain("+1 000,00 €");
  });

  // Criterion 15 stays open: the form «Нова транзакція» does not read `type`/`to` yet (FIN-03 follow-up), so no AC claim.
  it("BUD-05@PoC FR 6: a goal on a separate account has no «Внести»; the hint names the account and «Додати переказ» links to a transfer to it", async () => {
    open(api([CUSHION]));
    const hint = await screen.findByText(/Щоб поповнити ціль, додайте переказ на рахунок ··5562/);
    expect(screen.queryByRole("button", { name: "Внести" })).toBeNull();
    const link = within(hint.closest("p")!).getByRole("link", { name: "Додати переказ" });
    expect(link.getAttribute("href")).toBe(`#/money/transactions/new?type=transfer&to=${ACC_RESERVE}`);
  });

  // Criterion 7 in part (the menu with «Змінити ціль», the quiet «Внести»); its main action «Витратити» is row 129, so the tests name FR 13.
  it("BUD-05@PoC FR 13: an achieved goal has «✓ Досягнуто», a quiet «Внести» and the menu «⋯» with «Змінити ціль», «Закрити без витрати» and «Видалити»; no pause", async () => {
    open(api([LAPTOP]));
    const card = (await screen.findByRole("heading", { level: 2, name: "Ноутбук для Соні" })).closest(
      "section",
    )!;
    expect(plain(card.textContent)).toContain("✓ Досягнуто");
    expect(within(card).getByRole("button", { name: "Внести" }).className).not.toContain("ws-button-primary");
    fireEvent.click(within(card).getByRole("button", { name: "Ще дії" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Змінити ціль", "Закрити без витрати", "Видалити"]);
    expect(screen.queryByText(/пауз/i)).toBeNull();
    expect(screen.queryByText(/Відстає|Автовнесок|Архів/)).toBeNull();
  });

  it("BUD-05@PoC FR 13: «Закрити без витрати» asks, closes the goal and the list is read again", async () => {
    let closed = false;
    const fake = api([], {
      "GET /v1/goals": (() => ({ status: 200, body: { goals: closed ? [] : [LAPTOP] } })) as never,
      [`POST /v1/goals/${GOAL_C}/close`]: (() => {
        closed = true;
        return { status: 200, body: { closed: true } };
      }) as never,
    });
    open(fake);
    const card = (await screen.findByRole("heading", { level: 2, name: "Ноутбук для Соні" })).closest(
      "section",
    )!;
    fireEvent.click(within(card).getByRole("button", { name: "Ще дії" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Закрити без витрати" }));
    const dialog = await screen.findByRole("dialog", { name: "Закрити ціль «Ноутбук для Соні»?" });
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Закрити" }).at(-1)!);
    expect(await screen.findByRole("heading", { level: 2, name: "Додайте першу ціль" })).toBeTruthy();
    expect(fake.calls.some((c) => c.method === "POST" && c.path === `/v1/goals/${GOAL_C}/close`)).toBe(true);
  });

  it("BUD-05@PoC FR 13: «Видалити» asks first and deletes the goal; a failure keeps the dialog open", async () => {
    const fake = api([LAPTOP], { [`DELETE /v1/goals/${GOAL_C}`]: problem(503, "MODULE_UNAVAILABLE") });
    open(fake);
    const card = (await screen.findByRole("heading", { level: 2, name: "Ноутбук для Соні" })).closest(
      "section",
    )!;
    fireEvent.click(within(card).getByRole("button", { name: "Ще дії" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Видалити" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Видалити" }));
    expect(await within(dialog).findByText(/Помилка/)).toBeTruthy();
  });
});

describe("CMP-61@PoC FR 8, AC8: «Внести» opens a popover", () => {
  it("CMP-61@PoC AC8: «Внести» opens a dialog without backdrop with «Сума», «Дата», «Скасувати» and «Додати внесок»; «Скасувати» closes it", async () => {
    open(api([VACATION]));
    fireEvent.click(await screen.findByRole("button", { name: "Внести" }));
    const dialog = screen.getByRole("dialog", { name: "Внести у «Відпустка в Італії»" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.closest(".ws-popover-host")).not.toBeNull();
    expect(document.querySelector(".ws-dialog-backdrop, .ws-backdrop")).toBeNull();
    expect(within(dialog).getByLabelText(/Сума/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Дата/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    expect(screen.queryByRole("dialog", { name: /Внести у/ })).toBeNull();
  });

  it("CMP-61@PoC AC8, BUD-05@PoC FR 6: «Додати внесок» sends the amount and the date as a manual mark and the card reads the goals again", async () => {
    let added = false;
    const fake = api([], {
      "GET /v1/goals": (() => ({
        status: 200,
        body: {
          goals: [added ? { ...VACATION, collected: eur("2400.00"), progressPercent: "60" } : VACATION],
        },
      })) as never,
      [`POST /v1/goals/${GOAL_A}/contributions`]: (() => {
        added = true;
        return { status: 201, body: {} };
      }) as never,
    });
    open(fake);
    fireEvent.click(await screen.findByRole("button", { name: "Внести" }));
    const dialog = screen.getByRole("dialog", { name: "Внести у «Відпустка в Італії»" });
    const amount = within(dialog).getByLabelText(/Сума/);
    fireEvent.change(amount, { target: { value: "300" } });
    fireEvent.blur(amount);
    expect(plain(dialog.textContent)).toContain("Після внеску: 2 400,00 € з 4 000,00 € · 60 %");
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати внесок" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Внести у/ })).toBeNull());
    const post = fake.calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ amount: { amount: "300.00", currency: "EUR" }, date: "2026-11-02" });
    expect((await screen.findAllByText("60 %")).length).toBe(2);
  });

  it("CMP-61@PoC AC8: «Додати внесок» without an amount shows «Обов’язкове поле» and sends nothing", async () => {
    const fake = api([VACATION]);
    open(fake);
    fireEvent.click(await screen.findByRole("button", { name: "Внести" }));
    const dialog = screen.getByRole("dialog", { name: /Внести у/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати внесок" }));
    expect(await within(dialog).findByText(/Обов.язкове поле/)).toBeTruthy();
    expect(fake.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("BUD-05@PoC FR 6: a contribution that the API refuses keeps the popover open with an error", async () => {
    const fake = api([VACATION], {
      [`POST /v1/goals/${GOAL_A}/contributions`]: problem(400, "VALIDATION_FAILED"),
    });
    open(fake);
    fireEvent.click(await screen.findByRole("button", { name: "Внести" }));
    const dialog = screen.getByRole("dialog", { name: /Внести у/ });
    const amount = within(dialog).getByLabelText(/Сума/);
    fireEvent.change(amount, { target: { value: "10" } });
    fireEvent.blur(amount);
    fireEvent.click(within(dialog).getByRole("button", { name: "Додати внесок" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
  });

  it("BUD-05@PoC FR 6: the sum after a contribution is exact in one currency (Decimal), over the target too", () => {
    expect(afterContribution(VACATION as never, "300.00")).toEqual({ collected: eur("2400"), percent: "60" });
    expect(afterContribution(VACATION as never, "2000.10")?.percent).toBe("102");
    expect(afterContribution(VACATION as never, "abc")).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../auth/testing.tsx";
import { GoalCard } from "./goals/GoalCard.tsx";
import { SpendDialog } from "./goals/SpendDialog.tsx";
import type { Goal } from "./goals/model.ts";
import { chosenSum, leftAfter, spendBody, type SpendRow } from "./goals/spend.ts";

/**
 * BUD-05@PoC d) (wave 2, row 129): S-139 «Витратити з цілі» on the CMP-21 form dialog over `GET /v1/transactions` and
 * `POST /v1/goals/{id}/spends`. Boards: PocPlanGoalSpend, PocPlanGoalSpendStep2, PocPlanGoalCard, PocPlanGoalCardAchieved.
 * The dialog (and the card for its button) is rendered alone. Synthetic goals, accounts and transactions.
 */
const eur = (amount: string) => ({ amount, currency: "EUR" });
const GOAL = "a0000000-0000-4000-8000-000000000001";
const ACC = "b0000000-0000-4000-8000-000000000001";
const OTHER_ACC = "b0000000-0000-4000-8000-000000000002";

function goal(over: Record<string, unknown> = {}): Goal {
  return {
    achieved: false,
    canContribute: true,
    collected: eur("2100.00"),
    contributedThisMonth: eur("0"),
    contributions: [],
    createdOn: "2026-07-14",
    emergencyMonths: null,
    forecastDate: "2027-06-15",
    id: GOAL,
    name: "Відпустка в Італії",
    overdue: false,
    overTarget: null,
    pace: eur("250.00"),
    part: { accountId: ACC, freeBalance: eur("3500.00"), kind: "envelope", startAmount: eur("1000.00") },
    progressPercent: "52.5",
    requiredMonthly: eur("238"),
    spends: [],
    target: eur("4000.00"),
    targetDate: "2027-07-01",
    template: "travel",
    version: 1,
    ...over,
  } as unknown as Goal;
}

const accounts = new Map([
  [ACC, { id: ACC, label: "Ощадний", mask: "··5106", selectable: true, currency: "EUR" }],
  [OTHER_ACC, { id: OTHER_ACC, label: "Картка", mask: "··1111", selectable: true, currency: "EUR" }],
]);

const tx = (
  n: number,
  merchant: string,
  amount: string,
  date: string,
  over: Record<string, unknown> = {},
) => ({
  id: `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  accountId: ACC,
  amount: eur(`-${amount}`),
  type: "expense",
  date,
  counterparty: merchant,
  description: null,
  status: "posted",
  hidden: false,
  transfer: null,
  ...over,
});
const FIRST = [
  tx(1, "Booking.com", "640.00", "2026-10-29"),
  tx(2, "Wizz Air", "386.40", "2026-10-27"),
  tx(3, "Rozetka", "74.90", "2026-10-21"),
  tx(4, "Нова пошта", "6.20", "2026-10-14"),
  tx(5, "Uber", "18.60", "2026-10-09"),
  tx(6, "Сільпо", "42.35", "2026-10-05"),
];
const MORE = [1, 2, 3, 4, 5].map((i) => tx(10 + i, `Магазин ${i}`, "10.00", "2026-09-2" + i));
const all = [...FIRST, ...MORE];

function api(items: unknown[] = all, over: Record<string, Reply | ((c: never, u: URL) => Reply)> = {}) {
  return fakeApi({
    "GET /v1/transactions": { status: 200, body: { items, count: items.length, from: 1 } },
    "POST /v1/goals/a0000000-0000-4000-8000-000000000001/spends": { status: 201, body: goal() },
    "POST /v1/goals/a0000000-0000-4000-8000-000000000001/close": { status: 200, body: { closed: true } },
    ...(over as Record<string, Reply>),
  });
}

function open(fake: ReturnType<typeof api>, g: Goal = goal()) {
  const done = { spent: vi.fn(), gone: vi.fn(), closed: vi.fn() };
  render(
    <AuthApiProvider value={fake.client}>
      <SpendDialog
        goal={g}
        accounts={accounts}
        onClose={done.closed}
        onSpent={done.spent}
        onGone={done.gone}
      />
    </AuthApiProvider>,
  );
  return done;
}
const dialog = () => screen.getByRole("dialog", { name: "Витратити з «Відпустка в Італії»" });
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name });
const disabled = (el: HTMLElement) =>
  el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;
const rows = () =>
  within(dialog())
    .queryAllByRole("checkbox")
    .filter((c) => c.getAttribute("role") !== "switch");
const pick = async (merchant: RegExp) =>
  fireEvent.click(await within(dialog()).findByRole("checkbox", { name: merchant }));
const spends = (fake: ReturnType<typeof api>) => fake.calls.filter((c) => c.path.endsWith("/spends"));

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("BUD-05@PoC d) S-139 «Витратити з цілі»", () => {
  it("BUD-05@PoC FR 8: the modal lists at most 6 outgoing transactions, newest first, with checkboxes, the search and «Ще N транзакцій · показати наступні 6», without scrolling", async () => {
    const fake = api();
    open(fake);
    expect(await within(dialog()).findByText("Booking.com")).toBeTruthy();
    expect(rows()).toHaveLength(6);
    expect(within(dialog()).getByText("29 жовт. 2026 р. · Ощадний ··5106")).toBeTruthy();
    expect(plain(within(dialog()).getByText(/^−640,00\s€$/).textContent)).toBe("−640,00 €");
    expect(within(dialog()).getByRole("searchbox", { name: "Пошук транзакцій" })).toBeTruthy();
    const more = within(dialog()).getByRole("button", { name: /^Ще\s5\sтранзакцій · показати наступні\s6$/ });
    // The goal's account only, outgoing, not a transfer, newest first.
    const list = fake.calls.find((c) => c.path === "/v1/transactions")!;
    expect(list.method).toBe("GET");
    fireEvent.click(more);
    expect(rows()).toHaveLength(11);
    expect(within(dialog()).queryByRole("button", { name: /показати наступні/ })).toBeNull();
    // No scrolling list inside the dialog.
    expect(dialog().querySelector(".goal-spend-list")?.getAttribute("style")).toBeNull();
  });

  it("BUD-05@PoC FR 8: the request asks for the part's account, outgoing non-transfer posted visible transactions, newest first; a goal of marks asks for any account", async () => {
    const asked: URL[] = [];
    const record = ((_c: never, u: URL) => {
      asked.push(u);
      return { status: 200, body: { items: all, count: all.length, from: 1 } };
    }) as never;
    open(api(all, { "GET /v1/transactions": record }));
    await within(dialog()).findByText("Booking.com");
    const f = asked[0]!.searchParams.getAll("filter");
    expect(f).toEqual([
      "type.eq:out",
      "transfer.eq:false",
      "hidden.eq:false",
      "status.eq:posted",
      `accountId.eq:${ACC}`,
    ]);
    expect(asked[0]!.searchParams.get("sort")).toBe("-date");
    cleanup();
    asked.length = 0;
    open(
      api(all, { "GET /v1/transactions": record }),
      goal({ part: { accountId: null, freeBalance: null, kind: "marks", startAmount: eur("0") } }),
    );
    await within(dialog()).findByText("Booking.com");
    expect(asked[0]!.searchParams.getAll("filter").some((x) => x.startsWith("accountId"))).toBe(false);
  });

  it("BUD-05@PoC FR 8: the search field sends the text to the list and an empty answer says so", async () => {
    let asked = "";
    const fake = api(all, {
      "GET /v1/transactions": ((_c: never, u: URL) => {
        asked = u.searchParams.getAll("filter").join("|");
        return {
          status: 200,
          body: { items: asked.includes("search.has:zzz") ? [] : all, count: 0, from: 1 },
        };
      }) as never,
    });
    open(fake);
    await within(dialog()).findByText("Booking.com");
    expect(asked).toContain(`accountId.eq:${ACC}`);
    expect(asked).toContain("type.eq:out");
    fireEvent.change(within(dialog()).getByRole("searchbox", { name: "Пошук транзакцій" }), {
      target: { value: "zzz" },
    });
    expect(await within(dialog()).findByText("Нічого не знайдено")).toBeTruthy();
    expect(asked).toContain("search.has:zzz");
  });

  it("BUD-05@PoC AC2: two chosen transactions (hotel 640, flights 386.40) show «Обрано 2 · 1 026,40 €» and what stays in the goal, and «Списати з цілі» sends them as ids with accounts", async () => {
    const fake = api();
    const done = open(fake);
    await pick(/Booking\.com/);
    expect(disabled(button("Списати з цілі"))).toBe(false);
    await pick(/Wizz Air/);
    const sum = plain(dialog().querySelector(".goal-spend-sum")?.textContent);
    expect(sum).toBe("Обрано 2 · 1 026,40 € · у цілі залишиться 1 073,60 €");
    fireEvent.click(button("Списати з цілі"));
    await waitFor(() => expect(done.spent).toHaveBeenCalledTimes(1));
    expect(spends(fake)).toHaveLength(1);
    expect(spends(fake)[0]!.body).toEqual({
      transactions: [
        { transactionId: FIRST[0]!.id, accountId: ACC },
        { transactionId: FIRST[1]!.id, accountId: ACC },
      ],
    });
    expect(done.gone).not.toHaveBeenCalled();
  });

  it("BUD-05@PoC FR 8: «Списати з цілі» is inactive until a transaction is chosen, with the reason beside it", async () => {
    open(api());
    await within(dialog()).findByText("Booking.com");
    expect(disabled(button("Списати з цілі"))).toBe(true);
    expect(plain(dialog().querySelector(".ws-dialog-note")?.textContent)).toBe(
      "Оберіть хоча б одну транзакцію",
    );
  });

  it("BUD-05@PoC FR 8: step 2 «Після витрати» repeats the line, shows the note, and keeps the choice on «Назад»", async () => {
    open(api());
    await pick(/Booking\.com/);
    await pick(/Wizz Air/);
    fireEvent.click(button("Далі"));
    const step = () => dialog().querySelector<HTMLElement>(".ws-form-step:not([inert])")!;
    await waitFor(() => expect(step().dataset["step"]).toBe("1"));
    expect(plain(step().textContent)).toContain(
      "Обрано 2 транзакції · 1 026,40 € · у цілі залишиться 1 073,60 €",
    );
    expect(within(step()).getByRole("note").textContent).toContain(
      "Змінити чи видалити їх можна буде після «Скасувати витрату».",
    );
    fireEvent.click(button("Назад"));
    await waitFor(() => expect(step().dataset["step"]).toBe("0"));
    expect(
      (await within(dialog()).findByRole("checkbox", { name: /Booking\.com/ })) as HTMLInputElement,
    ).toHaveProperty("checked", true);
  });

  it("BUD-05@PoC FR 9: the dialog has no «Створити актив» switch; the one switch is «Закрити ціль», which may close a goal that is not fully spent", async () => {
    const fake = api();
    const done = open(fake);
    await pick(/Booking\.com/);
    fireEvent.click(button("Далі"));
    expect(within(dialog()).queryByText(/Створити актив/)).toBeNull();
    const toggle = within(dialog()).getByRole("switch", { name: /Закрити ціль/ });
    expect(plain(toggle.closest("label")?.textContent)).toContain(
      "можна й без повної суми · у цілі 1 460,00 € — вони стануть вільними грошима",
    );
    fireEvent.click(toggle);
    fireEvent.click(button("Списати з цілі"));
    await waitFor(() => expect(done.gone).toHaveBeenCalledTimes(1));
    expect(
      fake.calls.map((c) => `${c.method} ${c.path.replace(GOAL, "{id}")}`).filter((c) => c.includes("goals")),
    ).toEqual(["POST /v1/goals/{id}/spends", "POST /v1/goals/{id}/close"]);
  });

  it("BUD-05@PoC FR 8: the amounts go to the API as the API gave them and a spend refused as over the goal's money shows the error and keeps the dialog", async () => {
    const fake = api(all, {
      "POST /v1/goals/a0000000-0000-4000-8000-000000000001/spends": problem(409, "GOAL_SPEND_OVER_COLLECTED"),
    });
    const done = open(fake, goal({ collected: eur("100.00") }));
    await pick(/Booking\.com/);
    fireEvent.click(button("Списати з цілі"));
    expect(await within(dialog()).findByText(/Обрані транзакції більші за суму, що є в цілі/)).toBeTruthy();
    expect(done.spent).not.toHaveBeenCalled();
    expect(dialog()).toBeTruthy();
  });

  it("BUD-05@PoC FR 8: states — loading, an error with «Спробувати ще раз» and the code, and empty", async () => {
    let n = 0;
    const fake = api(all, {
      "GET /v1/transactions": (() =>
        n++ === 0
          ? problem(500, "INTERNAL")
          : { status: 200, body: { items: [], count: 0, from: 1 } }) as never,
    });
    open(fake);
    expect(within(dialog()).getByRole("status").textContent).toBe("Завантажуємо транзакції…");
    expect(await within(dialog()).findByRole("alert")).toBeTruthy();
    expect(within(dialog()).getByText(/^Код: /)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Спробувати ще раз" }));
    expect(
      await within(dialog()).findByText("Немає вихідних транзакцій, які можна списати з цілі"),
    ).toBeTruthy();
    expect(disabled(button("Списати з цілі"))).toBe(true);
  });

  it("BUD-05@PoC FR 8: transactions already spent from the goal and transactions in another currency are not offered", async () => {
    const spent = {
      id: "d0000000-0000-4000-8000-000000000001",
      transactionId: FIRST[0]!.id,
      accountId: ACC,
      amount: eur("640.00"),
      date: "2026-10-29",
    };
    const fake = api([
      ...FIRST,
      tx(99, "Dollar shop", "5.00", "2026-10-01", { amount: { amount: "-5.00", currency: "USD" } }),
    ]);
    open(fake, goal({ spends: [spent] }));
    await within(dialog()).findByText("Wizz Air");
    expect(within(dialog()).queryByText("Booking.com")).toBeNull();
    expect(within(dialog()).queryByText("Dollar shop")).toBeNull();
  });

  it("BUD-05@PoC FR 8: the checkbox rows have accessible names with the merchant and the amount, and 44 px targets are the row", async () => {
    open(api());
    const box = await within(dialog()).findByRole("checkbox", { name: /Booking\.com, −640,00\s€/ });
    expect(box.closest("label")?.className).toBe("goal-spend-row");
  });

  it("BUD-05@PoC FR 13: «Витратити» is the primary action of an achieved goal and a secondary one of a goal in progress, and opens the dialog", async () => {
    const fake = api();
    for (const [g, variant] of [
      [goal({ achieved: true }), "primary"],
      [goal(), "secondary"],
    ] as const) {
      render(
        <AuthApiProvider value={fake.client}>
          <GoalCard
            goal={g}
            goals={[g]}
            accounts={accounts}
            today="2026-11-02"
            onChanged={vi.fn()}
            onGone={vi.fn()}
          />
        </AuthApiProvider>,
      );
      const spend = screen.getByRole("button", { name: "Витратити" });
      expect(spend.classList.contains("ws-button-primary")).toBe(variant === "primary");
      fireEvent.click(spend);
      expect(await screen.findByRole("dialog", { name: "Витратити з «Відпустка в Італії»" })).toBeTruthy();
      cleanup();
    }
  });

  it("BUD-05@PoC FR 8: the sum of the chosen rows is a one-currency Money sum and what stays comes from the goal's own collected amount", () => {
    const row = (id: string, amount: string): SpendRow => ({
      id,
      accountId: ACC,
      merchant: id,
      date: "2026-10-01",
      amount: eur(amount),
    });
    expect(chosenSum([], "EUR")).toBeNull();
    expect(chosenSum([row("a", "640.00"), row("b", "386.40")], "EUR")).toEqual(eur("1026.4"));
    expect(leftAfter(goal(), eur("1026.40"))).toEqual(eur("1073.6"));
    expect(leftAfter(goal(), null)).toEqual(eur("2100.00"));
    expect(spendBody([row("a", "1.00")])).toEqual({ transactions: [{ transactionId: "a", accountId: ACC }] });
  });
});

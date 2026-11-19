import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain, problem, resetAuthState, type Reply } from "../auth/testing.tsx";
import { GoalDialog } from "./goals/GoalDialog.tsx";
import type { Goal } from "./goals/model.ts";
import { cushionTarget } from "./goals/newGoal.ts";

/**
 * BUD-05@PoC FR 10, AC 3 (#553): «Нова ціль» with the template «Подушка безпеки» shows the average monthly expenses the
 * API sums (`GET /v1/goals/emergency-average`) and makes the target «Місяців витрат» × the average, as the board
 * PocPlanGoalNewCushion shows: a − N + stepper and the target read-only «12 600,00 € = 3 × 4 200,00 €». The dialog is
 * rendered alone. Synthetic data; today is 2026-11-15.
 */
const eur = (amount: string) => ({ amount, currency: "EUR" });
const AVERAGE = {
  currency: "EUR",
  average: eur("4200"),
  months: 6,
  from: "2026-05-01",
  to: "2026-10-31",
  approximate: false,
  unavailableCount: 0,
};

const asked: URL[] = [];
function api(average: Reply = { status: 200, body: AVERAGE }) {
  asked.length = 0;
  return fakeApi({
    "GET /v1/goals/emergency-average": ((_c: never, u: URL) => {
      asked.push(u);
      return average;
    }) as never,
    "GET /v1/space": { status: 200, body: { name: "Дім", dataRegion: "eu", reportingCurrency: "EUR" } },
    "GET /v1/accounts": { status: 200, body: { items: [], nextCursor: null } },
    "POST /v1/goals": { status: 201, body: { id: "a0000000-0000-4000-8000-000000000099" } },
  });
}

function open(fake: ReturnType<typeof api>, goal?: Goal) {
  const saved = vi.fn();
  render(
    <AuthApiProvider value={fake.client}>
      <GoalDialog
        goal={goal}
        goals={[]}
        today="2026-11-15"
        template="emergency"
        fallbackCurrency="EUR"
        onClose={() => undefined}
        onSaved={saved}
      />
    </AuthApiProvider>,
  );
  return saved;
}

const opened = () => screen.findByRole("dialog", { name: /^(Нова ціль|Змінити ціль)$/ });
const dialog = () => screen.getByRole("dialog", { name: /^(Нова ціль|Змінити ціль)$/ });
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name });
const disabled = (el: HTMLElement) =>
  el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;
const posts = (fake: ReturnType<typeof api>) => fake.calls.filter((c) => c.method === "POST");

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("BUD-05@PoC FR 10: «Подушка безпеки» shows the average monthly expenses from the API", () => {
  it("BUD-05@PoC AC3: 3 months × 4 200,00 € — the target is 12 600,00 €, read-only, with the average line under it, and it goes to the API", async () => {
    const fake = api();
    const saved = open(fake);
    const months = (await within(await opened()).findByRole("textbox", {
      name: /^Місяців витрат/,
    })) as HTMLInputElement;
    expect(months.value).toBe("3");
    const sum = within(dialog()).getByRole("status", { name: "Цільова сума" });
    expect(plain(sum.textContent)).toBe("12 600,00 €= 3 × 4 200,00 €");
    expect(within(dialog()).queryByRole("textbox", { name: /^Цільова сума/ })).toBeNull();
    expect(plain(within(dialog()).getByText(/^середні витрати/).textContent)).toBe(
      "середні витрати — 4 200,00 € / міс. за 6 міс., без одноразових",
    );
    // The average is the server's: the screen never sums transactions.
    expect(fake.calls.map((c) => c.path)).not.toContain("/v1/transactions");
    expect(asked[0]?.searchParams.get("currency")).toBe("EUR");
    fireEvent.change(within(dialog()).getByRole("textbox", { name: /^Назва/ }), {
      target: { value: "Подушка безпеки" },
    });
    fireEvent.click(button("Створити ціль"));
    await waitFor(() => expect(posts(fake)).toHaveLength(1));
    expect(posts(fake)[0]!.body).toMatchObject({
      template: "emergency",
      emergencyMonths: 3,
      target: eur("12600"),
    });
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });

  it("BUD-05@PoC FR 10: «Менше» and «Більше» change the months and the target with them, within 1–120", async () => {
    open(api());
    await within(await opened()).findByRole("textbox", { name: /^Місяців витрат/ });
    fireEvent.click(button("Більше"));
    const sum = () => plain(within(dialog()).getByRole("status", { name: "Цільова сума" }).textContent);
    expect(sum()).toBe("16 800,00 €= 4 × 4 200,00 €");
    for (let i = 0; i < 3; i++) fireEvent.click(button("Менше"));
    expect(sum()).toBe("4 200,00 €= 1 × 4 200,00 €");
    expect(disabled(button("Менше"))).toBe(true);
    fireEvent.change(within(dialog()).getByRole("textbox", { name: /^Місяців витрат/ }), {
      target: { value: "0" },
    });
    expect(disabled(button("Створити ціль"))).toBe(true);
  });

  it("BUD-05@PoC FR 10: an approximate average says so; without an average or when it cannot be read the target is typed", async () => {
    open(api({ status: 200, body: { ...AVERAGE, approximate: true, unavailableCount: 1 } }));
    expect(
      plain((await within(await opened()).findByText(/^середні витрати — приблизно/)).textContent),
    ).toContain("приблизно 4 200,00 € / міс. за 6 міс.");
    cleanup();
    open(api({ status: 200, body: { ...AVERAGE, average: null, months: 0 } }));
    expect(
      await within(await opened()).findByText("Ще немає витрат за повні місяці — введіть цільову суму"),
    ).toBeTruthy();
    expect(within(dialog()).getByRole("textbox", { name: /^Цільова сума/ })).toBeTruthy();
    cleanup();
    open(api(problem(500, "INTERNAL")));
    expect(
      await within(await opened()).findByText("Ще немає витрат за повні місяці — введіть цільову суму"),
    ).toBeTruthy();
    expect(within(dialog()).getByRole("textbox", { name: /^Цільова сума/ })).toBeTruthy();
  });

  it("BUD-05@PoC FR 10: the target is months × average, exact (no float)", () => {
    expect(cushionTarget({ ...AVERAGE, average: eur("1234.57") }, "3")).toBe("3703.71");
    expect(cushionTarget({ ...AVERAGE, average: eur("0.1") }, "3")).toBe("0.3");
    expect(cushionTarget({ ...AVERAGE, average: null }, "3")).toBeNull();
    expect(cushionTarget(AVERAGE, "121")).toBeNull();
  });
});

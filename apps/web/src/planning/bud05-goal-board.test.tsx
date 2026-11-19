import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Icon } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, resetAuthState } from "../auth/testing.tsx";
import { GoalCard } from "./goals/GoalCard.tsx";
import { GoalLinks } from "./goals/GoalLinks.tsx";
import { GoalList } from "./goals/GoalList.tsx";
import { TEMPLATE_ICON, type Goal } from "./goals/model.ts";
import { TEMPLATES } from "./goals/newGoal.ts";

/**
 * BUD-05@PoC (issue #583, «Цілі» against the board PocPlanGoalCard, PocPlanGoalCardAchieved, PocPlanGoals): one test
 * per item of the issue. Only GoalCard, GoalLinks and GoalList are rendered, alone, on synthetic goals; the page
 * layout is the CSS file read as text.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "goals", "goals.css"), "utf8");
const rule = (selector: string) =>
  new RegExp(`${selector.replace(/[.[\]="]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const eur = (amount: string) => ({ amount, currency: "EUR" });
const ACC = "b0000000-0000-4000-8000-000000000001";
const accounts = new Map([
  [ACC, { id: ACC, label: "Ощадний", mask: "··5106", selectable: true, currency: "EUR" }],
]);

function goal(over: Record<string, unknown> = {}): Goal {
  return {
    achieved: false,
    canContribute: true,
    collected: eur("2100.00"),
    contributedThisMonth: eur("250.00"),
    contributions: [
      { id: "c0000000-0000-4000-8000-000000000001", date: "2026-11-01", amount: eur("250.00") },
    ],
    createdOn: "2026-07-14",
    emergencyMonths: null,
    forecastDate: "2027-06-15",
    id: "a0000000-0000-4000-8000-000000000001",
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

function card(g: Goal) {
  const fake = fakeApi({});
  return render(
    <AuthApiProvider value={fake.client}>
      <GoalCard
        goal={g}
        goals={[g]}
        accounts={accounts}
        today="2026-11-02"
        onChanged={() => {}}
        onGone={() => {}}
      >
        <GoalLinks goal={g} accounts={accounts} />
      </GoalCard>
    </AuthApiProvider>,
  );
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});
afterEach(cleanup);

describe("BUD-05@PoC FR 4 (#583 board items)", () => {
  it("BUD-05@PoC FR 4, board item 1: «Внести» comes first, then «Витратити», both with an icon, an 8 px gap between them", () => {
    card(goal());
    const buttons = [...document.querySelectorAll(".goal-card-actions button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Внести", "Витратити"]);
    expect(buttons.every((b) => b.querySelector("svg") !== null)).toBe(true);
    expect(rule(".goal-card-actions")).toContain("gap: var(--ws-space-2);");
  });

  it("BUD-05@PoC FR 4, board item 1: on an achieved goal «Витратити» is first and primary (PocPlanGoalCardAchieved)", () => {
    card(goal({ achieved: true, progressPercent: "100", collected: eur("4000.00") }));
    const buttons = [...document.querySelectorAll(".goal-card-actions button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Витратити", "Внести"]);
    expect(buttons[0]?.className).toContain("primary");
  });

  it("BUD-05@PoC FR 4, board item 2: the empty «Проєкція» slot is not shown until the chart exists", () => {
    expect(rule('.plan-region[data-plan-region="projection"][data-empty]')).toContain("display: none;");
  });

  it("BUD-05@PoC FR 4, board item 3: «Де лежать гроші» and «Внески» are sections of the one goal card, not cards of their own", () => {
    card(goal());
    const section = screen.getByRole("region", { name: "Відпустка в Італії" });
    const where = within(section).getByRole("heading", { name: "Де лежать гроші" }).closest("section")!;
    const history = within(section).getByRole("heading", { name: "Внески" }).closest("section")!;
    for (const s of [where, history]) {
      expect(s.classList.contains("ws-card")).toBe(false);
      expect(section.contains(s)).toBe(true);
    }
    expect(rule(".goal-links")).toContain("border-block-start: 1px solid var(--ws-line);");
  });

  it("BUD-05@PoC FR 4, board item 4: the date, the required contribution, the forecast and the pace are tiles with a label, a value and a hint", () => {
    card(goal());
    const tiles = [...document.querySelectorAll(".goal-fact")];
    expect(tiles.map((t) => t.querySelector("dt")?.textContent)).toEqual([
      "Дата",
      "Потрібний внесок",
      "Прогноз",
      "Темп",
    ]);
    expect(tiles[1]?.querySelector("dd b")?.textContent).toMatch(/238/);
    expect(tiles[1]?.querySelector("dd span")?.textContent).toBeTruthy();
    expect(rule(".goal-fact")).toContain("background: var(--ws-surface-100);");
  });

  it("BUD-05@PoC FR 4, board item 5: the percent is the last item of the amount line, pushed to the right", () => {
    card(goal());
    const sum = document.querySelector(".goal-card-sum")!;
    expect(sum.lastElementChild?.textContent).toBe("52,5 %");
    expect(sum.lastElementChild?.classList.contains("goal-card-percent")).toBe(true);
    expect(rule(".goal-card-percent")).toContain("margin-inline-start: auto;");
  });

  it("BUD-05@PoC FR 13, board item 6: the header has the pencil «Змінити ціль» before «Ще дії»", () => {
    card(goal());
    const head = document.querySelector(".goal-card-head")!;
    const names = [...head.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Змінити ціль", "Ще дії"]);
  });

  it("BUD-05@PoC FR 1, board item 7: every row of the list has the icon of its template", () => {
    render(
      <GoalList
        goals={[
          goal(),
          goal({ id: "a0000000-0000-4000-8000-000000000002", name: "Подушка", template: "emergency" }),
        ]}
        selected="a0000000-0000-4000-8000-000000000001"
        onSelect={() => {}}
      />,
    );
    const rows = [...document.querySelectorAll(".goal-row")];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.querySelector(".goal-row-icon svg")).not.toBeNull();
    expect(rows[0]?.querySelector(".goal-row-icon svg")?.outerHTML).not.toBe(
      rows[1]?.querySelector(".goal-row-icon svg")?.outerHTML,
    );
  });

  it("BUD-05@PoC FR 1, board item 7: each of the four templates has its own glyph — plane, bag, shield, target — not map or card, and not the «Страхування» glyph", () => {
    const drawn = TEMPLATES.map((template, i) => {
      const { container, unmount } = render(
        <GoalList
          goals={[goal({ id: `a0000000-0000-4000-8000-00000000010${i}`, template })]}
          selected=""
          onSelect={() => {}}
        />,
      );
      const html = container.querySelector(".goal-row-icon svg")!.outerHTML;
      unmount();
      return html;
    });
    expect(new Set(drawn).size).toBe(TEMPLATES.length);
    expect(TEMPLATE_ICON).toEqual({
      travel: "plane",
      purchase: "bag",
      emergency: "shield",
      custom: "target",
    });
  });

  it("BUD-05@PoC FR 4, board item 1: «Витратити» carries the wallet glyph of the board", () => {
    card(goal());
    const spend = screen.getByRole("button", { name: "Витратити" });
    const wallet = render(<Icon name="budget" size={16} />).container.querySelector("svg")!.innerHTML;
    expect(spend.querySelector("svg")?.innerHTML).toBe(wallet);
  });
});

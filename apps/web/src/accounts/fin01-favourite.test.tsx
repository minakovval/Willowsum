import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CATALOGUES } from "@willowsum/i18n";
import { colors, contrastRatio } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
import { plain, problem, renderAt, resetAuthState, type Reply } from "../auth/testing.tsx";
import type { Account, AccountsSummary } from "./api.ts";

/**
 * FIN-01@PoC FR 20 on S-050 «Рахунки» (canvas PocMoneyAccounts and its «Тексти» board): the «Обране» star before
 * each account; a starred account is shown at the top of its group; the star's tooltip and name are «Додати в
 * обране» / «Прибрати з обраного»; `PATCH /v1/accounts/{id}/display` stores it. Synthetic accounts only.
 */
const eur = (amount: string) => ({ amount, currency: "EUR" });
let n = 0;
const id = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;

function account(over: Partial<Account> & Pick<Account, "name">): Account {
  const balance = over.currencies?.[0]?.amount ?? eur("100.00");
  return {
    id: id(),
    kind: "current",
    group: "cash",
    institution: null,
    number: null,
    status: "active",
    closedOn: null,
    source: "manual",
    updatedOn: "2026-11-01",
    favourite: false,
    inProfileCurrency: { total: balance, approximate: false, unavailableCount: 0 },
    currencies: [
      {
        currency: balance.currency,
        amount: balance,
        equivalent: balance,
        rateDate: null,
        approximate: false,
        restricted: false,
      },
    ],
    creditCard: null,
    loan: null,
    ...over,
  };
}

const summary: AccountsSummary = {
  currency: "EUR",
  cash: { total: eur("300.00"), approximate: false, unavailableCount: 0 },
  moneyTogether: {
    total: eur("300.00"),
    approximate: false,
    unavailableCount: 0,
    staleRateCount: 0,
    rate: { source: "NBU", date: "2026-11-02" },
    breakdown: [],
  },
  credit: {
    cardDebt: { total: eur("0.00"), approximate: false, unavailableCount: 0 },
    loanDebt: { total: null, approximate: false, unavailableCount: 0 },
  },
  sources: { import: 0, manual: 3 },
};

interface Patch {
  readonly id: string;
  readonly body: unknown;
}

/** The page's two reads and the star's `PATCH …/display`; `reply` answers each PATCH (default: the account after). */
function api(items: Account[], reply?: (patch: Patch) => Reply | Promise<Reply>) {
  const patches: Patch[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    let answer: Reply | undefined;
    const star = /^\/v1\/accounts\/([^/]+)\/display$/.exec(url.pathname);
    if (request.method === "GET" && url.pathname === "/v1/accounts")
      answer = {
        status: 200,
        body: {
          items: url.search.includes("includeClosed=true")
            ? items
            : items.filter((a) => a.status === "active"),
          nextCursor: null,
        },
      };
    else if (request.method === "GET" && url.pathname === "/v1/accounts/summary")
      answer = { status: 200, body: summary };
    else if (request.method === "PATCH" && star) {
      const patch = { id: star[1]!, body: JSON.parse(await request.text()) as unknown };
      patches.push(patch);
      const found = items.find((a) => a.id === patch.id)!;
      answer = reply ? await reply(patch) : { status: 200, body: { ...found, ...(patch.body as object) } };
    }
    if (answer === undefined || answer === "network") return new Response(null, { status: 599 });
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  };
  return { client: createAuthClient(fetchImpl as typeof fetch), patches };
}

const group = (name: string) => screen.getByRole("region", { name });
/** The account names of a group's rows, top to bottom. */
const names = (groupName: string) =>
  within(group(groupName))
    .getAllByRole("row")
    .slice(1)
    .map((r) => plain(r.querySelector("strong")?.textContent));
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("FIN-01@PoC FR 20: the «Обране» star on «Рахунки»", () => {
  it("FIN-01@PoC FR 20: a starred account is shown at the top of its group; the others keep their order", async () => {
    const daily = account({ name: "Щоденний" });
    const savings = account({ name: "Скарбничка", kind: "savings" });
    const cash = account({ name: "Готівка", kind: "cash", favourite: true });
    const card = account({ name: "Кредитна", kind: "credit-card", group: "credit" });
    const loan = account({ name: "Іпотека", kind: "loan", group: "credit", favourite: true });
    renderAt("#/money/accounts", api([daily, savings, cash, card, loan]).client);
    await screen.findByText("Щоденний");
    expect(names("Готівкові")).toEqual(["Готівка", "Щоденний", "Скарбничка"]);
    expect(names("Кредитні")).toEqual(["Іпотека", "Кредитна"]);
  });

  it("FIN-01@PoC FR 20: the star's name and tooltip are «Додати в обране» on an account outside «Обране» and «Прибрати з обраного» on a starred one", async () => {
    renderAt(
      "#/money/accounts",
      api([account({ name: "Щоденний" }), account({ name: "Готівка", favourite: true })]).client,
    );
    await screen.findByText("Щоденний");
    const off = within(rowOf("Щоденний")).getByRole("button", { name: "Додати в обране" });
    const on = within(rowOf("Готівка")).getByRole("button", { name: "Прибрати з обраного" });
    fireEvent.mouseEnter(off);
    expect(plain((await screen.findByRole("tooltip")).textContent)).toContain("Додати в обране");
    fireEvent.mouseLeave(off);
    fireEvent.mouseEnter(on);
    await waitFor(() =>
      expect(plain(screen.getByRole("tooltip").textContent)).toContain("Прибрати з обраного"),
    );
    // The state is in the name, not in a colour alone: the starred one is drawn filled.
    expect(on.closest(".accounts-star")?.classList.contains("accounts-star--on")).toBe(true);
    expect(off.closest(".accounts-star")?.classList.contains("accounts-star--on")).toBe(false);
  });

  it("FIN-01@PoC FR 20: the star stores «Обране» and moves the account to the top of its group; again — back to its place", async () => {
    const daily = account({ name: "Щоденний" });
    const savings = account({ name: "Скарбничка", kind: "savings" });
    const { client, patches } = api([daily, savings]);
    renderAt("#/money/accounts", client);
    await screen.findByText("Скарбничка");
    expect(names("Готівкові")).toEqual(["Щоденний", "Скарбничка"]);

    fireEvent.click(within(rowOf("Скарбничка")).getByRole("button", { name: "Додати в обране" }));
    await waitFor(() => expect(names("Готівкові")).toEqual(["Скарбничка", "Щоденний"]));
    expect(patches).toEqual([{ id: savings.id, body: { favourite: true } }]);
    const star = within(rowOf("Скарбничка")).getByRole("button", { name: "Прибрати з обраного" });
    // The focus stays on the star that moved with its row.
    await waitFor(() => expect(document.activeElement).toBe(star));

    fireEvent.click(star);
    await waitFor(() => expect(names("Готівкові")).toEqual(["Щоденний", "Скарбничка"]));
    expect(patches.at(-1)).toEqual({ id: savings.id, body: { favourite: false } });
    expect(within(rowOf("Скарбничка")).getByRole("button", { name: "Додати в обране" })).toBeTruthy();
  });

  it("FIN-01@PoC FR 20: a refused change puts the star and the order back and says so; the list stays", async () => {
    const daily = account({ name: "Щоденний" });
    const savings = account({ name: "Скарбничка", kind: "savings" });
    let answer!: (r: Reply) => void;
    const { client, patches } = api(
      [daily, savings],
      () => new Promise<Reply>((resolve) => (answer = resolve)),
    );
    renderAt("#/money/accounts", client);
    await screen.findByText("Скарбничка");
    const star = within(rowOf("Скарбничка")).getByRole("button", { name: "Додати в обране" });
    fireEvent.click(star);
    await waitFor(() => expect(names("Готівкові")).toEqual(["Скарбничка", "Щоденний"]));
    // A second press while the first is on its way sends nothing.
    fireEvent.click(within(rowOf("Скарбничка")).getByRole("button", { name: "Прибрати з обраного" }));
    expect(patches).toHaveLength(1);
    await act(async () => answer(problem(503, "MODULE_UNAVAILABLE")));
    await waitFor(() => expect(names("Готівкові")).toEqual(["Щоденний", "Скарбничка"]));
    expect(within(rowOf("Скарбничка")).getByRole("button", { name: "Додати в обране" })).toBeTruthy();
    expect(plain(screen.getByRole("alert").textContent)).toContain(
      "Не вдалося змінити «Обране». Спробуйте ще раз.",
    );
    expect(screen.getByText("Щоденний")).toBeTruthy();
  });

  it("FIN-01@PoC FR 20: a closed account shown with «Показати закриті» has its star too", async () => {
    const closed = account({ name: "Старий", status: "closed", closedOn: "2026-09-30", favourite: true });
    renderAt("#/money/accounts", api([account({ name: "Щоденний" }), closed]).client);
    await screen.findByText("Щоденний");
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Показати закриті" }));
    await screen.findByText("Старий");
    expect(within(rowOf("Старий")).getByRole("button", { name: "Прибрати з обраного" })).toBeTruthy();
    expect(names("Готівкові")).toEqual(["Старий", "Щоденний"]);
  });

  it("FIN-01@PoC FR 20: a starred star is filled in the brand colour (not the accent, DS-06 AC4), 3:1 on the card (WCAG 1.4.11); the empty one is muted", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "accounts.css"), "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(css).toContain(
      ".accounts-star--on .ws-icon-button { color: var(--ws-brand); } .accounts-star--on svg { fill: currentcolor; }",
    );
    expect(contrastRatio(colors.brand.light, colors["surface-200"].light)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors["ink-muted"].light, colors["surface-200"].light)).toBeGreaterThanOrEqual(3);
  });

  it("FIN-01@PoC FR 20: in English the star reads «Add to favourites» / «Remove from favourites»", async () => {
    const en = CATALOGUES.en;
    expect(en["accounts.favourite.add"]).toBe("Add to favourites");
    expect(en["accounts.favourite.remove"]).toBe("Remove from favourites");
    expect(en["accounts.favourite.error"]).toBe("Couldn't change favourites. Please try again.");
  });
});

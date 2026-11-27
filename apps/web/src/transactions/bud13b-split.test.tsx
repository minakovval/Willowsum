import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { colors, contrastRatio } from "@willowsum/ui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { fakeApi, plain, problem } from "../auth/testing.tsx";
import { splitAction, type SplitCategory, type Transaction } from "./api.ts";
import { evaluate } from "./calc.ts";
import { SplitDialog } from "./SplitDialog.tsx";
import { monthShares, roundParts } from "./split.ts";
import { Decimal } from "@willowsum/domain-kernel";

/**
 * BUD-13@PoC b) / FIN-03@PoC e) (wave 2, row 117): «Розділити транзакцію» (S-049; boards PocMoneySplit,
 * PocMoneySplitMonths) on the merged split API of #297.
 */
const TX_ID = "70000000-0000-4000-8000-000000000001";
const CAT = {
  food: "c0000000-0000-4000-8000-000000000001",
  home: "c0000000-0000-4000-8000-000000000002",
  pharmacy: "c0000000-0000-4000-8000-000000000003",
  car: "c0000000-0000-4000-8000-000000000004",
  salary: "c0000000-0000-4000-8000-000000000005",
};
const CATEGORIES: SplitCategory[] = [
  { id: CAT.food, name: "Продукти", kind: "expense" },
  { id: CAT.home, name: "Дім", kind: "expense" },
  { id: CAT.pharmacy, name: "Аптека", kind: "expense" },
  { id: CAT.car, name: "Страховка авто", kind: "expense" },
  { id: CAT.salary, name: "Зарплата", kind: "income" },
];

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: TX_ID,
    accountId: "9b0e7a6e-0000-4000-8000-000000000002",
    amount: { amount: "-132.40", currency: "EUR" },
    type: "expense",
    date: "2026-03-01",
    counterparty: "Leroy Merlin",
    description: null,
    status: "posted",
    source: "manual",
    hidden: false,
    split: null,
    transfer: null,
    mergedInto: null,
    mergedDuplicates: [],
    note: null,
    tags: [],
    oneOff: false,
    oneSidedTransfer: null,
    review: null,
    version: 1,
    recordedAt: "2026-03-01T10:00:00Z",
    bankDescription: null,
    balanceAfter: null,
    importedFrom: null,
    originalAmount: null,
    exchangeRate: null,
    valueDate: null,
    bankReference: null,
    bankFee: null,
    ...over,
  };
}

const URL_SPLIT = `POST /v1/transactions/${TX_ID}/split`;

/** What the details screen does: «Розділити» opens the dialog with `splitAction`; the saved transaction comes back. */
function Opener({
  start,
  client,
  saved,
}: {
  start: Transaction;
  client: Client;
  saved: (t: Transaction) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Розділити
      </button>
      {open ? (
        <SplitDialog
          transaction={start}
          summary="Страховка авто · −1 200,00 €"
          categories={CATEGORIES}
          onSave={splitAction(client, TX_ID)}
          onSaved={(t) => {
            setOpen(false);
            saved(t);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

type Client = ReturnType<typeof fakeApi>["client"];
function renderOpener(start: Transaction, client: Client = fakeApi({}).client, saved = vi.fn()) {
  render(
    <I18nProvider initialLocale="uk">
      <Opener start={start} client={client} saved={saved} />
    </I18nProvider>,
  );
  const opener = screen.getByRole("button", { name: "Розділити" });
  opener.focus();
  fireEvent.click(opener);
  return { opener, saved };
}

function renderDialog(start: Transaction, onSave = vi.fn(), onClose = vi.fn()) {
  render(
    <I18nProvider initialLocale="uk">
      <SplitDialog
        transaction={start}
        summary="Leroy Merlin · −132,40 €"
        categories={CATEGORIES}
        onSave={onSave}
        onSaved={vi.fn()}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { dialog: screen.getByRole("dialog", { name: "Розділити транзакцію" }), onSave, onClose };
}

const amountField = (n: number) => screen.getByRole("textbox", { name: `Сума частини ${String(n)}` });
const categoryField = (n: number) => screen.getByRole("combobox", { name: `Категорія частини ${String(n)}` });
const saveButton = () => screen.getByRole("button", { name: /^Зберегти$|^Зберігаємо/ });
const value = (el: HTMLElement) => (el as HTMLInputElement).value;
const description = (el: HTMLElement) =>
  plain(document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent);
const status = () => plain(screen.getByRole("status").textContent);

afterEach(cleanup);

describe("BUD-13@PoC b): «Розділити транзакцію» (S-049)", () => {
  it("BUD-13@PoC FR 6: two modes, each with its explanation under the title, as radio buttons", () => {
    renderDialog(tx());
    const group = screen.getByRole("group", { name: "Як розділити" });
    const byCategory = within(group).getByRole("radio", { name: "За категоріями" });
    expect((byCategory as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Одна оплата — кілька категорій/)).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: "На кілька місяців" }));
    expect(screen.getByText(/Бюджет кожного місяця бачить свою частку/)).toBeTruthy();
    expect(value(screen.getByLabelText(/^Починаючи з/))).toBe("2026-03");
    expect(value(screen.getByLabelText(/^Місяців/))).toBe("12");
    expect(screen.getByLabelText(/^Категорія$/)).toBeTruthy();
  });

  it("BUD-13@PoC AC3: «132,40-85-12,40» and «=» give 35,00 €; «Залишилось 12,40 €» keeps «Зберегти» inactive until «Аптека 12,40 €»", async () => {
    const { onSave } = renderDialog(tx(), vi.fn().mockResolvedValue({ ok: true, data: tx() }));
    fireEvent.change(categoryField(1), { target: { value: CAT.food } });
    fireEvent.change(amountField(1), { target: { value: "85,00" } });
    fireEvent.change(categoryField(2), { target: { value: CAT.home } });
    fireEvent.change(amountField(2), { target: { value: "132,40-85-12,40" } });
    fireEvent.keyDown(amountField(2), { key: "=" });
    expect(value(amountField(2))).toBe("35,00");
    expect(status()).toContain("Залишилось 12,40 €");
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Сума частин має дорівнювати 132,40 €.")).toBeTruthy();
    expect(description(saveButton())).toBe("Сума частин має дорівнювати 132,40 €.");
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Додати частину" }));
    fireEvent.change(categoryField(3), { target: { value: CAT.pharmacy } });
    fireEvent.change(amountField(3), { target: { value: "12,40" } });
    expect(status()).toContain("Розподілено 132,40 € з 132,40 €. Можна зберегти.");
    expect(saveButton().hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // The parts carry the transaction's sign.
    expect(onSave).toHaveBeenCalledWith({
      mode: "categories",
      parts: [
        { categoryId: CAT.food, amount: "-85" },
        { categoryId: CAT.home, amount: "-35" },
        { categoryId: CAT.pharmacy, amount: "-12.4" },
      ],
    });
  });

  it("BUD-13@PoC FR 7: the amount field calculates + − × ÷ and brackets; «Залишилось розподілити» follows each key", () => {
    expect(evaluate("(10+5)×2÷3")?.toFixed()).toBe("10");
    expect(evaluate("100−20*2/4")?.toFixed()).toBe("90");
    expect(evaluate("-(2,5+0,5)")?.toFixed()).toBe("-3");
    expect(evaluate("1 234,50")?.toFixed()).toBe("1234.5");
    expect(evaluate("1,234.50", false)?.toFixed()).toBe("1234.5");
    expect(evaluate("5/0")).toBeNull();
    expect(evaluate("5+")).toBeNull();
    expect(evaluate("(5")).toBeNull();
    renderDialog(tx());
    fireEvent.change(amountField(1), { target: { value: "(100+32,40)/2" } });
    expect(status()).toContain("Залишилось 66,20 €");
    fireEvent.change(amountField(1), { target: { value: "(100+32,40)/2+70" } });
    expect(status()).toContain("Забагато на 3,80 €");
    fireEvent.keyDown(amountField(1), { key: "Enter" });
    expect(value(amountField(1))).toBe("136,20");
  });

  it("BUD-13@PoC FR 6: in «За категоріями» the rounding remainder goes to the first part", () => {
    const d = (v: string) => new Decimal(v);
    const third = d("100").div(d("3"));
    expect(roundParts([third, third, third], d("100"), "EUR").map((x) => x.toFixed(2))).toEqual([
      "33.34",
      "33.33",
      "33.33",
    ]);
    // Parts that do not make the amount are not adjusted.
    expect(roundParts([d("10"), d("20")], d("100"), "EUR").map((x) => x.toFixed(2))).toEqual([
      "10.00",
      "20.00",
    ]);
  });

  it("BUD-13@PoC FR 6: part amounts are rounded half to even (0,125 → 0,12; 0,135 → 0,14), not half up", () => {
    const d = (v: string) => new Decimal(v);
    expect(roundParts([d("0.125")], d("5"), "EUR").map((x) => x.toFixed(2))).toEqual(["0.12"]);
    expect(roundParts([d("0.135")], d("5"), "EUR").map((x) => x.toFixed(2))).toEqual(["0.14"]);
  });

  it("BUD-13@PoC FR 6 (security): the remainder in JPY and KWD; at half a minor unit off nothing is moved; months towards zero", () => {
    const d = (v: string) => new Decimal(v);
    const third = d("10").div(d("3"));
    const fixed = (xs: Decimal[]) => xs.map((x) => x.toFixed());
    expect(fixed(roundParts([third, third, third], d("10"), "JPY"))).toEqual(["4", "3", "3"]);
    expect(fixed(roundParts([third, third, third], d("10"), "KWD"))).toEqual(["3.334", "3.333", "3.333"]);
    expect(fixed(roundParts([d("2.5"), d("3.5")], d("6"), "JPY"))).toEqual(["2", "4"]);
    // Exact values 0,006 € and 0,005 € short of 10 €: not a rounding remainder, the parts stay as they are.
    expect(fixed(roundParts([d("5"), d("4.994")], d("10"), "EUR"))).toEqual(["5", "4.99"]);
    expect(fixed(roundParts([d("1.005"), d("1.005"), d("7.985")], d("10"), "EUR"))).toEqual([
      "1",
      "1",
      "7.98",
    ]);
    // «На кілька місяців» is not half to even: 0,05 € ÷ 3 = 0,0167 → 0,01 (towards zero), the rest in the last share.
    const shares = (v: string, c: string, n: number) =>
      monthShares(d(v), c, "2026-01", n)?.map((s) => s.amount.toFixed());
    expect(shares("0.05", "EUR", 3)).toEqual(["0.01", "0.01", "0.03"]);
    expect(shares("200", "JPY", 3)).toEqual(["66", "66", "68"]);
    expect(shares("0.002", "KWD", 3)).toBeUndefined();
  });

  it("BUD-13@PoC FR 6 (security): a part that rounds to 0 keeps «Зберегти» inactive; an untouched first field keeps its text", () => {
    renderDialog(tx({ amount: { amount: "-10.00", currency: "EUR" } }));
    fireEvent.change(categoryField(1), { target: { value: CAT.food } });
    fireEvent.change(categoryField(2), { target: { value: CAT.home } });
    // 0,125 rounds to 0,12 by the same rule in the field check: leaving part 2 does not rewrite part 1.
    fireEvent.change(amountField(1), { target: { value: "0,125" } });
    fireEvent.change(amountField(2), { target: { value: "1" } });
    fireEvent.blur(amountField(2));
    expect(value(amountField(1))).toBe("0,125");
    // 0,004 € + 9,996 € make 10,00 € exactly, but the first part would be saved as 0,00 €.
    fireEvent.change(amountField(1), { target: { value: "0,004" } });
    fireEvent.change(amountField(2), { target: { value: "9,996" } });
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("BUD-13@PoC AC5: −100,00 € on 3 months — 33,33 €, 33,33 € and 33,34 €, «3 частини по 33,33 € · <період>»", () => {
    renderDialog(tx({ amount: { amount: "-100.00", currency: "EUR" } }));
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(screen.getByLabelText(/^Місяців/), { target: { value: "3" } });
    const rows = screen.getAllByRole("listitem").map((li) => plain(li.textContent));
    expect(rows).toEqual([
      "1Березень 202633,33 €",
      "2Квітень 202633,33 €",
      "3Травень 2026остання частина отримує копійки округлення33,34 €",
    ]);
    expect(plain(screen.getByText(/частини по/).closest("p")!.textContent)).toBe(
      "3 частини по 33,33 € · березень 2026 – травень 2026",
    );
  });

  it("BUD-13@PoC AC8: 36 months — shares 1 and 2, «3–35 · ще 33 частини по 33,33 €», share 36 of 33,45 € with the note; no scroll", () => {
    renderDialog(tx({ amount: { amount: "-1200.00", currency: "EUR" } }));
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(screen.getByLabelText(/^Місяців/), { target: { value: "36" } });
    const rows = screen.getAllByRole("listitem").map((li) => plain(li.textContent));
    expect(rows).toEqual([
      "1Березень 202633,33 €",
      "2Квітень 202633,33 €",
      "⋯3–35 · ще 33 частини по 33,33 €",
      "36Лютий 2029остання частина отримує копійки округлення33,45 €",
    ]);
    expect(plain(screen.getByText(/частин по/).closest("p")!.textContent)).toBe(
      "36 частин по 33,33 € · березень 2026 – лютий 2029",
    );
  });

  it("BUD-13@PoC EC3: 60 months show the same four lines as 12 — the schedule never grows, the dialog is at most 624 px", () => {
    renderDialog(tx({ amount: { amount: "-1200.00", currency: "EUR" } }));
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    for (const n of ["4", "12", "60"]) {
      fireEvent.change(screen.getByLabelText(/^Місяців/), { target: { value: n } });
      expect(screen.getAllByRole("listitem")).toHaveLength(4);
    }
    const css = readFileSync(join(process.cwd(), "src", "app.css"), "utf8");
    expect(css).toMatch(/\.tx-dialog \{[^}]*max-height: min\(624px, 100%\);/);
    expect(css).toMatch(/\.tx-schedule \{[^}]*min-height:/);
  });

  it("BUD-13@PoC FR 6: clearing «Починаючи з» says the start month is missing, not that the amount is too small", () => {
    renderDialog(tx({ amount: { amount: "-1200.00", currency: "EUR" } }));
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(screen.getByLabelText(/^Починаючи з/), { target: { value: "" } });
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
    expect(description(saveButton())).toBe("Оберіть місяць початку.");
  });

  it("BUD-13@PoC AC2: «На кілька місяців» from March for 6 months is sent as one split on the API, and the saved transaction is handed back", async () => {
    const insurance = tx({ amount: { amount: "-1200.00", currency: "EUR" } });
    const saved = {
      ...insurance,
      split: {
        mode: "months" as const,
        needsReview: false,
        parts: ["03", "04", "05", "06", "07", "08"].map((m) => ({
          categoryId: CAT.car,
          month: `2026-${m}`,
          amount: { amount: "-200.00", currency: "EUR" },
        })),
      },
    };
    const api = fakeApi({ [URL_SPLIT]: { status: 200, body: saved } });
    const { opener, saved: handed } = renderOpener(insurance, api.client);
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(screen.getByLabelText(/^Місяців/), { target: { value: "6" } });
    expect(plain(screen.getByText(/частин по/).closest("p")!.textContent)).toBe(
      "6 частин по 200,00 € · березень 2026 – серпень 2026",
    );
    fireEvent.change(screen.getByLabelText(/^Категорія$/), { target: { value: CAT.car } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([URL_SPLIT]);
    expect(api.calls[0]?.body).toEqual({
      mode: "months",
      startMonth: "2026-03",
      months: 6,
      categoryId: CAT.car,
    });
    expect(handed).toHaveBeenCalledWith(saved);
    expect(document.activeElement).toBe(opener);
  });

  it("S-049 error state: a refused split keeps the dialog with «Помилка», what failed and «Код: …»", async () => {
    const api = fakeApi({ [URL_SPLIT]: problem(409, "ACCOUNT_CLOSED") });
    renderOpener(tx({ amount: { amount: "-100.00", currency: "EUR" } }), api.client);
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(screen.getByLabelText(/^Категорія$/), { target: { value: CAT.car } });
    fireEvent.click(saveButton());
    expect(plain(screen.getByRole("button", { name: /Зберігаємо/ }).textContent)).toBe("Зберігаємо…");
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toMatch(
      /^Помилка Не вдалося розділити транзакцію\. Рахунок закрито: його транзакції лише для читання\. Код: /,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("S-049 keyboard: focus starts on the chosen mode, Escape, «Закрити» and «Скасувати» close, focus returns to «Розділити»", () => {
    const { opener } = renderOpener(tx());
    const dialog = screen.getByRole("dialog", { name: "Розділити транзакцію" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "За категоріями" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    for (const name of ["Закрити", "Скасувати"]) {
      fireEvent.click(opener);
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("S-049 keyboard: Tab stays inside the dialog (aria-modal)", () => {
    renderOpener(tx());
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Закрити" });
    const save = saveButton();
    save.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("S-049 disabled: «Прибрати частину» is inactive at 2 parts, «Додати частину» at 20; only categories of the transaction's type", () => {
    renderDialog(tx());
    for (const b of screen.getAllByRole("button", { name: /^Прибрати частину/ }))
      expect((b as HTMLButtonElement).disabled).toBe(true);
    const options = within(categoryField(1))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).not.toContain("Зарплата");
    const add = screen.getByRole("button", { name: "Додати частину" });
    for (let i = 0; i < 18; i++) fireEvent.click(add);
    expect(screen.getAllByRole("combobox")).toHaveLength(20);
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  it("BUD-13@PoC FR 6: «100/3» in three parts, each field left — the 0,01 € remainder goes to part 1 and «Зберегти» is allowed", () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, data: tx() });
    renderDialog(tx({ amount: { amount: "-100.00", currency: "EUR" } }), onSave);
    fireEvent.click(screen.getByRole("button", { name: "Додати частину" }));
    [CAT.food, CAT.home, CAT.pharmacy].forEach((id, i) => {
      fireEvent.change(categoryField(i + 1), { target: { value: id } });
      fireEvent.change(amountField(i + 1), { target: { value: "100/3" } });
      fireEvent.blur(amountField(i + 1));
    });
    expect(value(amountField(1))).toBe("33,34");
    expect(saveButton().hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledWith({
      mode: "categories",
      parts: [
        { categoryId: CAT.food, amount: "-33.34" },
        { categoryId: CAT.home, amount: "-33.33" },
        { categoryId: CAT.pharmacy, amount: "-33.33" },
      ],
    });
  });
});

describe("BUD-13@PoC b): S-049 accessibility", () => {
  it("NFR-08@PoC: the text pairs of S-049 meet 4.5 : 1 in the light theme", () => {
    const pairs = [
      ["ink-muted", "surface-200"],
      ["ink", "surface-300"],
      ["ink-muted", "surface-inset"],
      ["ink", "surface-inset"],
      ["link", "surface-200"],
      ["loss", "surface-200"],
    ] as const;
    for (const [fg, bg] of pairs)
      expect(contrastRatio(colors[fg].light, colors[bg].light), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

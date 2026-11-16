import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { colors, contrastRatio } from "@willowsum/ui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { fakeApi, plain, problem } from "../auth/testing.tsx";
import { transactionActions, type SplitCategory, type Transaction } from "./api.ts";
import { evaluate } from "./calc.ts";
import { SplitDialog } from "./SplitDialog.tsx";
import { roundParts } from "./split.ts";
import { TransactionAttributes } from "./TransactionAttributes.tsx";
import { Decimal } from "@willowsum/domain-kernel";

/**
 * BUD-13@PoC b) / FIN-03@PoC e) (wave 2, row 117): «Розділити транзакцію» (S-049; boards PocMoneySplit,
 * PocMoneySplitMonths) and the attributes in the details (S-047; board PocMoneyTxDetail) on the merged API of
 * #297 (split) and #327 (attributes).
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
    recordedAt: "2026-03-01T10:00:00Z",
    ...over,
  };
}

const URL_SPLIT = `POST /v1/transactions/${TX_ID}/split`;
const URL_UNSPLIT = `DELETE /v1/transactions/${TX_ID}/split`;
const URL_ATTRS = `PATCH /v1/transactions/${TX_ID}/attributes`;

/** The details with the attributes, as the details screen mounts them on the API. */
function Details({ start, client }: { start: Transaction; client: ReturnType<typeof fakeApi>["client"] }) {
  const [t, setT] = useState(start);
  return (
    <TransactionAttributes
      key={JSON.stringify(t)}
      transaction={t}
      summary="Leroy Merlin · −132,40 €"
      spaceTags={[
        { id: "a1", name: "ремонт-кухні", count: 2 },
        { id: "a2", name: "повернути", count: 1 },
      ]}
      categories={CATEGORIES}
      merchant="Leroy Merlin"
      actions={transactionActions(client, TX_ID)}
      onChange={setT}
    />
  );
}

const renderDetails = (start: Transaction, client = fakeApi({}).client) =>
  render(
    <I18nProvider initialLocale="uk">
      <Details start={start} client={client} />
    </I18nProvider>,
  );

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

  it("BUD-13@PoC AC2: «На кілька місяців» from March for 6 months is sent as one split; the details then show «розділено на 6 міс.»", async () => {
    const insurance = tx({ amount: { amount: "-1200.00", currency: "EUR" }, counterparty: "Страховка авто" });
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
    renderDetails(insurance, api.client);
    const opener = screen.getByRole("button", { name: "Розділити" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(screen.getByLabelText(/^Місяців/), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText(/^Категорія$/), { target: { value: CAT.car } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.at(-1)?.body).toEqual({
      mode: "months",
      startMonth: "2026-03",
      months: 6,
      categoryId: CAT.car,
    });
    expect(screen.getByText("розділено на 6 міс.")).toBeTruthy();
    // FR 6: the full schedule after saving, in the details.
    expect(screen.getByText(/Серпень 2026 · Страховка авто/)).toBeTruthy();
    expect(screen.getAllByText("−200,00 €")).toHaveLength(6);
  });

  it("BUD-13@PoC FR 8: «Об'єднати назад» in the details removes the split", async () => {
    const split = tx({
      split: {
        mode: "categories",
        needsReview: true,
        parts: [
          { categoryId: CAT.food, month: null, amount: { amount: "-100.00", currency: "EUR" } },
          { categoryId: CAT.home, month: null, amount: { amount: "-32.40", currency: "EUR" } },
        ],
      },
    });
    const api = fakeApi({ [URL_UNSPLIT]: { status: 200, body: tx() } });
    renderDetails(split, api.client);
    expect(screen.getByText("розділено")).toBeTruthy();
    expect(screen.getByText("потребує перегляду")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Об’єднати назад" }));
    await waitFor(() => expect(screen.queryByText("розділено")).toBeNull());
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([URL_UNSPLIT]);
  });

  it("BUD-13@PoC EC6: a transfer between own accounts is not split — «Розділити» is inactive with the reason beside it", () => {
    renderDetails(
      tx({
        transfer: {
          id: "e0000000-0000-4000-8000-000000000001",
          side: "outflow",
          counterpartId: "70000000-0000-4000-8000-000000000002",
          date: "2026-03-01",
          fee: null,
          rate: null,
        },
      }),
    );
    const button = screen.getByRole("button", { name: "Розділити" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(description(button)).toBe("Перекази між власними рахунками не розділяються.");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("S-049 error state: a refused split keeps the dialog with «Помилка», what failed and «Код: …»", async () => {
    const api = fakeApi({
      [URL_SPLIT]: problem(409, "ACCOUNT_CLOSED"),
    });
    renderDetails(tx({ amount: { amount: "-100.00", currency: "EUR" } }), api.client);
    fireEvent.click(screen.getByRole("button", { name: "Розділити" }));
    fireEvent.click(screen.getByRole("radio", { name: "На кілька місяців" }));
    fireEvent.change(screen.getByLabelText(/^Категорія$/), { target: { value: CAT.car } });
    fireEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toMatch(
      /^Помилка Не вдалося розділити транзакцію\. Рахунок закрито: його транзакції лише для читання\. Код: /,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("S-049 keyboard: focus starts on the chosen mode, Escape and «Закрити» close, focus returns to «Розділити»", () => {
    renderDetails(tx());
    const opener = screen.getByRole("button", { name: "Розділити" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Розділити транзакцію" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "За категоріями" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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
});

describe("BUD-13@PoC b): attributes in the details (S-047)", () => {
  it("BUD-13@PoC FR 1: the details have «Нотатка», «Теги», «Розділити» and «Схожі транзакції»; empty — «Додайте нотатку», «Додайте тег»", () => {
    renderDetails(tx());
    expect(screen.getByRole("textbox", { name: "Нотатка" }).getAttribute("placeholder")).toBe(
      "Додайте нотатку",
    );
    expect(screen.getByRole("textbox", { name: "Нотатка" }).getAttribute("maxLength")).toBe("2000");
    expect(screen.getByText("Теги")).toBeTruthy();
    expect(screen.getByText("Додайте тег")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Розділити" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Схожі транзакції" }).getAttribute("href")).toBe(
      "#/money/transactions?merchant=Leroy%20Merlin",
    );
  });

  it("BUD-13@PoC AC1: note «фарба і валики» and tags «ремонт-кухні», «повернути» are saved and shown in the details", async () => {
    const saved = tx({
      note: "фарба і валики",
      tags: [
        { id: "a1", name: "ремонт-кухні" },
        { id: "a2", name: "повернути" },
      ],
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const api = fakeApi({ [URL_ATTRS]: async () => (await gate, { status: 200, body: saved }) });
    renderDetails(tx({ amount: { amount: "-240.00", currency: "EUR" } }), api.client);
    fireEvent.change(screen.getByRole("textbox", { name: "Нотатка" }), {
      target: { value: "фарба і валики" },
    });
    for (const name of ["Ремонт-кухні ", "повернути"]) {
      fireEvent.click(screen.getByRole("button", { name: "+ Тег" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Новий тег" }), { target: { value: name } });
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Новий тег" }), { key: "Enter" });
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Новий тег" }), { key: "Escape" });
    }
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    // Loading: «Зберігаємо…» while the request runs.
    expect(plain((await screen.findByRole("status")).textContent)).toContain("Зберігаємо…");
    release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Зберегти" })).toBeNull());
    // FR 2: the space's spelling of an existing tag.
    expect(api.calls[0]?.body).toEqual({ note: "фарба і валики", tags: ["ремонт-кухні", "повернути"] });
    const tags = within(screen.getByRole("list", { name: "Теги" }))
      .getAllByRole("listitem")
      .map((li) => plain(li.textContent));
    expect(tags).toEqual(["•ремонт-кухні", "•повернути"]);
    expect(value(screen.getByRole("textbox", { name: "Нотатка" }))).toBe("фарба і валики");
  });

  it("BUD-13@PoC FR 2: tags are unique without regard to case, up to 60 characters; a tag is removed by its «×»", () => {
    renderDetails(tx({ tags: [{ id: "a1", name: "ремонт-кухні" }] }));
    fireEvent.click(screen.getByRole("button", { name: "+ Тег" }));
    const input = screen.getByRole("combobox", { name: "Новий тег" });
    expect(input.getAttribute("maxLength")).toBe("60");
    fireEvent.change(input, { target: { value: "  РЕМОНТ-КУХНІ " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(screen.getByRole("list", { name: "Теги" })).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Прибрати тег «ремонт-кухні»" }));
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByRole("button", { name: "Зберегти" })).toBeTruthy();
  });

  it("BUD-13@PoC «Стани інтерфейсу»: «Досягнуто 20 тегів» at the 21st tag; «Тегів ще немає» in a space without tags", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `t${String(i)}`, name: `тег ${String(i)}` }));
    renderDetails(tx({ tags: twenty }));
    fireEvent.click(screen.getByRole("button", { name: "+ Тег" }));
    expect(plain(screen.getByRole("alert").textContent)).toBe("Помилка Досягнуто 20 тегів.");
    cleanup();
    render(
      <I18nProvider initialLocale="uk">
        <TransactionAttributes
          transaction={tx()}
          summary=""
          spaceTags={[]}
          categories={CATEGORIES}
          merchant={null}
          actions={transactionActions(fakeApi({}).client, TX_ID)}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Тег" }));
    expect(screen.getByText("Тегів ще немає")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Схожі транзакції" })).toBeNull();
  });

  it("BUD-13@PoC «Стани інтерфейсу»: the server's «too many tags» and a failed save show «Помилка» with «Код: …»", async () => {
    const api = fakeApi({ [URL_ATTRS]: problem(400, "VALIDATION_FAILED") });
    renderDetails(tx(), api.client);
    fireEvent.change(screen.getByRole("textbox", { name: "Нотатка" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toMatch(/^Помилка Не вдалося зберегти зміни\. .+ Код: /);
    expect(value(screen.getByRole("textbox", { name: "Нотатка" }))).toBe("x");
  });

  it("NFR-08@PoC: the text pairs of S-047 and S-049 meet 4.5 : 1 in the light theme", () => {
    const pairs = [
      ["ink-muted", "surface-200"],
      ["ink", "surface-300"],
      ["ink-muted", "surface-inset"],
      ["ink", "surface-inset"],
      ["link", "surface-200"],
      ["on-warning", "tint-warning"],
      ["loss", "surface-200"],
    ] as const;
    for (const [fg, bg] of pairs)
      expect(contrastRatio(colors[fg].light, colors[bg].light), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

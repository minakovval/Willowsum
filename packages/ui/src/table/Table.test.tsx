import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { Table, type TableColumn, type TableProps, type TableRow } from "./Table.tsx";

/**
 * CMP-26@PoC Table. jsdom has no layout, so what depends on width (cards under 520 px, columns sharing the width)
 * is checked on the stylesheet in `Table.css.test.ts`; here: markup, sorting, states, keyboard, names, tooltips.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const norm = (s: string | null) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");

const COLUMNS: TableColumn[] = [
  { key: "name", label: "Рахунок", width: "34%", sortable: true },
  { key: "type", label: "Тип", width: "22%" },
  { key: "when", label: "Дата і час", width: "20%", sortable: true },
  { key: "value", label: "Вартість", type: "amount", width: "24%", sortable: true },
];
const row = (id: string, name: string, value = "1 000,00 €"): TableRow => ({
  id,
  label: name,
  cells: { name, type: "Поточний", when: "12.11.2026 09:30", value },
});
const ROWS = [row("a", "Зарплатна ··4417"), row("b", "Кредитна ··9021", "−2 400,00 €")];

function ui(props: Partial<TableProps> = {}): ReactNode {
  return (
    <I18nProvider>
      <Table caption="Рахунки" columns={COLUMNS} rows={ROWS} {...props} />
    </I18nProvider>
  );
}

describe("CMP-26@PoC Table", () => {
  it("CMP-26@PoC FR «Клавіатура і екранний читач»: a semantic table with a name, th scope=col and one cell per column", () => {
    render(ui());
    const table = screen.getByRole("table", { name: "Рахунки" });
    const heads = within(table).getAllByRole("columnheader");
    expect(heads.map((h) => h.getAttribute("scope"))).toEqual(["col", "col", "col", "col"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getAllByRole("cell")).toHaveLength(8);
  });

  it("CMP-26@PoC AC1: a row is a card below 520 px — every cell carries its column name for the card", () => {
    const { container } = render(ui());
    const cells = [...container.querySelectorAll("tbody tr:first-child td")];
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual([
      "Рахунок",
      "Тип",
      "Дата і час",
      "Вартість",
    ]);
    expect(cells[0]!.getAttribute("data-first")).toBe("true");
    expect(container.querySelector(".ws-dtable-wrap")).not.toBeNull();
  });

  it("CMP-26@PoC AC2: in a wide container it is a table with colgroup widths from the schema and no scroll wrapper", () => {
    const { container } = render(ui());
    const cols = [...container.querySelectorAll("col")].map((c) => (c as HTMLElement).style.width);
    expect(cols).toEqual(["34%", "22%", "20%", "24%"]);
    expect(container.querySelector("[style*='overflow']")).toBeNull();
  });

  it("CMP-26@PoC AC3: pressing «Вартість» asks to sort; the descending column has «▼» and aria-sort=descending", () => {
    const onSort = vi.fn();
    const { rerender } = render(ui({ onSort, sort: { key: "name", direction: "asc" } }));
    fireEvent.click(screen.getByRole("button", { name: /Вартість/ }));
    expect(onSort).toHaveBeenCalledWith("value");
    rerender(ui({ onSort, sort: { key: "value", direction: "desc" } }));
    const head = screen.getByRole("columnheader", { name: /Вартість/ });
    expect(head.getAttribute("aria-sort")).toBe("descending");
    expect(head.textContent).toContain("▼");
  });

  it("CMP-26@PoC FR «Стани»: the same column flips ▲ and ▼, the active heading is ink, the others show «↕»", () => {
    const { container, rerender } = render(
      ui({ onSort: () => undefined, sort: { key: "when", direction: "asc" } }),
    );
    expect(screen.getByRole("columnheader", { name: /Дата і час/ }).getAttribute("aria-sort")).toBe(
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /Дата і час/ }).textContent).toContain("▲");
    const others = [...container.querySelectorAll('.ws-dtable-sort[data-sort="none"]')];
    expect(others).toHaveLength(2);
    for (const b of others) expect(b.textContent).toContain("↕");
    expect(screen.getByRole("columnheader", { name: /Тип/ }).hasAttribute("aria-sort")).toBe(false);
    rerender(ui({ onSort: () => undefined, sort: { key: "when", direction: "desc" } }));
    expect(screen.getByRole("columnheader", { name: /Дата і час/ }).textContent).toContain("▼");
  });

  it("CMP-26@PoC AC7: the sort is only in the headings — no sort menu or button outside the table", () => {
    const { container } = render(ui({ onSort: () => undefined, sort: { key: "when", direction: "desc" } }));
    const outside = [...container.querySelectorAll("button, [role='listbox'], [role='menu']")].filter(
      (el) => !el.closest("thead"),
    );
    expect(outside).toEqual([]);
  });

  it("CMP-26@PoC AC4: 128 records show «128 записів» and the total above the table", () => {
    render(ui({ summary: { count: 128, total: "1 284 560,00 €" } }));
    const summary = screen.getByTestId("table-summary");
    expect(norm(summary.textContent)).toBe("128 записів · 1 284 560,00 €");
    const table = screen.getByRole("table");
    expect(summary.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("CMP-26@PoC FR «Будова»: the count takes the plural form of the language (1, 2, 5)", () => {
    for (const [n, text] of [
      [1, "1 запис"],
      [2, "2 записи"],
      [5, "5 записів"],
    ] as const) {
      const { unmount } = render(ui({ summary: { count: n } }));
      expect(norm(screen.getByTestId("table-summary").textContent)).toBe(text);
      unmount();
    }
  });

  it("CMP-26@PoC AC5: a name longer than its cell is cut and, when cut, shows a tooltip with the full name", () => {
    const full = "Накопичувальний рахунок для великих планових витрат родини на кілька років уперед";
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
    const { container } = render(ui({ rows: [row("a", full)] }));
    const cut = container.querySelector<HTMLElement>("td .ws-truncate")!;
    expect(cut.textContent).toBe(full);
    expect(cut.tabIndex).toBe(0);
    fireEvent.mouseEnter(cut);
    expect(screen.getByRole("tooltip").textContent).toBe(full);
  });

  it("CMP-26@PoC FR «Вміст»: text that fits has no tooltip and no focus stop; an amount is never cut by the table", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(100);
    const { container } = render(ui());
    const text = container.querySelector<HTMLElement>("td .ws-truncate")!;
    expect(text.hasAttribute("tabindex")).toBe(false);
    fireEvent.mouseEnter(text);
    expect(screen.queryByRole("tooltip")).toBeNull();
    const amount = container.querySelector("td:last-child")!;
    expect(amount.querySelector(".ws-truncate")).toBeNull();
    expect(amount.className).toContain("ws-dtable-end");
    expect(amount.className).toContain("ws-tabular");
  });

  it("CMP-26@PoC AC6: with `flat` the wrapper carries the flat variant, so rows stay rows in a narrow widget", () => {
    const { container } = render(ui({ flat: true }));
    expect(container.querySelector(".ws-dtable-wrap--flat")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("CMP-26@PoC AC8: another page of rows with other name lengths keeps the same column widths", () => {
    const { container, rerender } = render(ui());
    const widths = () => [...container.querySelectorAll("col")].map((c) => (c as HTMLElement).style.width);
    const before = widths();
    rerender(
      ui({
        rows: [row("c", "Дуже довга назва контрагента, яка не вміщається в клітинку таблиці"), row("d", "А")],
      }),
    );
    expect(widths()).toEqual(before);
    expect(container.querySelector("table")!.className).toContain("ws-dtable");
  });

  it("CMP-26@PoC FR «Розміри і стиль»: a hidden column (ColumnPicker) is not drawn", () => {
    render(ui({ columns: COLUMNS.map((c) => (c.key === "type" ? { ...c, hidden: true } : c)) }));
    expect(screen.queryByRole("columnheader", { name: "Тип" })).toBeNull();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
  });

  it("CMP-26@PoC FR «Стани»: a selected row has its box ticked and named by the record; the box toggles", () => {
    const onChange = vi.fn();
    const { container } = render(ui({ selection: { selected: new Set(["b"]), onChange } }));
    const box = screen.getByRole("checkbox", { name: "Кредитна ··9021" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(container.querySelector('tr[data-selected="true"]')).not.toBeNull();
    expect((screen.getByRole("checkbox", { name: "Зарплатна ··4417" }) as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Зарплатна ··4417" }));
    expect(onChange).toHaveBeenCalledWith("a", true);
  });

  it("CMP-26@PoC FR «Стани»: loading is a skeleton of rows (CMP-22), busy, with no table", () => {
    const { container } = render(ui({ state: "loading", summary: { count: 128 } }));
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container.querySelectorAll(".ws-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("CMP-26@PoC FR «Стани»: empty shows the shared EmptyState (CMP-23) with a title and a text, or the consumer's own", () => {
    const { container, rerender } = render(ui({ state: "empty", rows: [] }));
    expect(screen.getByRole("heading", { name: "Записів немає" })).toBeTruthy();
    expect(container.querySelector('.ws-state[data-state="empty"][data-placement="block"]')).not.toBeNull();
    rerender(ui({ state: "empty", rows: [], empty: <p>Рахунків ще немає</p> }));
    expect(screen.getByText("Рахунків ще немає")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("CMP-26@PoC FR «Стани»: error says what failed, offers «Спробувати ще раз» and the code", () => {
    const onRetry = vi.fn();
    render(ui({ state: "error", error: { onRetry, code: "WS-4F2A" } }));
    const alert = screen.getByRole("alert");
    // The shared ErrorState (CMP-24): «✕» is decoration, the word «Помилка» is read.
    expect(alert.getAttribute("data-state")).toBe("error");
    expect(alert.querySelector("[aria-hidden='true']")!.textContent).toContain("✕");
    expect(alert.querySelector(".ws-state-title")!.textContent).toContain("Помилка");
    expect(alert.textContent).toContain("Код: WS-4F2A");
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("CMP-26@PoC FR «Клавіатура і екранний читач»: the open row is named by the record, its box by its own «Вибрати …» name, never by the id", () => {
    const rows: TableRow[] = [
      { ...row("a", "Зарплатна ··4417"), selectLabel: "Вибрати Зарплатна ··4417" },
      { id: "tech-77", cells: { name: "Гаманець" } },
      { id: "tech-78", cells: { name: <b>Вузол</b> } },
    ];
    const { container } = render(
      ui({ rows, onOpen: () => undefined, selection: { selected: new Set(), onChange: () => undefined } }),
    );
    const first = container.querySelector("tbody tr")!;
    expect(first.getAttribute("aria-label")).toBe("Зарплатна ··4417");
    expect(
      within(first as HTMLElement).getByRole("checkbox", { name: "Вибрати Зарплатна ··4417" }),
    ).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Гаманець" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Вибір" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /tech-7/ })).toBeNull();
  });

  it("CMP-26@PoC FR «Клавіатура і екранний читач»: aria-sort is set only on a column that can be sorted here (a button and onSort)", () => {
    const { rerender } = render(ui());
    expect(screen.getAllByRole("columnheader").some((h) => h.hasAttribute("aria-sort"))).toBe(false);
    rerender(ui({ onSort: () => undefined }));
    expect(screen.getByRole("columnheader", { name: /Рахунок/ }).getAttribute("aria-sort")).toBe("none");
    expect(screen.getByRole("columnheader", { name: "Тип" }).hasAttribute("aria-sort")).toBe(false);
  });

  it("CMP-26@PoC FR «Клавіатура і екранний читач»: a row that opens a record takes focus and Enter opens it", () => {
    const onOpen = vi.fn();
    const { container } = render(
      ui({ onOpen, selection: { selected: new Set(), onChange: () => undefined } }),
    );
    const first = container.querySelector<HTMLElement>("tbody tr")!;
    expect(first.tabIndex).toBe(0);
    expect(first.getAttribute("aria-label")).toBe("Зарплатна ··4417");
    fireEvent.keyDown(first, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    // Enter or a click on the checkbox inside the row keeps its own meaning.
    onOpen.mockClear();
    const box = within(first).getByRole("checkbox");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(box);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("CMP-26@PoC FR «Клавіатура і екранний читач»: the sort buttons are in the Tab order, a state is not carried by colour alone", () => {
    const { container } = render(ui({ onSort: () => undefined, sort: { key: "name", direction: "asc" } }));
    for (const b of container.querySelectorAll<HTMLButtonElement>(".ws-dtable-sort")) {
      expect(b.tabIndex).toBe(0);
      // The sort direction is the arrow and aria-sort, not only the ink colour (NFR-08 FR 4).
      expect(b.textContent).toMatch(/[▲▼↕]/);
    }
  });

  it("CMP-26@PoC FR «Будова»: a footer (Pagination) sits under the table, not in the error state", () => {
    const { rerender } = render(ui({ footer: <nav aria-label="Сторінки списку" /> }));
    expect(screen.getByRole("navigation", { name: "Сторінки списку" })).toBeTruthy();
    rerender(
      ui({
        footer: <nav aria-label="Сторінки списку" />,
        state: "error",
        error: { onRetry: () => undefined },
      }),
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("CMP-26@PoC FR «Вміст»: the package holds no strings of its own — every text arrives by props or i18n (en renders too)", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <Table caption="Accounts" columns={COLUMNS} rows={[]} state="empty" summary={{ count: 3 }} />
      </I18nProvider>,
    );
    expect(norm(html)).toContain("No records");
    expect(norm(html)).toContain("3 records");
  });
});

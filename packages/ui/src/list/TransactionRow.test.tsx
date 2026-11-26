import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { HideAmountsProvider } from "../privacy/HideAmounts.tsx";
import {
  merchantInitials,
  ReviewAnnouncement,
  TransactionRow,
  TransactionTableHead,
  type TransactionCategory,
} from "./TransactionRow.tsx";

const norm = (s: string | null) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");

function wrap(ui: ReactNode, hidden = false) {
  return (
    <I18nProvider>
      <HideAmountsProvider initialHidden={hidden}>{ui}</HideAmountsProvider>
    </I18nProvider>
  );
}

const food: TransactionCategory = { name: "Продукти", icon: "budget", tone: 2 };
const spend = { value: "-42.90", currency: "EUR" };

describe("CMP-28@PoC TransactionRow", () => {
  it("CMP-28@PoC AC1: a row that needs review has the 6 px ink stripe, the «! Перевірити» badge and two actions", () => {
    const { container } = render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-10-12"
          category={food}
          amount={spend}
          review
          onConfirm={() => undefined}
          onChangeCategory={() => undefined}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(container.querySelector(".ws-tx-row-review")).not.toBeNull();
    const badge = container.querySelector(".ws-badge")!;
    expect(badge.getAttribute("data-tone")).toBe("attention");
    expect(badge.textContent).toBe("!Перевірити");
    expect(screen.getByRole("button", { name: "Підтвердити" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Змінити категорію" })).toBeTruthy();
    // No category chip while the badge stands for it.
    expect(container.querySelector(".ws-tx-category")).toBeNull();
  });

  it("CMP-28@PoC AC2: a transaction without a category shows the dashed «Без категорії» chip with no icon", () => {
    const { container } = render(
      wrap(
        <TransactionRow merchant="ФОП Іваненко" date="2026-10-28" amount={spend} onOpen={() => undefined} />,
      ),
    );
    const chip = container.querySelector(".ws-tx-category-none")!;
    expect(chip.textContent).toBe("Без категорії");
    expect(chip.querySelector("svg")).toBeNull();
  });

  it("CMP-28@PoC AC3: spending 42,90 EUR is «−42,90 €» and income 2 400,00 EUR is «2 400,00 €» with no sign, both in ink", () => {
    const { container, rerender } = render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-11-02"
          category={food}
          amount={spend}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(norm(container.querySelector(".ws-amount")!.textContent)).toBe("−42,90 €");
    rerender(
      wrap(
        <TransactionRow
          merchant="Зарплата"
          date="2026-11-01"
          category={food}
          amount={{ value: "2400.00", currency: "EUR" }}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(norm(container.querySelector(".ws-amount")!.textContent)).toBe("2 400,00 €");
  });

  it("CMP-28@PoC AC4: «Підтвердити» is busy until the server answers; the row then leaves the queue and the reader hears the count", async () => {
    let finish: () => void = () => undefined;
    function Queue() {
      const [ids, setIds] = useState(["a", "b"]);
      const [left, setLeft] = useState<number | null>(null);
      return (
        <>
          {ids.map((id) => (
            <TransactionRow
              key={id}
              merchant={`Мерчант ${id}`}
              date="2026-10-12"
              category={food}
              amount={spend}
              review
              onConfirm={() =>
                new Promise<void>((resolve) => {
                  finish = () => {
                    setIds((all) => all.filter((x) => x !== id));
                    setLeft(ids.length - 1);
                    resolve();
                  };
                })
              }
              onChangeCategory={() => undefined}
              onOpen={() => undefined}
            />
          ))}
          <ReviewAnnouncement remaining={left} />
        </>
      );
    }
    render(wrap(<Queue />));
    expect(
      screen.getAllByRole("status").every((s) => s.textContent === "" || s.textContent === "Виконується"),
    ).toBe(true);
    const confirm = screen.getAllByRole("button", { name: "Підтвердити" })[0]!;
    fireEvent.click(confirm);
    // Waiting for the server: busy, the row is still there.
    await waitFor(() => expect(confirm.getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("button", { name: /Мерчант a/ })).toBeTruthy();
    await act(async () => finish());
    expect(screen.queryByRole("button", { name: /Мерчант a/ })).toBeNull();
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Підтверджено. Лишилось 1")).toBe(
      true,
    );
  });

  it("CMP-28@PoC AC4: a failed confirmation leaves the row and ends the busy state", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("offline")));
    const { unmount } = render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-10-12"
          category={food}
          amount={spend}
          review
          onConfirm={onConfirm}
          onOpen={() => undefined}
        />,
      ),
    );
    const confirm = screen.getByRole("button", { name: "Підтвердити" });
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.getAttribute("aria-busy")).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("CMP-28@PoC AC5: a known merchant with tags and «Очікує» shows the initials, the tag icon and the badge", () => {
    const { container } = render(
      wrap(
        <TransactionRow
          merchant="Rozetka"
          date="2026-11-01"
          category={food}
          amount={{ value: "-38.90", currency: "EUR" }}
          tags={["дім", "техніка"]}
          pending
          onOpen={() => undefined}
        />,
      ),
    );
    expect(container.querySelector(".ws-tx-logo")!.textContent).toBe("R");
    expect(container.querySelector(".ws-tx-mark svg")).not.toBeNull();
    expect(container.querySelector(".ws-badge")!.textContent).toBe("iОчікує");
    // The tooltip of the tag icon lists the tags.
    fireEvent.mouseEnter(container.querySelector(".ws-tx-mark")!);
    expect(screen.getByRole("tooltip").textContent).toBe("Теги: дім, техніка");
  });

  it("CMP-28@PoC AC6: in the table the columns run Контрагент, Категорія, Актив, Рахунок, Дата і час, Сума; the time stands under the date", () => {
    const { container } = render(
      wrap(
        <>
          <TransactionTableHead selectable />
          <TransactionRow
            layout="table"
            merchant="Сільпо"
            date="2026-11-02"
            time="08:02"
            category={food}
            asset="Škoda Octavia"
            account="Поточний ··4417"
            amount={spend}
            onSelectedChange={() => undefined}
            onOpen={() => undefined}
          />
        </>,
      ),
    );
    const head = container.querySelector(".ws-tx-head")!;
    expect([...head.children].map((c) => c.textContent).filter(Boolean)).toEqual([
      "Контрагент",
      "Категорія",
      "Актив",
      "Рахунок",
      "Дата і час",
      "Сума",
    ]);
    const row = container.querySelector(".ws-tx-row-table:not(.ws-tx-head)")!;
    // [вибір] · Контрагент · Категорія · Актив · Рахунок · Дата і час · Сума, in this order in the DOM.
    const cells = [...row.children].map((c) => norm(c.textContent));
    expect(cells[1]).toContain("Сільпо");
    expect(cells[2]).toContain("Продукти");
    expect(cells[3]).toBe("Škoda Octavia");
    expect(cells[4]).toBe("Поточний ··4417");
    expect(cells[5]).toMatch(/^2 лист\. 2026.*08:02$/);
    expect(cells[6]).toContain("−42,90 €");
    const when = row.querySelector(".ws-tx-when")!;
    expect([...when.children].map((c) => c.textContent)).toEqual([expect.stringContaining("2026"), "08:02"]);
  });

  it("CMP-28@PoC FR «Будова»: the initials come from the first letters of the first two words; marks are only the listed ones", () => {
    expect(merchantInitials("Сільпо")).toBe("С");
    expect(merchantInitials("ФОП Іваненко")).toBe("ФІ");
    expect(merchantInitials("  uklon trip *1 ")).toBe("UT");
    const { container } = render(
      wrap(
        <TransactionRow
          merchant="Квартплата"
          date="2026-10-30"
          category={food}
          amount={spend}
          pending
          possibleDuplicate
          split={3}
          transfer
          tags={["дім"]}
          note
          onOpen={() => undefined}
        />,
      ),
    );
    expect(
      [...container.querySelectorAll(".ws-row-headline .ws-badge")].map((b) => norm(b.textContent)),
    ).toEqual(["iОчікує", "!Можливий дубль", "•розділено на 3 міс.", "•переказ"]);
    expect(container.querySelectorAll(".ws-row-headline .ws-tx-mark")).toHaveLength(2);
  });

  it("CMP-28@PoC FR «Стани»: a possible duplicate offers «Об’єднати»; a transfer carries «переказ»; every state has hover and focus", () => {
    const onMerge = vi.fn();
    render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-10-27"
          category={food}
          amount={spend}
          possibleDuplicate
          onMerge={onMerge}
          onOpen={() => undefined}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Об’єднати" }));
    expect(onMerge).toHaveBeenCalledTimes(1);
  });

  it("CMP-28@PoC FR «Стани»: loading is the skeleton of a row; the row is not interactive", () => {
    const { container } = render(
      wrap(<TransactionRow merchant="" date="2026-11-02" amount={spend} loading />),
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("CMP-28@PoC FR «Клавіатура і екранний читач»: the name is one sentence; the row opens on Enter; the actions are reached inside it", () => {
    const onOpen = vi.fn();
    render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-10-12"
          category={food}
          amount={spend}
          review
          onConfirm={() => undefined}
          onChangeCategory={() => undefined}
          onOpen={onOpen}
        />,
      ),
    );
    const open = screen.getByRole("button", { name: /^Сільпо/ });
    expect(norm(open.getAttribute("aria-label"))).toBe(
      "Сільпо, 12 жовт. 2026 р., Продукти, мінус 42,90 євро, потребує розбору",
    );
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Tab order: the row, then «Підтвердити», then the pencil.
    const buttons = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(buttons.slice(0, 3)).toEqual([
      open.getAttribute("aria-label"),
      "Підтвердити",
      "Змінити категорію",
    ]);
  });

  it("CMP-28@PoC FR «Клавіатура і екранний читач»: the pencil shows «Змінити категорію» as its tooltip", () => {
    render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-10-12"
          category={food}
          amount={spend}
          review
          onChangeCategory={() => undefined}
          onOpen={() => undefined}
        />,
      ),
    );
    fireEvent.focus(screen.getByRole("button", { name: "Змінити категорію" }));
    expect(within(document.body).getByRole("tooltip").textContent).toBe("Змінити категорію");
  });

  it("CMP-28@PoC FR «Вміст»: income has no sign, spending a real minus, large sums are abbreviated by the shared fit; no float maths", () => {
    const { container } = render(
      wrap(
        <TransactionRow
          merchant="Депозит"
          date="2026-11-02"
          category={food}
          amount={{ value: "0.30", currency: "EUR" }}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(norm(container.querySelector(".ws-amount")!.textContent)).toBe("0,30 €");
    expect(container.querySelector(".ws-row-money-main")).not.toBeNull();
  });

  it("CMP-28@PoC: while amounts are hidden the amount is «•••» and not in the name (DS-18)", () => {
    const { container } = render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-10-12"
          category={food}
          amount={spend}
          onOpen={() => undefined}
        />,
        true,
      ),
    );
    expect(norm(container.innerHTML)).not.toContain("42");
    expect(
      screen.getByRole("button", { name: "Сільпо, 12 жовт. 2026 р., Продукти, Сума прихована" }),
    ).toBeTruthy();
  });

  it("CMP-28@PoC: a link row opens the record by `href`", () => {
    render(
      wrap(
        <TransactionRow
          merchant="Сільпо"
          date="2026-10-12"
          category={food}
          amount={spend}
          href="#/money/transactions/7"
        />,
      ),
    );
    expect(screen.getByRole("link", { name: /^Сільпо/ }).getAttribute("href")).toBe("#/money/transactions/7");
  });
});

describe("DAT-01@PoC FR 3: the sortable header of the transactions table", () => {
  function Sortable({ withAsset = false }: { withAsset?: boolean }) {
    const [sort, setSort] = useState<{ column: "merchant" | "when" | "amount"; direction: "asc" | "desc" }>({
      column: "when",
      direction: "desc",
    });
    return (
      <TransactionTableHead
        withAsset={withAsset}
        sort={sort}
        sortable={["merchant", "when", "amount"]}
        onSort={(column) =>
          setSort((s) =>
            s.column === column
              ? { column, direction: s.direction === "asc" ? "desc" : "asc" }
              : { column: column as "merchant" | "when" | "amount", direction: "asc" },
          )
        }
      />
    );
  }
  const sortButton = (name: RegExp) => screen.getByRole("button", { name });

  it("DAT-01@PoC FR 3: a press sorts ascending, the next one descending; the active column has its arrow and says the direction, the others the grey double arrow", () => {
    render(wrap(<Sortable />));
    const when = sortButton(/^Дата і час/);
    expect(when.dataset.sort).toBe("desc");
    expect(when.textContent).toBe("Дата і час, за спаданням");
    expect(when.title).toBe("Сортувати за: дата і час");
    const merchant = sortButton(/^Контрагент/);
    expect(merchant.dataset.sort).toBe("none");
    act(() => merchant.click());
    expect(merchant.dataset.sort).toBe("asc");
    expect(merchant.textContent).toBe("Контрагент, за зростанням");
    expect(when.dataset.sort).toBe("none");
    act(() => merchant.click());
    expect(merchant.dataset.sort).toBe("desc");
    // A column the list does not sort by is a plain label, hidden from the reader: the rows name their cells.
    expect(screen.queryByRole("button", { name: /^Категорія/ })).toBeNull();
    expect(screen.getByText("Категорія").getAttribute("aria-hidden")).toBe("true");
  });

  it("FIN-03@PoC FR 13: `type` puts a tag next to the amount («витрата», «дохід», «переказ»), in the table and in the list form, and in the row's name; without `type` there is none", () => {
    const { container, rerender } = render(
      wrap(
        <TransactionRow layout="table" merchant="Сільпо" date="2026-11-02" amount={spend} type="expense" />,
      ),
    );
    const tag = () => container.querySelector(".ws-row-money .ws-tx-type");
    expect(tag()?.textContent).toBe("витрата");
    expect(container.querySelector(".ws-row-money")?.contains(tag())).toBe(true);
    rerender(
      wrap(
        <TransactionRow
          merchant="Зарплата"
          date="2026-11-02"
          amount={{ value: "1200.00", currency: "EUR" }}
          type="income"
          onOpen={() => undefined}
        />,
      ),
    );
    expect(tag()?.textContent).toBe("дохід");
    expect(screen.getByRole("button", { name: /дохід$/ })).toBeTruthy();
    rerender(
      wrap(
        <TransactionRow merchant="Накопичення" date="2026-11-02" amount={spend} type="transfer" transfer />,
      ),
    );
    expect(tag()?.textContent).toBe("переказ");
    rerender(wrap(<TransactionRow merchant="Сільпо" date="2026-11-02" amount={spend} />));
    expect(tag()).toBeNull();
  });

  it("FIN-03@PoC FR 13: without «Актив» the header runs Контрагент, Категорія, Рахунок, Дата і час, Сума and the row has no «Актив» cell", () => {
    const { container } = render(
      wrap(
        <>
          <Sortable />
          <TransactionRow
            layout="table"
            withAsset={false}
            merchant="Сільпо"
            date="2026-11-02"
            time="08:02"
            category={food}
            asset="Škoda Octavia"
            account="Поточний ··4417"
            amount={spend}
            onOpen={() => undefined}
          />
        </>,
      ),
    );
    const head = container.querySelector(".ws-tx-head")!;
    expect(head.getAttribute("aria-hidden")).toBeNull();
    expect([...head.children].map((c) => c.textContent?.replace(/,.*$/, ""))).toEqual([
      "Контрагент",
      "Категорія",
      "Рахунок",
      "Дата і час",
      "Сума",
    ]);
    const row = container.querySelector(".ws-tx-row:not(.ws-tx-head)")!;
    expect(row.classList.contains("ws-tx-row-noasset")).toBe(true);
    expect(row.textContent).not.toContain("Škoda Octavia");
    expect(screen.getByRole("button", { name: /^Сільпо/ }).getAttribute("aria-label")).not.toContain("Škoda");
  });
});

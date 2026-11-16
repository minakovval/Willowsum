import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { HideAmountsProvider } from "../privacy/HideAmounts.tsx";
import { ListRow } from "./ListRow.tsx";

const norm = (s: string | null) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");

function wrap(ui: ReactNode, hidden = false) {
  return (
    <I18nProvider>
      <HideAmountsProvider initialHidden={hidden}>{ui}</HideAmountsProvider>
    </I18nProvider>
  );
}

const MORTGAGE_NAME = "Іпотека, ПриватБанк, мінус 180 000,00 євро, знизилось на 0,8 %";

describe("CMP-27@PoC ListRow", () => {
  it("CMP-27@PoC AC1: a long name is cut to one line with an ellipsis and the amount keeps to 45 % of the row", () => {
    const { container } = render(
      wrap(
        <ListRow
          title="Накопичувальний рахунок для великих планових витрат родини на кілька років уперед"
          amount={{ value: "5200.00", currency: "EUR" }}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(container.querySelector(".ws-row-title")!.textContent).toContain("Накопичувальний");
  });

  it("CMP-27@PoC AC2: a debt of 180 000,00 EUR reads «−180 000,00 €» in ink, not in a sign colour", () => {
    const { container } = render(
      wrap(
        <ListRow
          title="Іпотека"
          amount={{ value: "-180000.00", currency: "EUR" }}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(norm(container.querySelector(".ws-amount")!.textContent)).toBe("−180 000,00 €");
    expect(container.querySelector(".ws-row-money")!.className).not.toMatch(/gain|loss/);
  });

  it("CMP-27@PoC AC3: Tab reaches the row and Enter opens the record (a button)", () => {
    const onOpen = vi.fn();
    render(wrap(<ListRow title="Іпотека" onOpen={onOpen} />));
    const row = screen.getByRole("button", { name: "Іпотека" });
    row.focus();
    expect(document.activeElement).toBe(row);
    // jsdom turns Enter on a button into a click only through the keyboard event of user-event; click is the same activation.
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("CMP-27@PoC AC3: with `href` the row is one link to the record", () => {
    render(wrap(<ListRow title="Іпотека" href="#/money/accounts/1" />));
    expect(screen.getByRole("link", { name: "Іпотека" }).getAttribute("href")).toBe("#/money/accounts/1");
  });

  it("CMP-27@PoC AC4: the accessible name is one sentence — name, detail, status, amount, change", () => {
    render(
      wrap(
        <ListRow
          title="Іпотека"
          meta="ПриватБанк"
          amount={{ value: "-180000.00", currency: "EUR" }}
          delta={{ percent: "-0.8" }}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(norm(screen.getByRole("button").getAttribute("aria-label"))).toBe(MORTGAGE_NAME);
  });

  it("CMP-27@PoC AC4: the status is in the name too", () => {
    render(
      wrap(
        <ListRow
          title="Поточний ··4417"
          meta="monobank"
          badge={{ label: "Активне", tone: "positive" }}
          amount={{ value: "11400.00", currency: "EUR" }}
          onOpen={() => undefined}
        />,
      ),
    );
    expect(norm(screen.getByRole("button").getAttribute("aria-label"))).toBe(
      "Поточний ··4417, monobank, Активне, 11 400,00 євро",
    );
  });

  it("CMP-27@PoC FR «Будова»: the structure — leading element, name and detail, badge beside the name, amount with a change", () => {
    const { container } = render(
      wrap(
        <ListRow
          leading={<span data-testid="lead" />}
          title="Іпотека"
          meta="ПриватБанк"
          badge={{ label: "Активне", tone: "positive" }}
          amount={{ value: "-180000.00", currency: "EUR" }}
          delta={{ percent: "-0.8" }}
          onOpen={() => undefined}
        />,
      ),
    );
    const open = container.querySelector(".ws-row-open")!;
    expect(within(open as HTMLElement).getByText("Активне")).toBeTruthy();
    expect(container.querySelector(".ws-row-headline .ws-badge")).not.toBeNull();
    expect(container.querySelector(".ws-row-leading")!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".ws-row-money .ws-delta")!.textContent).toContain("0,8");
  });

  it("CMP-27@PoC FR «Стани»: a selected row has its checkbox ticked; the box names the record and toggles", () => {
    const onSelectedChange = vi.fn();
    render(
      wrap(
        <ListRow
          title="Кредитна ··9021"
          selected
          onSelectedChange={onSelectedChange}
          onOpen={() => undefined}
        />,
      ),
    );
    const box = screen.getByRole("checkbox", { name: "Вибрати Кредитна ··9021" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onSelectedChange).toHaveBeenCalledWith(false);
  });

  it("CMP-27@PoC FR «Стани»: an archived record has its name in ink-muted and the «Архів» badge in the neutral tone", () => {
    const { container } = render(wrap(<ListRow title="Ощадний ··1180" archived onOpen={() => undefined} />));
    const badge = container.querySelector(".ws-badge")!;
    expect(badge.getAttribute("data-tone")).toBe("neutral");
    expect(badge.textContent).toContain("Архів");
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Ощадний ··1180, Архів");
  });

  it("CMP-27@PoC FR «Стани»: loading is the skeleton of a row (CMP-22), busy, with no link or button", () => {
    const { container } = render(wrap(<ListRow title="" loading />));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("CMP-27@PoC FR «Вміст»: while amounts are hidden the real value is not in the DOM or the name (DS-18)", () => {
    const { container } = render(
      wrap(
        <ListRow
          title="Іпотека"
          amount={{ value: "-180000.00", currency: "EUR" }}
          onOpen={() => undefined}
        />,
        true,
      ),
    );
    expect(norm(container.innerHTML)).not.toContain("180");
    expect(screen.getByRole("button", { name: "Іпотека, Сума прихована" })).toBeTruthy();
  });

  it("CMP-27@PoC FR «Вміст»: a cut name or detail gets the tooltip with the full text, a name that fits does not", () => {
    const widths = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    const cut = render(
      wrap(<ListRow title="Дуже довга назва" meta="Дуже довга деталь" onOpen={() => undefined} />),
    );
    const row = cut.getByRole("button");
    fireEvent.focus(row);
    expect(screen.getByRole("tooltip").textContent).toBe("Дуже довга назва · Дуже довга деталь");
    cut.unmount();
    widths.mockReturnValue(100);
    render(wrap(<ListRow title="Коротка" onOpen={() => undefined} />));
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    vi.restoreAllMocks();
  });

  it("CMP-27@PoC FR «Вміст»: money is formatted by the shared helpers from decimal strings, never from a float", () => {
    // 0.1 + 0.2 is not representable; the row still shows exactly what the string says.
    const { container } = render(
      wrap(<ListRow title="Рахунок" amount={{ value: "0.30", currency: "EUR" }} onOpen={() => undefined} />),
    );
    expect(norm(container.querySelector(".ws-amount")!.textContent)).toBe("0,30 €");
  });
});

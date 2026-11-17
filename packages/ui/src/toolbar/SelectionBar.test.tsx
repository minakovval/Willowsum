import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio } from "../tokens/contrast.ts";
import { colors } from "../tokens/color.ts";
import type { MenuItem } from "../shell/MenuButton.tsx";
import { SelectionBar, type SelectionBarProps } from "./SelectionBar.tsx";

const plain = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");
/** An accessible name as the user reads it: numbers are kept with their word by a no-break space. */
const nm = (text: string) => new RegExp(`^${text.replace(/ /g, "\\s")}$`);
const wrap = (ui: ReactNode) => <I18nProvider>{ui}</I18nProvider>;

const ACTIONS: MenuItem[] = [
  { id: "category", label: "Змінити категорію", icon: "tag", onSelect: () => undefined },
  { id: "tags", label: "Додати теги", icon: "tag", onSelect: () => undefined },
  { id: "confirm", label: "Підтвердити категорії", icon: "check", onSelect: () => undefined },
];

function bar(props: Partial<SelectionBarProps> = {}) {
  return wrap(
    <SelectionBar
      count={2}
      sum={{ amount: { value: "-238.90", currency: "EUR" } }}
      actions={ACTIONS}
      onClear={() => undefined}
      {...props}
    />,
  );
}

/** A page of 25 ticked rows with 42 by the filter: the bar as the list drives it. */
function Driven() {
  const [all, setAll] = useState(false);
  const [excluded, setExcluded] = useState(0);
  return wrap(
    <>
      <SelectionBar
        count={all ? 42 - excluded : 25}
        filterCount={42}
        allSelected={all}
        excluded={excluded}
        actions={ACTIONS}
        onSelectAll={() => setAll(true)}
        onSelectPage={() => setAll(false)}
        onClear={() => undefined}
      />
      <button type="button" onClick={() => setExcluded((n) => n + 1)}>
        untick
      </button>
    </>,
  );
}

describe("CMP-73@PoC SelectionBar", () => {
  it("CMP-73@PoC AC1, FR «Вміст»: «Вибрано 2 · Сума −238,90 €» (uk-UA, the currency after the number), one «Дії з вибраними ˅» and «×», no separate action buttons", () => {
    render(bar());
    const toolbar = screen.getByRole("toolbar", { name: "Дії з вибраними записами" });
    expect(plain(toolbar.textContent)).toContain("Вибрано 2· Сума −238,90 €");
    const buttons = [...toolbar.querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent,
    );
    expect(buttons).toEqual(["Дії з вибраними", "Зняти вибір"]);
    expect(screen.queryByRole("button", { name: "Змінити категорію" })).toBeNull();
  });

  it("CMP-73@PoC AC2: a whole page ticked with more by the filter shows «Вибрати всі 42 за фільтром»; after it — «Вибрано всі 42 за фільтром» and «Вибрати лише сторінку»", () => {
    render(<Driven />);
    fireEvent.click(screen.getByRole("button", { name: nm("Вибрати всі 42 за фільтром") }));
    expect(plain(screen.getByRole("toolbar").textContent)).toContain("Вибрано всі 42 за фільтром");
    fireEvent.click(screen.getByRole("button", { name: "Вибрати лише сторінку" }));
    expect(plain(screen.getByRole("toolbar").textContent)).toContain("Вибрано 25");
  });

  it("CMP-73@PoC AC9: after «усі за фільтром» unticking 2 of 42 rows shows «Вибрано 40 за фільтром»", () => {
    render(<Driven />);
    fireEvent.click(screen.getByRole("button", { name: nm("Вибрати всі 42 за фільтром") }));
    fireEvent.click(screen.getByRole("button", { name: "untick" }));
    fireEvent.click(screen.getByRole("button", { name: "untick" }));
    expect(plain(screen.getByRole("toolbar").textContent)).toContain("Вибрано 40 за фільтром");
  });

  it("CMP-73@PoC AC3: «Дії з вибраними» (aria-haspopup menu, aria-expanded) opens a menu under the button with the list's actions only; a dangerous one is last after a separator", () => {
    render(
      bar({
        actions: [
          ...ACTIONS,
          { id: "delete", label: "Видалити", icon: "close", danger: true, onSelect: () => undefined },
        ],
      }),
    );
    const button = screen.getByRole("button", { name: "Дії з вибраними" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Дії з вибраними" });
    expect(menu.classList.contains("ws-menu-down")).toBe(true);
    const items = [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map(
      (el) => el.textContent || "—",
    );
    expect(items).toEqual(["Змінити категорію", "Додати теги", "Підтвердити категорії", "—", "Видалити"]);
  });

  it("CMP-73@PoC FR «Поведінка»: «×» «Зняти вибір» calls the consumer's clear with Enter as with a click", () => {
    const onClear = vi.fn();
    render(bar({ onClear }));
    const clear = screen.getByRole("button", { name: "Зняти вибір" });
    act(() => clear.focus());
    fireEvent.keyDown(clear, { key: "Enter" });
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("CMP-73@PoC FR «Клавіатура і екранний читач»: ← → move between the controls; each change of the selection is announced politely «Вибрано 3 · Сума −52,30 €»", () => {
    const { rerender } = render(bar());
    const status = screen.getByRole("status");
    expect(plain(status.textContent)).toBe("Вибрано 2 · Сума −238,90 €");
    rerender(bar({ count: 3, sum: { amount: { value: "-52.30", currency: "EUR" } } }));
    expect(plain(status.textContent)).toBe("Вибрано 3 · Сума −52,30 €");
    const actions = screen.getByRole("button", { name: "Дії з вибраними" });
    act(() => actions.focus());
    fireEvent.keyDown(actions, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Зняти вибір" }));
  });

  it("CMP-73@PoC FR «Стани»: the sum being recounted is muted with «Оновлюється…»; «приблизно» with the hint of the sum", () => {
    const { rerender } = render(
      bar({ sum: { amount: { value: "-238.90", currency: "EUR" }, updating: true } }),
    );
    expect(document.querySelector(".ws-selection-sum-updating")).not.toBeNull();
    expect(plain(screen.getByRole("toolbar").textContent)).toContain("Оновлюється…");
    rerender(
      bar({
        sum: {
          amount: { value: "-238.90", currency: "EUR" },
          approximate: true,
          hint: "1 транзакція за найближчим курсом",
        },
      }),
    );
    const sum = screen.getByText(/^Сума приблизно/);
    act(() => sum.focus());
    expect(screen.getByRole("tooltip").textContent).toBe("1 транзакція за найближчим курсом");
  });

  it("CMP-73@PoC FR «Стани»: a bulk action in the background — «Дії з вибраними» is inactive with the hint «Інша масова дія ще виконується»", () => {
    render(bar({ busy: true }));
    const button = screen.getByRole("button", { name: "Дії з вибраними" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
    act(() => button.focus());
    expect(screen.getByRole("tooltip").textContent).toBe("Інша масова дія ще виконується");
  });

  it("CMP-73@PoC FR «Розміри і стиль»: on-brand text on brand, the brand-on-white button and the on-brand focus ring keep their contrast", () => {
    const light = (name: keyof typeof colors) => colors[name].light;
    expect(contrastRatio(light("on-brand"), light("brand"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light("brand"), light("surface-200"))).toBeGreaterThanOrEqual(4.5);
  });
});

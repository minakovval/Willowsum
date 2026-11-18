import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CardFilter, CardFilterChips } from "./CardFilter.tsx";

const OPTIONS = [
  { id: "notStarted", label: "Не почато", count: 2 },
  { id: "over", label: "Перевищено", count: 4 },
];

function Card() {
  const [state, setState] = useState<string[]>([]);
  const toggle = (_: string, id: string) =>
    setState((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  return (
    <div>
      <CardFilter
        count={state.length}
        sections={[
          {
            id: "state",
            label: "Стан",
            options: OPTIONS.map((o) => ({ ...o, checked: state.includes(o.id) })),
          },
        ]}
        onToggle={toggle}
        onReset={() => setState([])}
        shown={state.length ? 4 : 15}
        all={15}
      />
      <CardFilterChips
        chips={state.map((id) => ({ id, field: "Стан", value: id, text: `Стан: ${id}` }))}
        onRemove={(id) => toggle("state", id)}
      />
    </div>
  );
}

describe("CMP-32@PoC FR 8 variant «у картці»", () => {
  it("CMP-32@PoC FR 8: the button opens a menu (not a dialog) of check items with counts, no «Застосувати»", () => {
    render(<Card />);
    const button = screen.getByRole("button", { name: "Фільтри" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitemcheckbox", { name: /Перевищено/ });
    expect(item.getAttribute("aria-checked")).toBe("false");
    expect(item.textContent).toContain("4");
    expect(within(menu).queryByRole("button", { name: /Застосувати|Показати/ })).toBeNull();
    expect(within(menu).getByText("Показано 15 з 15")).toBeTruthy();
  });

  it("CMP-32@PoC FR 8, AC8: a choice acts at once — «Фільтри · 1», the chip and «Показано 4 з 15» — and the menu stays open", () => {
    render(<Card />);
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Перевищено/ }));
    expect(screen.getByRole("button", { name: "Фільтри · 1" })).toBeTruthy();
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Показано 4 з 15")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прибрати фільтр: Стан — over" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Скинути" }));
    expect(screen.getByRole("button", { name: "Фільтри" })).toBeTruthy();
  });

  it("CMP-32@PoC FR 8: arrows move between the items, Escape closes the menu and the focus goes back to the button", () => {
    render(<Card />);
    const button = screen.getByRole("button", { name: "Фільтри" });
    fireEvent.click(button);
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("CMP-32@PoC FR 8: a press outside closes the menu without changing the filter", () => {
    render(<Card />);
    fireEvent.click(screen.getByRole("button", { name: "Фільтри" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuButton } from "./MenuButton.tsx";

/** The menu button's action items (FIN-01@PoC FR 22: «Параметри» → «Показати закриті» on «Рахунки»). */
describe("MenuButton action and checkbox items", () => {
  it("an item with `checked` is a menuitemcheckbox; choosing it runs the action, closes the menu and returns focus", () => {
    const onSelect = vi.fn();
    render(
      <MenuButton
        menuLabel="Параметри"
        ariaLabel="Параметри"
        placement="down"
        align="end"
        className="ws-icon-button"
        items={[{ id: "closed", label: "Показати закриті", icon: "eye", checked: false, onSelect }]}
      >
        ⚙
      </MenuButton>,
    );
    const button = screen.getByRole("button", { name: "Параметри" });
    fireEvent.click(button);
    expect(screen.getByRole("menu").className).toContain("ws-menu-end");
    const item = screen.getByRole("menuitemcheckbox", { name: "Показати закриті" });
    expect(item.getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(item);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("arrows move between action items and Esc closes the menu", () => {
    render(
      <MenuButton
        menuLabel="Меню"
        placement="down"
        className="b"
        items={[
          { id: "a", label: "Перший", icon: "eye", onSelect: () => {} },
          { id: "b", label: "Другий", icon: "eye", href: "#/x" },
        ]}
      >
        Меню
      </MenuButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Меню" }));
    const [first, second] = screen.getAllByRole("menuitem");
    expect(first!.tagName).toBe("BUTTON");
    expect(second!.tagName).toBe("A");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

const shellCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles/shell.css"),
  "utf8",
).replace(/\s+/g, " ");

/** The «…» card menu of S-053 (FIN-12@PoC d), GRID-02@PoC FR 15): «Закрити рахунок» is the dangerous item. */
describe("MenuButton dangerous item", () => {
  it("CMP-61@PoC AC4: a dangerous item is last, after a separator, in `loss`; arrows skip the separator", () => {
    render(
      <MenuButton
        menuLabel="Ще дії"
        ariaLabel="Ще дії"
        placement="down"
        align="end"
        className="ws-icon-button"
        items={[
          { id: "balance", label: "Оновити залишок", icon: "edit", onSelect: () => {} },
          { id: "close", label: "Закрити рахунок", icon: "lock", onSelect: () => {}, danger: true },
        ]}
      >
        …
      </MenuButton>,
    );
    const button = screen.getByRole("button", { name: "Ще дії" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    const children = [...menu.children].map((li) => li.getAttribute("role"));
    expect(children).toEqual(["none", "separator", "none"]);
    const [first, last] = screen.getAllByRole("menuitem");
    expect(last!.textContent).toContain("Закрити рахунок");
    expect(last!.getAttribute("data-tone")).toBe("danger");
    expect(first!.getAttribute("data-tone")).toBeNull();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);
    expect(shellCss).toContain('.ws-menu-item[data-tone="danger"] { color: var(--ws-loss); }');
    expect(shellCss).toContain(
      ".ws-menu-separator { height: 1px; margin: var(--ws-space-1) var(--ws-space-2); background: var(--ws-line); }",
    );
    expect(shellCss).toContain(
      '.ws-icon-button[aria-haspopup="menu"][aria-expanded="true"] { background: var(--ws-surface-300); }',
    );
  });
});

describe("MenuButton separators and note", () => {
  it("BUD-01@PoC FR 12: `separator` puts a separator before an item; `note` is a line under the items that describes the menu", () => {
    render(
      <MenuButton
        menuLabel="Дії"
        ariaLabel="Ще дії"
        placement="down"
        className="b"
        note="Категорію з транзакціями не можна видалити"
        items={[
          { id: "a", label: "Перейменувати", icon: "edit" },
          { id: "b", label: "Приховати", icon: "eye-off", separator: true },
        ]}
      >
        …
      </MenuButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ще дії" }));
    const menu = screen.getByRole("menu");
    expect([...menu.children].map((c) => c.getAttribute("role"))).toEqual([
      "none",
      "separator",
      "none",
      "separator",
      "none",
    ]);
    const note = document.getElementById(menu.getAttribute("aria-describedby")!)!;
    expect(note.textContent).toBe("Категорію з транзакціями не можна видалити");
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
});

const ITEMS = [
  { id: "a", label: "Перший", icon: "edit", onSelect: () => {} },
  { id: "b", label: "Другий", icon: "eye", onSelect: () => {} },
  { id: "c", label: "Третій", icon: "lock", onSelect: () => {} },
] as const;

function Menu() {
  return (
    <>
      <button type="button">Раніше</button>
      <MenuButton
        menuLabel="Параметри"
        ariaLabel="Параметри"
        placement="down"
        align="end"
        className="ws-icon-button"
        items={ITEMS}
      >
        ⚙
      </MenuButton>
    </>
  );
}

describe("CMP-61@PoC Menu keyboard", () => {
  it("CMP-61@PoC AC1: «Параметри» is a native button — Enter and Space press it — and pressing it opens `role=menu` with the focus on the first item", () => {
    render(<Menu />);
    const button = screen.getByRole("button", { name: "Параметри" });
    // A native `<button type="button">` turns Enter and Space into a click in the browser; jsdom does not, so the click stands in for the key.
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(screen.queryByRole("menu")).toBeNull();
    button.focus();
    fireEvent.click(button);
    const menu = screen.getByRole("menu", { name: "Параметри" });
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Перший" }));
  });

  it("CMP-61@PoC AC2: ↓ on the last item moves the focus to the first, ↑ on the first to the last", () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    const [first, second, third] = screen.getAllByRole("menuitem");
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(third);
  });

  it("CMP-61@PoC AC3: Esc closes the menu and the focus goes back to the button, not to the item or the page", () => {
    render(<Menu />);
    const button = screen.getByRole("button", { name: "Параметри" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Другий" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});

describe("CMP-61@PoC Menu items", () => {
  it("CMP-61@PoC AC6: every item has a 16 px icon to the left of its text", () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    for (const item of screen.getAllByRole("menuitem")) {
      const icon = item.querySelector("svg")!;
      expect(icon.getAttribute("width"), item.textContent ?? "").toBe("16");
      expect(icon.getAttribute("height")).toBe("16");
      const wrap = item.firstElementChild!;
      expect(wrap.className).toBe("ws-icon");
      expect(wrap.getAttribute("data-size")).toBe("16");
      expect(wrap.contains(icon)).toBe(true);
      expect(wrap.nextElementSibling!.className).toBe("ws-menu-label");
    }
  });

  it("CMP-61@PoC AC9: a «…» button is read and shown as «Ще дії», says it opens a menu and whether it is open", () => {
    render(
      <MenuButton
        menuLabel="Ще дії"
        ariaLabel="Ще дії"
        title="Ще дії"
        placement="down"
        align="end"
        className="ws-icon-button"
        items={ITEMS}
      >
        …
      </MenuButton>,
    );
    const button = screen.getByRole("button", { name: "Ще дії" });
    expect(button.getAttribute("title")).toBe("Ще дії");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "Ще дії" })).toBeTruthy();
  });
});

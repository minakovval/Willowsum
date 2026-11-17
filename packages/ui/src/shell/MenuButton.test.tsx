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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FilterBar } from "../filter/FilterBar.tsx";
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

describe("CMP-61@PoC Menu placement", () => {
  const rectOf = (top: number, bottom: number) =>
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top,
      bottom,
      left: 0,
      right: 40,
      width: 40,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("CMP-61@PoC AC5: a button near the bottom edge of the window opens the menu above it, a button with room below opens it below", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    rectOf(760, 800);
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    expect(screen.getByRole("menu").className).toContain("ws-menu-up");
    expect(screen.getByRole("menu").className).not.toContain("ws-menu-down");
    // The CSS puts `up` above the button, 4 px from its top edge.
    expect(shellCss).toMatch(/\.ws-menu-up\s*\{[^}]*inset-block-end:\s*calc\(100% \+ var\(--ws-space-1\)\)/);
    cleanup();

    rectOf(100, 140);
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    expect(screen.getByRole("menu").className).toContain("ws-menu-down");
  });

  it("CMP-61@PoC AC5: a menu that fits below stays below, and one that fits neither way opens on the side with more room", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    rectOf(300, 340);
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    expect(screen.getByRole("menu").className).toContain("ws-menu-down");
    cleanup();

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(200);
    rectOf(100, 140);
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "Параметри" }));
    expect(screen.getByRole("menu").className).toContain("ws-menu-up");
  });
});

const components = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles/components.css"),
  "utf8",
);

describe("CMP-61@PoC Popover of the filters", () => {
  it("CMP-61@PoC AC7: the filter panel opens under its button, lined up with the button's edge, and a drop-down in it opens under its own row", () => {
    render(
      <FilterBar count={2} chips={[]} onRemove={() => {}} onApply={() => {}} onReset={() => {}}>
        <span>rows</span>
      </FilterBar>,
    );
    const button = screen.getByRole("button", { name: /^Фільтри/ });
    fireEvent.click(button);
    const panel = screen.getByRole("dialog");
    // The bar is the positioning box and the button its first child: the panel's start edge is the button's.
    expect(panel.parentElement).toBe(button.parentElement);
    expect(button.parentElement!.firstElementChild).toBe(button);
    expect(components).toMatch(/\.ws-filter-bar\s*\{[^}]*position:\s*relative/);
    const panelRule = /\n\.ws-filter-panel\s*\{([^}]*)\}/.exec(components)![1]!;
    expect(panelRule).toMatch(/position:\s*absolute/);
    expect(panelRule).toMatch(/inset-inline-start:\s*0/);
    expect(panelRule).toMatch(/inset-block-start:\s*calc\(100% \+ var\(--ws-space-2\)\)/);
    // A drop-down panel hangs under the control of its row, the full width of that control.
    const dropdown = /\n\.ws-dropdown-panel\s*\{([^}]*)\}/.exec(components)![1]!;
    expect(dropdown).toMatch(/inset-inline:\s*0/);
    expect(dropdown).toMatch(/inset-block-start:\s*calc\(100% \+ var\(--ws-space-1\)\)/);
    expect(/\n\.ws-filter-row__control\s*\{([^}]*)\}/.exec(components)![1]).toMatch(/position:\s*relative/);
  });
});

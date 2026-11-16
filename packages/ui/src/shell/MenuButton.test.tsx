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

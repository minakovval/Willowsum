import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { MoreActions, RowActions } from "./MoreActions.tsx";
import type { MenuItem } from "./MenuButton.tsx";

afterEach(cleanup);

const EXPORT: MenuItem = { id: "export", label: "Експортувати", icon: "download" };
const DUPLICATE: MenuItem = { id: "duplicate", label: "Дублювати", icon: "note" };
const DELETE: MenuItem = { id: "delete", label: "Видалити", icon: "trash", danger: true };

describe("CMP-61@PoC single extra action", () => {
  it("CMP-61@PoC AC11: a single action that is not dangerous is a button with its name — there is no «…» with one item", () => {
    const onSelect = vi.fn();
    render(<MoreActions items={[{ ...EXPORT, onSelect }]} />);
    expect(screen.queryByRole("button", { name: "Ще дії" })).toBeNull();
    const button = screen.getByRole("button", { name: "Експортувати" });
    expect(button.hasAttribute("aria-haspopup")).toBe(false);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("CMP-61@PoC AC11: a link action is a link-button with its name", () => {
    render(<MoreActions items={[{ ...EXPORT, href: "#/export" }]} />);
    expect(screen.getByRole("link", { name: "Експортувати" }).getAttribute("href")).toBe("#/export");
    expect(screen.queryByRole("button", { name: "Ще дії" })).toBeNull();
  });

  it("CMP-61@PoC AC11: several actions, or a single dangerous one, are the «…» button «Ще дії» with a menu", () => {
    render(<MoreActions items={[DUPLICATE, EXPORT]} />);
    expect(screen.getByRole("button", { name: "Ще дії" }).getAttribute("aria-haspopup")).toBe("menu");
    cleanup();
    render(<MoreActions items={[DELETE]} />);
    const more = screen.getByRole("button", { name: "Ще дії" });
    fireEvent.click(more);
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Видалити" })).toBeTruthy();
  });

  it("CMP-61@PoC AC11: the English name comes from the catalogue", () => {
    render(
      <I18nProvider initialLocale="en">
        <MoreActions items={[DUPLICATE, EXPORT]} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });
});

describe("CMP-61@PoC row actions", () => {
  it("CMP-61@PoC AC10: the «…» at the end of the row opens every action, the pencil before it only edits the value in place", () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const { container } = render(
      <RowActions
        items={[{ ...DUPLICATE, onSelect: onDuplicate }, DELETE]}
        editLabel="Редагувати суму"
        onEdit={onEdit}
      />,
    );
    const buttons = within(container).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Редагувати суму", "Ще дії"]);
    expect(buttons[1]!.getAttribute("aria-haspopup")).toBe("menu");
    expect(buttons[0]!.hasAttribute("aria-haspopup")).toBe(false);

    fireEvent.click(buttons[0]!);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(buttons[1]!);
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Дублювати", "Видалити"]);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("CMP-61@PoC AC10: a row without in-place edit has only «…»", () => {
    const { container } = render(<RowActions items={[DUPLICATE, DELETE]} />);
    expect(
      within(container)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Ще дії"]);
  });
});

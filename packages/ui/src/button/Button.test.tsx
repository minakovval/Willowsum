import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { ICON_STROKE_BUTTON } from "../tokens/layout.ts";
import { Button, ButtonRow, primaryButtonViolations } from "./Button.tsx";

/**
 * CMP-01@PoC Button: markup, keyboard, screen-reader behaviour and the press guard. Sizes, colours and motion
 * are checked on the stylesheet in `Button.css.test.ts` (jsdom does not resolve `var(--ws-…)`).
 */
afterEach(cleanup);

const tooltipOf = (el: HTMLElement) => {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return ids.map((id) => document.getElementById(id)!).find((n) => n.getAttribute("role") === "tooltip")!;
};

describe("CMP-01@PoC Button", () => {
  it("CMP-01@PoC AC1: at most one primary per area — two primaries side by side are reported, one per area is not", () => {
    const { container } = render(
      <main>
        <section aria-label="a">
          <ButtonRow>
            <Button label="Скасувати" variant="quiet" />
            <Button label="Зберегти ціль" variant="primary" />
          </ButtonRow>
        </section>
        <form aria-label="b">
          <Button label="Додати рахунок" variant="primary" />
        </form>
      </main>,
    );
    expect(primaryButtonViolations(container)).toEqual([]);
    cleanup();

    const { container: two } = render(
      <section aria-label="c">
        <Button label="Зберегти" variant="primary" />
        <Button label="Додати" variant="primary" />
      </section>,
    );
    expect(primaryButtonViolations(two)).toHaveLength(2);
  });

  it("CMP-01@PoC AC1: the variant is a class on the native button; secondary is the default", () => {
    render(
      <>
        <Button label="Зберегти" variant="primary" />
        <Button label="Імпортувати виписку" />
        <Button label="Скасувати" variant="quiet" />
        <Button label="Видалити рахунок" variant="danger" />
      </>,
    );
    const cls = (name: string) => screen.getByRole("button", { name }).className;
    expect(cls("Зберегти")).toBe("ws-button ws-button-primary");
    expect(cls("Імпортувати виписку")).toBe("ws-button");
    expect(cls("Скасувати")).toBe("ws-button ws-button-quiet");
    expect(cls("Видалити рахунок")).toBe("ws-button ws-button-danger");
  });

  it("CMP-01@PoC AC3: every variant is reached with Tab (a native button, in the focus order) and activated by Enter and Space", () => {
    const pressed: string[] = [];
    render(
      <>
        {(["primary", "secondary", "quiet", "danger"] as const).map((v) => (
          <Button key={v} label={v} variant={v} onClick={() => pressed.push(v)} />
        ))}
      </>,
    );
    for (const v of ["primary", "secondary", "quiet", "danger"]) {
      const button = screen.getByRole("button", { name: v });
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.tabIndex).toBe(0);
      act(() => button.focus());
      expect(document.activeElement).toBe(button);
      // A native button turns Enter and Space into a click; jsdom does not, so the click stands for both.
      fireEvent.click(button);
    }
    expect(pressed).toEqual(["primary", "secondary", "quiet", "danger"]);
  });

  it("CMP-01@PoC AC4: while loading a second press does not start the action, the label stays, the spinner takes the icon slot", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button label="Зберегти" variant="primary" loading={false} onClick={onClick} />,
    );
    const button = screen.getByRole("button", { name: "Зберегти" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button label="Зберегти" variant="primary" loading onClick={onClick} />);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".ws-button-label")!.textContent).toBe("Зберегти");
    const slot = button.querySelector(".ws-button-slot")!;
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.querySelector(".ws-spinner.ws-button-spinner")).not.toBeNull();
    // The accessible name stays the label: the spinner is hidden.
    expect(screen.getByRole("button", { name: "Зберегти" })).toBe(button);

    rerender(<Button label="Зберегти" variant="primary" icon="check" loading onClick={onClick} />);
    expect(button.querySelectorAll(".ws-button-slot")).toHaveLength(1);
    expect(button.querySelector(".ws-button-slot .ws-icon")).toBeNull();
    rerender(<Button label="Зберегти" variant="primary" icon="check" loading={false} onClick={onClick} />);
    expect(button.querySelector(".ws-button-slot .ws-icon")).not.toBeNull();
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("CMP-01@PoC AC4: a busy submit button does not submit its form again", () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button label="Зберегти" type="submit" variant="primary" loading />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("CMP-01@PoC AC4: a reader hears «Виконується» once when the action starts, and nothing after it ends", () => {
    const { rerender } = render(<Button label="Зберегти" loading={false} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    rerender(<Button label="Зберегти" loading />);
    expect(status.textContent).toBe("Виконується");
    rerender(<Button label="Зберегти" loading />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    rerender(<Button label="Зберегти" loading={false} />);
    expect(status.textContent).toBe("");
    cleanup();
    // A button that is never busy has no live region.
    render(<Button label="Скасувати" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("CMP-01@PoC AC5: a disabled button stays in the focus order, is announced as unavailable, ignores presses and has its reason beside it", () => {
    const onClick = vi.fn();
    render(
      <Button
        label="Зберегти"
        variant="primary"
        disabled
        disabledReason="Заповніть назву цілі"
        onClick={onClick}
      />,
    );
    const button = screen.getByRole("button", { name: "Зберегти" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    const reason = screen.getByText("Заповніть назву цілі");
    expect(reason.className).toBe("ws-disabled-reason");
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    expect(button.nextElementSibling).toBe(reason);
    expect(screen.getByRole("button", { description: "Заповніть назву цілі" })).toBe(button);
  });

  it("CMP-01@PoC AC6: an `sm` button carries the sm class (32 px visible, 44 px hit area on the stylesheet)", () => {
    render(<Button label="Зарахувати" size="sm" />);
    expect(screen.getByRole("button", { name: "Зарахувати" }).className).toBe("ws-button ws-button-sm");
  });

  it("CMP-01@PoC AC7: an icon-only button announces its name, and the pointer and focus show a tooltip with the same text", () => {
    render(<Button label="Додати транзакцію" icon="plus" iconOnly variant="primary" />);
    const button = screen.getByRole("button", { name: "Додати транзакцію" });
    expect(button.textContent).toBe("");
    expect(button.className).toContain("ws-button-icon-only");
    const tip = tooltipOf(button);
    expect(tip.hidden).toBe(true);
    act(() => button.focus());
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe("Додати транзакцію");
    act(() => button.blur());
    fireEvent.mouseEnter(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Додати транзакцію");
    fireEvent.mouseLeave(button);
  });

  it("CMP-01@PoC AC8: a 16 px icon stands before the label, decorative; «+» and «✓» are drawn with the 2 px stroke", () => {
    render(<Button label="Додати рахунок" icon="plus" variant="primary" />);
    const button = screen.getByRole("button", { name: "Додати рахунок" });
    const [slot, label] = [...button.children];
    expect(slot!.className).toBe("ws-button-slot");
    expect(label!.textContent).toBe("Додати рахунок");
    const icon = slot!.querySelector(".ws-icon")!;
    expect(icon.getAttribute("data-size")).toBe("16");
    // The 24-unit glyph is drawn at 16 px: 3 units = 2 px.
    expect((Number(slot!.querySelector("svg")!.getAttribute("stroke-width")) * 16) / 24).toBe(
      ICON_STROKE_BUTTON,
    );
    expect(ICON_STROKE_BUTTON).toBe(2);
  });

  it("CMP-01@PoC «Клавіатура і екранний читач»: with `href` it is a link that looks like a button", () => {
    render(<Button label="Додати рахунок" href="#/money/accounts/new" variant="primary" />);
    const link = screen.getByRole("link", { name: "Додати рахунок" });
    expect(link.getAttribute("href")).toBe("#/money/accounts/new");
    expect(link.className).toBe("ws-button ws-button-primary");
  });

  it("CMP-01@PoC: no text of its own — the label and the busy announcement follow the interface language", () => {
    render(
      <I18nProvider initialLocale="en">
        <Button label="Save" loading />
      </I18nProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("In progress");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

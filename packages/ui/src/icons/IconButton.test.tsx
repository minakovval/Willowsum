import { act, fireEvent, render, screen } from "@testing-library/react";
import { IconButton } from "./IconButton.tsx";

/** CMP-33@PoC / DS-12@PoC: icon-only buttons have a name and a tooltip with the same name (CMP-25@PoC Tooltip). */

const tooltipOf = (button: HTMLElement) => {
  const id = button.getAttribute("aria-describedby");
  expect(id, "the button is described by its tooltip").toBeTruthy();
  return document.getElementById(id!)!;
};

describe("IconButton (CMP-33@PoC, DS-12@PoC)", () => {
  it("CMP-33@PoC AC3: on keyboard focus «Фільтр» is announced, and the pointer shows the tooltip «Фільтр»", () => {
    render(<IconButton icon="filter" label="Фільтр" />);
    const button = screen.getByRole("button", { name: "Фільтр" });
    expect(button.textContent).toBe("");
    const tip = tooltipOf(button);
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.hidden).toBe(true);

    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    expect(tip.hidden, "keyboard focus shows the tooltip").toBe(false);
    expect(tip.textContent).toBe("Фільтр");
    act(() => button.blur());
    expect(tip.hidden).toBe(true);

    fireEvent.mouseEnter(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Фільтр");
    fireEvent.mouseLeave(button);
    expect(tip.hidden).toBe(true);
  });

  it("DS-12@PoC AC2: an icon-only button has an accessible name and a tooltip with the same name", () => {
    for (const [icon, label] of [
      ["options", "Параметри"],
      ["columns", "Колонки"],
      ["sort", "Сортувати"],
      ["close", "Закрити"],
    ] as const) {
      const { unmount } = render(<IconButton icon={icon} label={label} />);
      const button = screen.getByRole("button", { name: label });
      expect(button.getAttribute("aria-label")).toBe(label);
      fireEvent.mouseEnter(button);
      expect(tooltipOf(button).textContent).toBe(label);
      unmount();
    }
  });

  it("DS-12@PoC FR 6: the icon inside is decorative and 20 px; no native title doubles the tooltip", () => {
    render(<IconButton icon="plus" label="Додати" />);
    const button = screen.getByRole("button", { name: "Додати" });
    expect(button.getAttribute("title")).toBeNull();
    const icon = button.querySelector(".ws-icon")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    const svg = icon.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    // «+» inside a button draws 2 px (DS-12@PoC item 2).
    expect(Number(svg.getAttribute("stroke-width")) * (20 / 24)).toBeCloseTo(2, 2);
  });

  it("CMP-33@PoC «Стани»: the icon takes its state from the button — Enter and Space act, a toggle reports aria-pressed", () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconButton icon="eye" label="Показати" onClick={onClick} pressed={false} />);
    const button = screen.getByRole("button", { name: "Показати" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    rerender(<IconButton icon="eye" label="Показати" onClick={onClick} pressed />);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    rerender(<IconButton icon="close" label="Закрити" />);
    expect(screen.getByRole("button", { name: "Закрити" }).hasAttribute("aria-pressed")).toBe(false);
  });

  it("Esc closes the tooltip without moving the focus (CMP-25@PoC, WCAG 1.4.13)", () => {
    render(<IconButton icon="filter" label="Фільтр" />);
    const button = screen.getByRole("button", { name: "Фільтр" });
    act(() => button.focus());
    const tip = tooltipOf(button);
    expect(tip.hidden).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Amount, HIDDEN_AMOUNT, HideAmountsProvider, HideAmountsToggle, Percent } from "./HideAmounts.tsx";

/** No-break spaces (DS-08 item 11) compare as ordinary spaces. */
const norm = (s: string | null) => (s ?? "").replace(/&nbsp;|\u00A0|\u202F/g, " ");

const REAL = "1 234 567,89 ₴";

const ui = (initialHidden: boolean) =>
  render(
    <HideAmountsProvider initialHidden={initialHidden}>
      <HideAmountsToggle />
      <Amount value={REAL} size="amount-m" />
      <Percent value="+2,4 %" />
    </HideAmountsProvider>,
  );

describe("«Приховати суми» (DS-18)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("shows amounts with tabular figures when the mode is off", () => {
    const { container } = ui(false);
    expect(norm(container.textContent)).toContain(REAL);
    expect(container.querySelector(".ws-text-amount-m")).not.toBeNull();
  });

  it("replaces amounts with ••• and keeps percentages; the real value is not in the DOM", () => {
    const { container } = ui(true);
    expect(norm(container.innerHTML)).not.toContain("1 234 567");
    expect(norm(container.textContent)).toContain(HIDDEN_AMOUNT);
    expect(norm(container.textContent)).toContain("+2,4 %");
    expect(screen.getByRole("button", { name: "Сума прихована" })).toBeTruthy();
  });

  it("the eye button toggles the mode and reports its pressed state", () => {
    const { container } = ui(false);
    const toggle = screen.getByRole("button", { name: "Приховати суми" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(norm(container.textContent)).not.toContain(REAL);
  });

  it("Enter shows the amount for 3 s, then hides it again", () => {
    vi.useFakeTimers();
    const { container } = ui(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Сума прихована" }), { key: "Enter" });
    expect(norm(container.textContent)).toContain(REAL);
    act(() => vi.advanceTimersByTime(2999));
    expect(norm(container.textContent)).toContain(REAL);
    act(() => vi.advanceTimersByTime(1));
    expect(norm(container.innerHTML)).not.toContain(REAL);
  });

  it("holding for 350 ms shows the amount; a shorter press does not", () => {
    vi.useFakeTimers();
    const { container } = ui(true);
    const amount = screen.getByRole("button", { name: "Сума прихована" });
    fireEvent.pointerDown(amount);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(amount);
    act(() => vi.advanceTimersByTime(500));
    expect(norm(container.innerHTML)).not.toContain(REAL);
    fireEvent.pointerDown(amount);
    act(() => vi.advanceTimersByTime(350));
    expect(norm(container.textContent)).toContain(REAL);
  });
});

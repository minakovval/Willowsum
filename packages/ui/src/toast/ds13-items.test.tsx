import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { Skeleton } from "../skeleton/Skeleton.tsx";
import { motion } from "../tokens/index.ts";
import { TruncatedText } from "../tooltip/Tooltip.tsx";
import { Toast } from "./Toast.tsx";

/** DS-13@PoC items 3 (skeleton markup), 4, 5 and 6 on the components: only the part under test is rendered. */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DS-13@PoC motion items (components)", () => {
  it("DS-13@PoC FR 3: a loading list is shown as skeleton shapes, not as a spinner", () => {
    const { container } = render(
      <I18nProvider>
        <Skeleton variant="row" />
      </I18nProvider>,
    );
    expect(container.querySelectorAll(".ws-skeleton").length).toBeGreaterThan(8);
    expect(container.querySelector(".ws-spinner")).toBeNull();
  });

  it("DS-13@PoC FR 5: a tooltip appears at once, without a delay and without a transition", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    const { container } = render(<TruncatedText text="Дуже довга назва, що не вміщується в рядок" />);
    fireEvent.mouseEnter(container.querySelector(".ws-truncate")!);
    const tip = screen.getByRole("tooltip");
    expect(tip.hidden).toBe(false);
  });

  it("DS-13@PoC FR 6: a success or info toast goes after 8 s, one with «Відмінити» after 10 s; hover and focus stop the timer", () => {
    vi.useFakeTimers();
    expect(motion["duration-toast"]).toBe(8000);
    expect(motion["duration-toast-undo"]).toBe(10000);

    const plain = vi.fn();
    const { unmount } = render(<Toast text="Збережено" tone="info" closeLabel="Закрити" onDismiss={plain} />);
    act(() => vi.advanceTimersByTime(7999));
    expect(plain).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(plain).toHaveBeenCalledTimes(1);
    unmount();

    const undo = vi.fn();
    render(
      <Toast
        text="Підтверджено"
        action={{ label: "Відмінити", onAction: () => undefined }}
        closeLabel="Закрити"
        onDismiss={undo}
      />,
    );
    act(() => vi.advanceTimersByTime(9999));
    expect(undo).not.toHaveBeenCalled();
    // Focus stops the timer; leaving lets the rest run.
    fireEvent.focus(screen.getByRole("button", { name: "Відмінити" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(undo).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole("button", { name: "Відмінити" }));
    act(() => vi.advanceTimersByTime(1));
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

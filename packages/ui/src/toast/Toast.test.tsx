import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { motion } from "../tokens/index.ts";
import { Toast } from "./Toast.tsx";

/**
 * The toast the review queue uses for «Відмінити» (BUD-12@PoC FR 6; the CMP-20 subset it needs: one message with one
 * action and «×», read as a status without taking the focus, closing itself on the token timers).
 */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast (BUD-12@PoC FR 6)", () => {
  it("BUD-12@PoC FR 6: «Відмінити» is the one action, the message is a status that does not take the focus", () => {
    const onAction = vi.fn();
    const before = document.activeElement;
    render(
      <Toast
        text="Категорію підтверджено"
        action={{ label: "Відмінити", onAction }}
        closeLabel="Закрити"
        onDismiss={() => undefined}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Категорію підтверджено");
    expect(document.activeElement).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Відмінити" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Закрити" })).toBeTruthy();
    // The marker is decorative: the state is in the words, not only in the colour (NFR-08 FR 4).
    expect(status.querySelector(".ws-toast-marker")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("BUD-12@PoC FR 6: with «Відмінити» it closes itself after `duration-toast-undo`, the pointer over it stops the timer", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast
        text="Категорію підтверджено"
        action={{ label: "Відмінити", onAction: () => undefined }}
        closeLabel="Закрити"
        onDismiss={onDismiss}
      />,
    );
    act(() => vi.advanceTimersByTime(motion["duration-toast"] + 1));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(motion["duration-toast-undo"]));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(motion["duration-toast-undo"] - motion["duration-toast"]));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("BUD-12@PoC FR 6: without an action it closes after `duration-toast`; an error stays; Esc inside and «×» close it", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const { rerender } = render(<Toast text="Готово" closeLabel="Закрити" onDismiss={done} />);
    act(() => vi.advanceTimersByTime(motion["duration-toast"]));
    expect(done).toHaveBeenCalledTimes(1);

    const error = vi.fn();
    rerender(<Toast key="e" text="Дію не виконано" tone="error" closeLabel="Закрити" onDismiss={error} />);
    act(() => vi.advanceTimersByTime(motion["duration-toast-undo"] * 3));
    expect(error).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Закрити" }), { key: "Escape" });
    expect(error).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    expect(error).toHaveBeenCalledTimes(2);
  });
});

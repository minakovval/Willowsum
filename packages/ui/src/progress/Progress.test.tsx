import { act, cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { motion } from "../tokens/index.ts";
import { Progress } from "./Progress.tsx";

/**
 * CMP-74@PoC Progress: the markup, text, ARIA and announcements. The sizes, colours and motion of the bar are
 * checked on the stylesheet in `Progress.css.test.ts`.
 */

/** No-break and narrow no-break spaces (DS-08 item 11) compare as ordinary spaces. */
const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");
const bar = () => screen.getByRole("progressbar");
const fill = (root: ParentNode) => root.querySelector<HTMLElement>(".ws-progress-fill")!;
const status = (root: ParentNode) => root.querySelector<HTMLElement>(".ws-progress-text")!;
const live = () => screen.getByRole("status");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CMP-74@PoC Progress", () => {
  it("CMP-74@PoC AC1: a review queue of 103 with 31 done fills 30 % of the track in `link`, «31 з 103 · лишилось 72» beside it", () => {
    const { container } = render(<Progress label="Розібрано" value={31} max={103} />);
    const f = fill(container);
    expect(parseFloat(f.style.inlineSize)).toBeCloseTo((31 / 103) * 100, 1);
    expect(Math.round(parseFloat(f.style.inlineSize))).toBe(30);
    // The fill colour comes from its state class (`link` while running, see the CSS test).
    expect(container.querySelector(".ws-progress")!.getAttribute("data-state")).toBe("running");
    expect(f.parentElement!.classList.contains("ws-progress-track")).toBe(true);

    expect(norm(status(container).textContent)).toBe("31 з 103 · лишилось 72");
    // The count in 600 tabular `ink`, the rest `ink-muted` (the classes the stylesheet paints).
    const count = container.querySelector(".ws-progress-count")!;
    expect(norm(count.textContent)).toBe("31 з 103");
    expect(count.tagName).toBe("B");
    // Beside the bar (inline layout: track first, then the text, in one row).
    const row = container.querySelector(".ws-progress-row")!;
    expect(row.classList.contains("ws-progress-row--inline")).toBe(true);
    expect(row.firstElementChild!.classList.contains("ws-progress-track")).toBe(true);
  });

  it("CMP-74@PoC AC1: the text can sit above the bar, and the place of use can name the step in its own words", () => {
    const { container } = render(
      <Progress
        label="Розпізнавання виписки"
        value={4}
        max={12}
        layout="stacked"
        text="Розпізнаємо сторінку 4 з 12"
      />,
    );
    const row = container.querySelector(".ws-progress-row")!;
    expect(row.classList.contains("ws-progress-row--stacked")).toBe(true);
    expect(row.lastElementChild!.classList.contains("ws-progress-track")).toBe(true);
    expect(status(container).textContent).toBe("Розпізнаємо сторінку 4 з 12");
    // ARIA still names done and total.
    expect(norm(bar().getAttribute("aria-valuetext"))).toBe("4 з 12, лишилось 8");
  });

  it("CMP-74@PoC AC2: a finished sync of 1 214 transactions fills the whole track in `gain` and reads «✓ Готово · 1 214»", () => {
    const { container } = render(
      <Progress label="Поточний ··4417" value={1214} max={1214} state="done" unit="транзакцій" />,
    );
    expect(container.querySelector(".ws-progress")!.getAttribute("data-state")).toBe("done");
    expect(fill(container).style.inlineSize).toBe("100%");
    const text = status(container);
    expect(norm(text.textContent)).toBe("✓ Готово · 1 214");
    expect(text.classList.contains("ws-progress-text--done")).toBe(true);
    expect(bar().getAttribute("aria-valuenow")).toBe("1214");
    expect(norm(bar().getAttribute("aria-valuetext"))).toBe("Готово, 1 214 транзакцій");
  });

  it("CMP-74@PoC AC3: recognition stopped by an error on page 4 of 12 keeps the fill at a third, «✕ Помилка · 4 з 12» in `loss`, and the place's action", () => {
    const retry = vi.fn();
    const { container } = render(
      <Progress
        label="Виписка PDF"
        value={4}
        max={12}
        state="error"
        action={
          <button type="button" className="ws-button" onClick={retry}>
            Спробувати ще раз
          </button>
        }
      />,
    );
    expect(container.querySelector(".ws-progress")!.getAttribute("data-state")).toBe("error");
    expect(parseFloat(fill(container).style.inlineSize)).toBeCloseTo(100 / 3, 1);
    const text = status(container);
    expect(norm(text.textContent)).toBe("✕ Помилка · 4 з 12");
    expect(text.classList.contains("ws-progress-text--error")).toBe(true);
    act(() => screen.getByRole("button", { name: "Спробувати ще раз" }).click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(norm(bar().getAttribute("aria-valuetext"))).toBe("Помилка, 4 з 12");
  });

  it("CMP-74@PoC AC3: the action shows only with an error", () => {
    render(
      <Progress
        label="Виписка PDF"
        value={4}
        max={12}
        action={<button type="button">Спробувати ще раз</button>}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("CMP-74@PoC AC4: role progressbar with aria-valuenow, aria-valuemin 0, aria-valuemax and aria-valuetext naming done and total; never focusable", () => {
    const { container } = render(<Progress label="Розібрано" value={31} max={103} />);
    const b = bar();
    expect(b).toBe(screen.getByRole("progressbar", { name: "Розібрано" }));
    expect(b.getAttribute("aria-valuenow")).toBe("31");
    expect(b.getAttribute("aria-valuemin")).toBe("0");
    expect(b.getAttribute("aria-valuemax")).toBe("103");
    expect(norm(b.getAttribute("aria-valuetext"))).toBe("31 з 103, лишилось 72");
    expect(container.querySelectorAll("[tabindex], a[href], input, select, textarea")).toHaveLength(0);
    expect(b.hasAttribute("tabindex")).toBe(false);
  });

  it("CMP-74@PoC AC4: changes are announced politely at most once every 5 s, the completion at once", () => {
    vi.useFakeTimers();
    const gap = motion["duration-progress-announce"];
    expect(gap).toBe(5000);
    const view = (value: number, state?: "done") => (
      <Progress label="Синхронізація" value={value} max={1214} unit="транзакцій" state={state} />
    );
    const { rerender } = render(view(0));
    const region = live();
    expect(region.getAttribute("aria-live") ?? "polite").toBe("polite");
    expect(region.classList.contains("ws-visually-hidden")).toBe(true);
    // Not inside the progressbar, so it is one announcement, not a re-read of the bar.
    expect(bar().contains(region)).toBe(false);
    expect(region.textContent).toBe("");

    rerender(view(100));
    expect(norm(region.textContent)).toBe("100 з 1 214, лишилось 1 114");

    act(() => vi.advanceTimersByTime(1000));
    rerender(view(200));
    act(() => vi.advanceTimersByTime(1000));
    rerender(view(300));
    // Under 5 s since the last announcement: still the old text.
    expect(norm(region.textContent)).toBe("100 з 1 214, лишилось 1 114");
    act(() => vi.advanceTimersByTime(gap - 2001));
    expect(norm(region.textContent)).toBe("100 з 1 214, лишилось 1 114");
    // At 5 s the latest value is announced, once.
    act(() => vi.advanceTimersByTime(1));
    expect(norm(region.textContent)).toBe("300 з 1 214, лишилось 914");

    // The completion is announced at once, even 1 s after the last announcement.
    act(() => vi.advanceTimersByTime(1000));
    rerender(view(1214, "done"));
    expect(norm(region.textContent)).toBe("Готово, 1 214 транзакцій");
    // No stale running text replaces it later.
    act(() => vi.advanceTimersByTime(gap * 2));
    expect(norm(region.textContent)).toBe("Готово, 1 214 транзакцій");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("CMP-74@PoC AC4: an error is announced at once", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Progress label="Виписка PDF" value={3} max={12} />);
    rerender(<Progress label="Виписка PDF" value={4} max={12} />);
    rerender(<Progress label="Виписка PDF" value={4} max={12} state="error" />);
    expect(norm(live().textContent)).toBe("Помилка, 4 з 12");
  });

  it("CMP-74@PoC AC5: with reduced motion the fill changes without animation (no shimmer, no animated element)", () => {
    const { container, rerender } = render(<Progress label="Розібрано" value={31} max={103} />);
    rerender(<Progress label="Розібрано" value={62} max={103} />);
    // The width is set at once; motion lives only in the stylesheet, which drops it with reduced motion.
    expect(Math.round(parseFloat(fill(container).style.inlineSize))).toBe(60);
    expect(fill(container).style.transition).toBe("");
    expect(container.querySelector(".ws-skeleton, .ws-spinner")).toBeNull();
  });

  it("CMP-74@PoC AC6: while the number of steps is unknown the track is empty and reads «Рахуємо…»; no shimmer, no value", () => {
    const { container } = render(<Progress label="Синхронізація" />);
    expect(container.querySelector(".ws-progress")!.getAttribute("data-state")).toBe("counting");
    expect(fill(container)).toBeNull();
    expect(status(container).textContent).toBe("Рахуємо…");
    const b = bar();
    // Indeterminate: no aria-valuenow (WAI-ARIA progressbar), so no value text either.
    expect(b.hasAttribute("aria-valuenow")).toBe(false);
    expect(b.hasAttribute("aria-valuetext")).toBe(false);
    expect(b.getAttribute("aria-valuemin")).toBe("0");
    expect(container.querySelector(".ws-skeleton, .ws-spinner")).toBeNull();
    cleanup();

    // A known maximum can still be in the counting state when the place says so.
    const { container: c2 } = render(<Progress label="Синхронізація" value={0} max={10} state="counting" />);
    expect(c2.querySelector(".ws-progress-fill")).toBeNull();
    expect(c2.querySelector("[role=progressbar]")!.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("CMP-74@PoC: colour is never the only sign — every state is named in text", () => {
    const states = [
      [<Progress key="r" label="x" value={1} max={3} />, "1 з 3 · лишилось 2"],
      [<Progress key="c" label="x" />, "Рахуємо…"],
      [<Progress key="d" label="x" value={3} max={3} state="done" />, "✓ Готово · 3"],
      [<Progress key="e" label="x" value={1} max={3} state="error" />, "✕ Помилка · 1 з 3"],
    ] as const;
    for (const [node, text] of states) {
      const { container } = render(node);
      expect(norm(status(container).textContent)).toBe(text);
      cleanup();
    }
  });

  it("CMP-74@PoC: numbers are not shortened below 10 000 and the value stays within 0 … max", () => {
    const { container, rerender } = render(<Progress label="x" value={9999} max={9999} state="done" />);
    expect(norm(status(container).textContent)).toBe("✓ Готово · 9 999");
    rerender(<Progress label="x" value={500} max={1200} />);
    expect(norm(status(container).textContent)).toBe("500 з 1 200 · лишилось 700");
    rerender(<Progress label="x" value={150} max={100} />);
    expect(bar().getAttribute("aria-valuenow")).toBe("100");
    expect(fill(container).style.inlineSize).toBe("100%");
    rerender(<Progress label="x" value={-3} max={100} />);
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    expect(fill(container).style.inlineSize).toBe("0%");
  });

  it("CMP-74@PoC: English text and announcements come from the catalogue", () => {
    render(
      <I18nProvider initialLocale="en">
        <Progress label="Reviewed" value={31} max={103} />
      </I18nProvider>,
    );
    expect(norm(document.querySelector(".ws-progress-text")!.textContent)).toBe("31 of 103 · 72 left");
    expect(norm(bar().getAttribute("aria-valuetext"))).toBe("31 of 103, 72 left");
  });
});

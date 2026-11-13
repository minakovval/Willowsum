import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FitAmount } from "../amount/FitAmount.tsx";
import { HideAmountsProvider } from "../privacy/HideAmounts.tsx";
import { space } from "../tokens/index.ts";
import { Tooltip, TruncatedText } from "./Tooltip.tsx";

/**
 * CMP-25@PoC Tooltip. jsdom has no layout, so the tests set the measured sizes: a box `clientWidth` wide holding
 * text `scrollWidth` wide is cut off with an ellipsis when the text is wider.
 */
const FULL_NAME = "Відпустка в Карпатах з дітьми влітку 2027 року";

function setBox(el: Element, { clientWidth, scrollWidth }: { clientWidth: number; scrollWidth: number }) {
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => clientWidth });
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => scrollWidth });
}

/** Sizes are read when the element mounts: set them on the prototype for the duration of a test. */
function mockTextBox(clientWidth: number, scrollWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
}

function rect(r: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...r,
    x: r.left,
    y: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
    toJSON: () => r,
  } as DOMRect;
}

/** Places the trigger at `trigger` and gives the tooltip panel the size `tip`. */
function mockGeometry(
  trigger: { left: number; top: number; width: number; height: number },
  tip: { width: number; height: number },
) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "tooltip") return rect({ left: 0, top: 0, ...tip });
    return rect(trigger);
  });
}

const tooltip = () => screen.queryByRole("tooltip", { hidden: true });
/** The cut-off text itself (the tooltip repeats it, so a text query would find both). */
const nameEl = () => document.querySelector<HTMLElement>(".ws-truncate")!;
const isShown = () => {
  const tip = tooltip();
  return tip !== null && !tip.hidden;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CMP-25@PoC Tooltip", () => {
  it("CMP-25@PoC AC1: a card name cut off with an ellipsis shows the full name at once on hover, at most 320 px wide", () => {
    vi.useFakeTimers();
    mockTextBox(120, 360);
    render(<TruncatedText text={FULL_NAME} />);
    const name = nameEl();
    expect(isShown()).toBe(false);

    fireEvent.mouseEnter(name);
    // No delay: shown in the same task, before any timer runs.
    expect(isShown()).toBe(true);
    expect(tooltip()!.textContent).toBe(FULL_NAME);

    // The 320 px limit is in the stylesheet: Tooltip.css.test.ts «CMP-25@PoC AC1».
  });

  it("CMP-25@PoC AC2: a name that fits has no tooltip on hover or Tab and does not take the focus", () => {
    mockTextBox(360, 360);
    render(
      <>
        <button type="button">До</button>
        <TruncatedText text="Подушка безпеки" />
      </>,
    );
    const name = screen.getByText("Подушка безпеки");
    fireEvent.mouseEnter(name);
    expect(tooltip()).toBeNull();
    expect(name.hasAttribute("tabindex")).toBe(false);
    expect(name.hasAttribute("aria-describedby")).toBe(false);
    // Tab from the previous control does not stop on the name: it is not in the tab order.
    const tabbable = [...document.querySelectorAll<HTMLElement>("button, [tabindex]")].filter(
      (el) => el.tabIndex >= 0,
    );
    expect(tabbable).toEqual([screen.getByRole("button", { name: "До" })]);
    fireEvent.focus(name);
    expect(tooltip()).toBeNull();
  });

  it("CMP-25@PoC AC3: Escape closes the tooltip of an abbreviated amount in focus", () => {
    // The box is 40 px; every text is 10 px per character, so only the abbreviation (still too wide) is chosen.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rect({ left: 400, top: 300, width: (this.textContent ?? "").length * 10, height: 20 });
    });
    render(
      <HideAmountsProvider>
        <div>
          <FitAmount value="12 345 678 901,00 €" compact="12,35 млрд €" size="amount-l" />
        </div>
      </HideAmountsProvider>,
    );
    const amount = document.querySelector<HTMLElement>(".ws-amount-fit")!;
    const norm = (t: string | null) => (t ?? "").replace(/\u00A0|\u202F/g, " ");
    expect(norm(amount.textContent)).toContain("12,35 млрд €");
    // Abbreviated → focusable, described by its tooltip with the full value.
    expect(amount.tabIndex).toBe(0);
    act(() => amount.focus());
    expect(isShown()).toBe(true);
    expect(norm(tooltip()!.textContent)).toBe("12 345 678 901,00 €");
    expect(amount.getAttribute("aria-describedby")).toBe(tooltip()!.id);

    fireEvent.keyDown(amount, { key: "Escape" });
    expect(isShown()).toBe(false);
    // Focus stays where it was.
    expect(document.activeElement).toBe(amount);
  });

  it("CMP-25@PoC AC4: scrolling the page closes an open tooltip", () => {
    mockTextBox(120, 360);
    render(<TruncatedText text={FULL_NAME} />);
    const name = nameEl();
    fireEvent.mouseEnter(name);
    expect(isShown()).toBe(true);
    fireEvent.scroll(window);
    expect(isShown()).toBe(false);

    // A scroll inside any scrolling area of the page closes it too.
    fireEvent.mouseLeave(name);
    fireEvent.mouseEnter(name);
    expect(isShown()).toBe(true);
    fireEvent.scroll(document.body);
    expect(isShown()).toBe(false);
  });

  describe("CMP-25@PoC FR «Стани»: opens on hover and keyboard focus, closes on Esc, leave, blur, scroll", () => {
    beforeEach(() => mockTextBox(120, 360));

    it("opens at once on keyboard focus and closes when the focus leaves", () => {
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      act(() => name.focus());
      expect(isShown()).toBe(true);
      act(() => name.blur());
      expect(isShown()).toBe(false);
    });

    it("keyboard focus that scrolls the element into view does not close it; a later scroll does", () => {
      vi.useFakeTimers();
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      act(() => name.focus());
      // The browser scrolls the focused element into view: that scroll event comes in the next frame.
      fireEvent.scroll(window);
      expect(isShown()).toBe(true);
      act(() => vi.advanceTimersToNextFrame());
      act(() => vi.advanceTimersToNextFrame());
      fireEvent.scroll(window);
      expect(isShown()).toBe(false);
    });

    it("focus that follows a click does not open it: moving the pointer away closes it while the focus stays", () => {
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      fireEvent.mouseEnter(name);
      fireEvent.mouseDown(name);
      act(() => name.focus());
      fireEvent.mouseUp(name);
      expect(isShown()).toBe(true);
      fireEvent.mouseLeave(name, { relatedTarget: document.body });
      expect(isShown()).toBe(false);
      expect(document.activeElement).toBe(name);
    });

    it("a press that does not move the focus is forgotten on release: the next keyboard focus opens it", () => {
      render(
        <>
          <button type="button">До</button>
          <TruncatedText text={FULL_NAME} />
        </>,
      );
      const name = nameEl();
      // e.g. a consumer's onMouseDown prevents the default, so the press gives no focus.
      fireEvent.mouseDown(name);
      fireEvent.mouseUp(name);
      act(() => screen.getByRole("button", { name: "До" }).focus());
      act(() => name.focus());
      expect(isShown()).toBe(true);
    });

    it("only one tooltip is open at a time", () => {
      render(
        <>
          <TruncatedText text={FULL_NAME} />
          <Tooltip text="Додати транзакцію">
            <button type="button" aria-label="Додати транзакцію">
              +
            </button>
          </Tooltip>
        </>,
      );
      fireEvent.mouseEnter(nameEl());
      act(() => screen.getByRole("button", { name: "Додати транзакцію" }).focus());
      const shown = screen.getAllByRole("tooltip", { hidden: true }).filter((t) => !t.hidden);
      expect(shown.map((t) => t.textContent)).toEqual(["Додати транзакцію"]);
    });

    it("forgets the hover when the text stops being cut off, and does not open by itself later", () => {
      let observed: ResizeObserverCallback | null = null;
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: ResizeObserverCallback) {
            observed = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      fireEvent.mouseEnter(name);
      expect(isShown()).toBe(true);
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(120);
      act(() => observed!([], {} as ResizeObserver));
      expect(tooltip()).toBeNull();
      // The pointer left while there was no tooltip (no handler to see it); the text is cut off again.
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(360);
      act(() => observed!([], {} as ResizeObserver));
      expect(isShown()).toBe(false);
      vi.unstubAllGlobals();
    });

    it("closes when the pointer leaves", () => {
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      fireEvent.mouseEnter(name);
      fireEvent.mouseLeave(name, { relatedTarget: document.body });
      expect(isShown()).toBe(false);
    });

    it("WCAG 1.4.13 hoverable: the pointer can move onto the tooltip without it closing", () => {
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      fireEvent.mouseEnter(name);
      const tip = tooltip()!;
      fireEvent.mouseLeave(name, { relatedTarget: tip });
      fireEvent.mouseEnter(tip);
      expect(isShown()).toBe(true);
      // Leaving the tooltip for the rest of the page closes it.
      fireEvent.mouseLeave(tip, { relatedTarget: document.body });
      expect(isShown()).toBe(false);
    });

    it("WCAG 1.4.13 persistent: stays open while hovered or focused, with no time-out", () => {
      vi.useFakeTimers();
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      fireEvent.mouseEnter(name);
      act(() => vi.advanceTimersByTime(60_000));
      expect(isShown()).toBe(true);
      // Focus keeps it open after the pointer leaves.
      act(() => name.focus());
      fireEvent.mouseLeave(name, { relatedTarget: document.body });
      expect(isShown()).toBe(true);
    });

    it("WCAG 1.4.13 dismissible: Esc closes a tooltip opened by hover without moving the pointer or focus", () => {
      render(
        <>
          <input aria-label="Пошук" />
          <TruncatedText text={FULL_NAME} />
        </>,
      );
      const input = screen.getByLabelText("Пошук");
      act(() => input.focus());
      const name = nameEl();
      fireEvent.mouseEnter(name);
      fireEvent.keyDown(input, { key: "Escape" });
      expect(isShown()).toBe(false);
      expect(document.activeElement).toBe(input);
      // It stays closed while the pointer rests there, and opens again on the next hover.
      fireEvent.mouseMove(name);
      expect(isShown()).toBe(false);
      fireEvent.mouseLeave(name, { relatedTarget: document.body });
      fireEvent.mouseEnter(name);
      expect(isShown()).toBe(true);
    });

    it("other keys leave it open", () => {
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      act(() => name.focus());
      fireEvent.keyDown(name, { key: "Shift" });
      expect(isShown()).toBe(true);
    });
  });

  describe("CMP-25@PoC FR «Стани»: placement", () => {
    beforeEach(() => {
      mockTextBox(120, 360);
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    });

    const place = () => {
      render(<TruncatedText text={FULL_NAME} />);
      fireEvent.mouseEnter(nameEl());
      const tip = tooltip()!;
      return {
        top: parseFloat(tip.style.top),
        left: parseFloat(tip.style.left),
        side: tip.dataset["placement"],
      };
    };

    it("above the element, centred on it", () => {
      mockGeometry({ left: 500, top: 300, width: 120, height: 20 }, { width: 200, height: 40 });
      // 300 − 4 gap − 40 = 256; centre 560 − 100 = 460.
      expect(place()).toEqual({ top: 256, left: 460, side: "top" });
    });

    it("below the element when there is no room above", () => {
      mockGeometry({ left: 500, top: 10, width: 120, height: 20 }, { width: 200, height: 40 });
      expect(place()).toEqual({ top: 34, left: 460, side: "bottom" });
    });

    it("never past the edges of the window", () => {
      mockGeometry({ left: 1200, top: 300, width: 80, height: 20 }, { width: 300, height: 40 });
      expect(place().left).toBe(1280 - 8 - 300);
      cleanup();
      mockGeometry({ left: 0, top: 300, width: 40, height: 20 }, { width: 300, height: 40 });
      expect(place().left).toBe(8);
    });

    it("the margin from the window and the gap come from the spacing tokens", () => {
      expect(space["space-2"]).toBe(8);
      expect(space["space-1"]).toBe(4);
    });
  });

  describe("CMP-25@PoC FR «Клавіатура і екранний читач»", () => {
    it("role tooltip, linked by aria-describedby; the full text is in the element's own content", () => {
      mockTextBox(120, 360);
      render(<TruncatedText text={FULL_NAME} />);
      const name = nameEl();
      // CSS cuts the text visually; the DOM keeps all of it for screen readers.
      expect(name.textContent).toBe(FULL_NAME);
      const tip = screen.getByRole("tooltip", { hidden: true });
      expect(name.getAttribute("aria-describedby")).toBe(tip.id);
      expect(tip.textContent).toBe(FULL_NAME);
    });

    it("an icon-only button: the full text is its accessible name and its description", () => {
      render(
        <Tooltip text="Додати транзакцію">
          <button type="button" aria-label="Додати транзакцію">
            +
          </button>
        </Tooltip>,
      );
      const button = screen.getByRole("button", { name: "Додати транзакцію" });
      expect(button).toBe(screen.getByRole("button", { description: "Додати транзакцію" }));
      act(() => button.focus());
      expect(isShown()).toBe(true);
      fireEvent.keyDown(button, { key: "Escape" });
      expect(isShown()).toBe(false);
    });

    it("keeps the consumer's own handlers on the wrapped element", () => {
      const onFocus = vi.fn();
      const onMouseEnter = vi.fn();
      render(
        <Tooltip text="Фільтри">
          <button type="button" aria-label="Фільтри" onFocus={onFocus} onMouseEnter={onMouseEnter}>
            ≡
          </button>
        </Tooltip>,
      );
      const button = screen.getByRole("button", { name: "Фільтри" });
      act(() => button.focus());
      fireEvent.mouseEnter(button);
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onMouseEnter).toHaveBeenCalledTimes(1);
    });

    it("text only: no links or buttons inside the tooltip", () => {
      mockTextBox(120, 360);
      render(<TruncatedText text={FULL_NAME} />);
      const tip = screen.getByRole("tooltip", { hidden: true });
      expect(tip.querySelectorAll("a, button, input, select, textarea, [tabindex]").length).toBe(0);
      expect(tip.children.length).toBe(0);
    });
  });

  it("CMP-25@PoC: the measured box is re-read when it changes size", () => {
    let observed: ResizeObserverCallback | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          observed = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<TruncatedText text={FULL_NAME} />);
    const name = nameEl();
    setBox(name, { clientWidth: 400, scrollWidth: 400 });
    act(() => observed!([], {} as ResizeObserver));
    expect(name.hasAttribute("tabindex")).toBe(false);
    setBox(name, { clientWidth: 100, scrollWidth: 400 });
    act(() => observed!([], {} as ResizeObserver));
    expect(name.tabIndex).toBe(0);
    vi.unstubAllGlobals();
  });
});

import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { Popover } from "./Popover.tsx";

/** CMP-61@PoC FR 8, AC8: the popover of a button — `role="dialog"`, no backdrop, Esc and an outside press close it. */
function Case({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <div>
      <span className="ws-popover-host" ref={anchor}>
        <button type="button" onClick={() => setOpen(true)}>
          Внести
        </button>
        <Popover
          open={open}
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          label="Внести у ціль"
          anchor={anchor}
        >
          <input aria-label="Сума" />
          <button type="button">Додати внесок</button>
        </Popover>
      </span>
      <p>Поза поповером</p>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CMP-61@PoC Popover", () => {
  it("CMP-61@PoC AC8: opens from the button as a dialog with no backdrop and focuses its first field", () => {
    const { container } = render(<Case />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Внести" }));
    const dialog = screen.getByRole("dialog", { name: "Внести у ціль" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(container.querySelector(".ws-dialog-backdrop, .ws-backdrop")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Сума" }));
  });

  it("CMP-61@PoC AC8: Esc closes the popover and focus returns to the button", () => {
    render(<Case />);
    const button = screen.getByRole("button", { name: "Внести" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сума" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("CMP-61@PoC AC8: a press outside closes it, a press inside does not", () => {
    render(<Case />);
    fireEvent.click(screen.getByRole("button", { name: "Внести" }));
    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Сума" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("Поза поповером"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("CMP-61@PoC FR 8: Tab goes round the content of the popover and Shift+Tab back, never out of it", () => {
    render(<Case />);
    fireEvent.click(screen.getByRole("button", { name: "Внести" }));
    const first = screen.getByRole("textbox", { name: "Сума" });
    const last = screen.getByRole("button", { name: "Додати внесок" });
    expect(document.activeElement).toBe(first);
    last.focus();
    const tab = createEvent.keyDown(last, { key: "Tab" });
    fireEvent(last, tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = createEvent.keyDown(first, { key: "Tab", shiftKey: true });
    fireEvent(first, back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // In the middle the browser's own Tab moves on: nothing is taken over.
    first.focus();
    const middle = createEvent.keyDown(first, { key: "Tab" });
    fireEvent(first, middle);
    expect(middle.defaultPrevented).toBe(false);
  });

  it("CMP-61@PoC FR 8: the Tab cycle skips items that are aria-disabled or disabled, at the start and at the end", () => {
    const anchor = { current: document.body };
    render(
      <Popover open onClose={() => undefined} label="Внести у ціль" anchor={anchor}>
        <button type="button" aria-disabled="true">
          Недоступно спочатку
        </button>
        <input aria-label="Сума" />
        <button type="button">Додати внесок</button>
        <button type="button" aria-disabled="true">
          Недоступно наприкінці
        </button>
        <button type="button" disabled>
          Вимкнено
        </button>
      </Popover>,
    );
    const first = screen.getByRole("textbox", { name: "Сума" });
    const last = screen.getByRole("button", { name: "Додати внесок" });
    last.focus();
    const tab = createEvent.keyDown(last, { key: "Tab" });
    fireEvent(last, tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = createEvent.keyDown(first, { key: "Tab", shiftKey: true });
    fireEvent(first, back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("CMP-61@PoC FR 8: a scroll of the page closes the popover and focus returns to the button; a scroll inside it does not", () => {
    render(<Case />);
    const button = screen.getByRole("button", { name: "Внести" });
    fireEvent.click(button);
    fireEvent.scroll(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.scroll(document);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  describe("flip above the button", () => {
    /** The popover is 100 px tall and sits 10 px under a button that spans `buttonTop`…`buttonTop + 40`. */
    function place(buttonTop: number, viewport = 700) {
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(viewport);
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const rect = (top: number, height: number) =>
          ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
        return this.classList.contains("ws-popover")
          ? rect(buttonTop + 50, 100)
          : this.classList.contains("ws-popover-host")
            ? rect(buttonTop, 40)
            : rect(0, 0);
      });
      render(<Case />);
      fireEvent.click(screen.getByRole("button", { name: "Внести" }));
      return screen.getByRole("dialog");
    }

    it("CMP-61@PoC FR 8: with no room below the button and room above, the popover opens above it", () => {
      expect(place(600).dataset["placement"]).toBe("above");
    });

    it("CMP-61@PoC FR 8: with room below it stays under the button", () => {
      expect(place(300).dataset["placement"]).toBeUndefined();
    });

    it("CMP-61@PoC FR 8: with room neither below nor above it stays under the button, next to it", () => {
      expect(place(60, 120).dataset["placement"]).toBeUndefined();
    });
  });
});

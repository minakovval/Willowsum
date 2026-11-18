import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

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
});

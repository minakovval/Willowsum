import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PasswordField } from "./fields.tsx";

/** ACC-01@PoC FR 11, AC18–AC22 (GRID-06@PoC FR 4, AC4): «Показати пароль» and the Caps Lock hint. */
function Harness({
  onSubmit,
  autoComplete = "current-password",
}: {
  onSubmit?: () => void;
  autoComplete?: "current-password" | "new-password";
}) {
  const [value, setValue] = useState("Secret password 1");
  const [signal, setSignal] = useState(0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSignal((n) => n + 1);
        onSubmit?.();
      }}
    >
      <PasswordField
        label="Пароль"
        name="password"
        value={value}
        onChange={setValue}
        autoComplete={autoComplete}
        hideSignal={signal}
        required
      />
      <button type="submit">Увійти</button>
    </form>
  );
}

const input = () => screen.getByLabelText(/^Пароль/, { selector: "input" }) as HTMLInputElement;
const toggle = () => screen.getByRole("button", { name: "Показати пароль" });

describe("ACC-01@PoC password field", () => {
  it("AC18: the toggle shows the text and is pressed; pressing again hides it", () => {
    render(<Harness />);
    expect(input().type).toBe("password");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle());
    expect(input().type).toBe("text");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle());
    expect(input().type).toBe("password");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("AC19: after the form is sent the field is hidden again", () => {
    const sent = vi.fn();
    render(<Harness onSubmit={sent} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Увійти" }));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(input().type).toBe("password");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("AC19: leaving the page hides it, and the shown state is stored nowhere", () => {
    localStorage.clear();
    sessionStorage.clear();
    const view = render(<Harness />);
    fireEvent.click(toggle());
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(input().type).toBe("password");
    fireEvent.click(toggle());
    view.unmount();
    render(<Harness />);
    expect(input().type).toBe("password");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("AC20: a type=button with a fixed name and aria-pressed; it never sends the form; the focus stays on it", () => {
    const sent = vi.fn();
    render(<Harness onSubmit={sent} />);
    const button = toggle();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-controls")).toBe(input().id);
    button.focus();
    // Keyboard activation (Enter / Space) fires click on a button.
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(sent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    // Same accessible name in both states.
    expect(screen.getByRole("button", { name: "Показати пароль", pressed: true })).toBe(button);
    fireEvent.keyDown(button, { key: " " });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Показати пароль", pressed: false })).toBe(button);
    expect(sent).not.toHaveBeenCalled();
  });

  it("AC20: a mouse press does not take the caret out of the field", () => {
    render(<Harness />);
    input().focus();
    // The default of mousedown (moving the focus to the button) is prevented.
    expect(fireEvent.mouseDown(toggle())).toBe(false);
    fireEvent.click(toggle());
    expect(document.activeElement).toBe(input());
  });

  it("AC21: with Caps Lock on, a polite hint under the field; gone when it is off or the field loses focus", () => {
    render(<Harness />);
    const region = document.getElementById(`${input().id}-caps`)!;
    // The live region exists before it is filled, so its text is announced, politely.
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe("");
    input().focus();
    fireEvent.keyDown(input(), { key: "A", modifierCapsLock: true });
    expect(region.textContent).toBe("Увімкнено Caps Lock");
    expect(input().getAttribute("aria-describedby")).toContain(region.id);
    fireEvent.keyUp(input(), { key: "CapsLock", modifierCapsLock: false });
    expect(region.textContent).toBe("");
    fireEvent.keyDown(input(), { key: "A", modifierCapsLock: true });
    fireEvent.blur(input());
    expect(region.textContent).toBe("");
  });

  it.each(["current-password", "new-password"] as const)(
    "AC22 (%s): autofill stays; while shown, no auto-capitalisation, autocorrect or spellcheck",
    (autoComplete) => {
      render(<Harness autoComplete={autoComplete} />);
      expect(input().getAttribute("autocomplete")).toBe(autoComplete);
      fireEvent.click(toggle());
      expect(input().type).toBe("text");
      expect(input().getAttribute("autocomplete")).toBe(autoComplete);
      expect(input().getAttribute("name")).toBe("password");
      expect(input().getAttribute("autocapitalize")).toBe("off");
      expect(input().getAttribute("autocorrect")).toBe("off");
      expect(input().getAttribute("spellcheck")).toBe("false");
    },
  );
});

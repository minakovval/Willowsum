import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { useState } from "react";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog.tsx";

/** CMP-21@PoC the dangerous-action confirmation (wave 2 row 90), with and without a typed word. Synthetic texts. */
afterEach(() => {
  cleanup();
});

function Host(props: Partial<ConfirmDialogProps>) {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Закрити акаунт
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Закрити акаунт?"
        text="Простір і всі дані буде видалено через 30 днів."
        cancelLabel="Скасувати"
        confirmLabel="Закрити акаунт"
        onConfirm={() => {}}
        {...props}
      />
    </I18nProvider>
  );
}

const WORD = {
  word: "ВИДАЛИТИ",
  label: "Введіть ВИДАЛИТИ, щоб підтвердити",
  reason: "Щоб продовжити, введіть ВИДАЛИТИ",
};

const openIt = () => act(() => screen.getByRole("button", { name: "Закрити акаунт" }).click());
const dialog = () => screen.getByRole("alertdialog");
const confirm = () => within(dialog()).getByRole("button", { name: "Закрити акаунт" });

describe("CMP-21@PoC ConfirmDialog", () => {
  it("CMP-21@PoC AC4: until «ВИДАЛИТИ» is typed the main action is inactive and says why; then it confirms", () => {
    const onConfirm = vi.fn();
    render(<Host confirmWord={WORD} onConfirm={onConfirm} />);
    openIt();
    const field = within(dialog()).getByLabelText(WORD.label) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(confirm().getAttribute("aria-disabled")).toBe("true");
    const note = document.querySelector<HTMLElement>(".ws-dialog-note")!;
    expect(note.textContent).toBe(WORD.reason);
    expect(confirm().getAttribute("aria-describedby")).toBe(note.id);
    act(() => confirm().click());
    expect(onConfirm).not.toHaveBeenCalled();
    for (const wrong of ["видалити", "ВИДАЛИ", "ВИДАЛИТИ!"]) {
      fireEvent.change(field, { target: { value: wrong } });
      expect(confirm().getAttribute("aria-disabled")).toBe("true");
    }
    fireEvent.change(field, { target: { value: " ВИДАЛИТИ " } });
    expect(confirm().getAttribute("aria-disabled")).toBeNull();
    expect(document.querySelector(".ws-dialog-note")).toBeNull();
    act(() => confirm().click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("CMP-21@PoC AC4: opening again starts with the field empty and the action inactive", () => {
    render(<Host confirmWord={WORD} />);
    openIt();
    fireEvent.change(within(dialog()).getByLabelText(WORD.label), { target: { value: "ВИДАЛИТИ" } });
    act(() => {
      dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    openIt();
    expect((within(dialog()).getByLabelText(WORD.label) as HTMLInputElement).value).toBe("");
    expect(confirm().getAttribute("aria-disabled")).toBe("true");
  });

  it("CMP-21@PoC AC1: without a word focus is on «Скасувати», never on the danger action; the dialog is an alertdialog, centred", () => {
    render(<Host />);
    openIt();
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Скасувати" }));
    expect(confirm().dataset.variant).toBe("danger");
    expect(document.querySelector("dialog")!.getAttribute("data-align")).toBe("center");
    expect(dialog().getAttribute("aria-modal")).toBe("true");
  });
});

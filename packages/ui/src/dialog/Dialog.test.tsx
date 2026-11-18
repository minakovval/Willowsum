import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { Dialog, type DialogAction, type DialogProps } from "./Dialog.tsx";

/**
 * CMP-21@PoC Dialog — the base (wave 2 row 89): opening, focus, closing, sizes. jsdom has no `showModal`, no layout
 * and no Tab movement: the dialog falls back to the `open` attribute, sizes are set per test, and `tab()` moves focus
 * the way a browser does unless the dialog takes the key. Synthetic texts only.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** A browser's Tab: the dialog may take the key; otherwise focus moves to the next control in document order. */
function tab(shift = false) {
  const active = (document.activeElement ?? document.body) as HTMLElement;
  const taken = !fireEvent.keyDown(active, { key: "Tab", shiftKey: shift });
  if (taken) return;
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const i = all.indexOf(active);
  const next = shift ? all[(i - 1 + all.length) % all.length] : all[(i + 1) % all.length];
  next?.focus();
}

const dialogEl = () => document.querySelector<HTMLDialogElement>("dialog.ws-dialog");

/** A page with an opener button, a control before and after it, and the dialog it opens. */
function Host({
  opener = "Видалити рахунок",
  dialog,
}: {
  opener?: string | undefined;
  dialog: (close: () => void) => Omit<DialogProps, "open" | "onClose">;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <a href="#before">Перед</a>
      <button type="button" onClick={() => setOpen(true)}>
        {opener}
      </button>
      <a href="#after">Після</a>
      <Dialog open={open} onClose={close} {...dialog(close)} />
    </>
  );
}

const deleteAccount = (close: () => void, extra: Partial<DialogProps> = {}) => ({
  title: "Видалити рахунок «Monobank»?",
  text: "Рахунок і його транзакції зникнуть з усіх звітів.",
  icon: "trash" as const,
  tone: "danger" as const,
  closeLabel: "Закрити",
  actions: [
    { label: "Скасувати", onClick: close },
    { label: "Видалити рахунок", variant: "danger" as const, onClick: vi.fn() },
  ],
  ...extra,
});

const unsaved = (close: () => void): Omit<DialogProps, "open" | "onClose"> => ({
  title: "Зберегти зміни?",
  text: "Збережіть їх, вийдіть без збереження або редагуйте далі.",
  icon: "edit",
  closeLabel: "Закрити",
  actions: [
    { label: "Редагувати далі", onClick: close },
    { label: "Не зберігати", variant: "danger", onClick: close },
    { label: "Зберегти", variant: "primary", onClick: close },
  ],
});

function openWith(dialog: (close: () => void) => Omit<DialogProps, "open" | "onClose">, opener?: string) {
  render(<Host dialog={dialog} opener={opener} />);
  const button = screen.getByRole("button", { name: opener ?? "Видалити рахунок" });
  button.focus();
  act(() => button.click());
  return button;
}

describe("CMP-21@PoC Dialog — opening and focus", () => {
  it("CMP-21@PoC AC1: «Видалити рахунок» opens the dialog with focus on «Скасувати», not on «Видалити рахунок»", () => {
    openWith((close) => deleteAccount(close));
    const dialog = screen.getByRole("alertdialog", { name: "Видалити рахунок «Monobank»?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Скасувати" }));
    expect(document.activeElement).not.toBe(within(dialog).getByRole("button", { name: "Видалити рахунок" }));
  });

  it("CMP-21@PoC AC1: a danger action never gets focus by default — «Редагувати далі» in «Зберегти зміни?»", () => {
    openWith(unsaved, "Вийти");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Редагувати далі" }));
  });

  it("CMP-21@PoC AC1: with a field in the content the first field gets focus; `initialFocus` wins", () => {
    openWith(() => ({
      title: "Підтвердьте, що це ви",
      align: "center",
      actions: [{ label: "Підтвердити", variant: "primary", onClick: vi.fn() }],
      children: (
        <label>
          Поточний пароль
          <input type="password" autoComplete="current-password" />
        </label>
      ),
    }));
    expect(document.activeElement).toBe(screen.getByLabelText("Поточний пароль"));
    cleanup();

    function WithRef() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Dialog
          open
          onClose={vi.fn()}
          title="Ще одне"
          initialFocus={ref}
          actions={[{ label: "Гаразд", variant: "primary", onClick: vi.fn() }]}
        >
          <button ref={ref} type="button">
            Деталі
          </button>
        </Dialog>
      );
    }
    render(<WithRef />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Деталі" }));
  });

  it("CMP-21@PoC AC2: Tab and Shift+Tab many times keep focus inside the dialog", () => {
    openWith((close) => deleteAccount(close));
    const dialog = dialogEl()!;
    for (let i = 0; i < 9; i += 1) {
      tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 9; i += 1) {
      tab(true);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("CMP-21@PoC AC2: a body taller than the dialog is one Tab stop between «✕» and the actions; Tab goes on to them", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ws-dialog-body") ? 900 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ws-dialog-body") ? 300 : 0;
    });
    openWith((close) => deleteAccount(close));
    const dialog = dialogEl()!;
    const body = dialog.querySelector<HTMLElement>(".ws-dialog-body")!;
    expect(body.tabIndex).toBe(0);
    expect(body.getAttribute("role")).toBe("region");
    act(() => screen.getByRole("button", { name: "Закрити" }).focus());
    tab();
    expect(document.activeElement).toBe(body);
    tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Скасувати" }));
    tab(true);
    expect(document.activeElement).toBe(body);
  });

  it("CMP-21@PoC AC2: focus moved outside while open is brought back in", () => {
    openWith((close) => deleteAccount(close));
    act(() => screen.getByRole("link", { name: "Після" }).focus());
    expect(dialogEl()!.contains(document.activeElement)).toBe(true);
  });

  it("CMP-21@PoC AC7: modal, named by the title and described by the explanation; `role=dialog` unless dangerous", () => {
    openWith((close) => deleteAccount(close));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe(
      "Видалити рахунок «Monobank»?",
    );
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Рахунок і його транзакції зникнуть з усіх звітів.",
    );
    cleanup();
    render(
      <Dialog open onClose={vi.fn()} title="Готово" actions={[{ label: "Гаразд", onClick: vi.fn() }]} />,
    );
    expect(screen.getByRole("dialog", { name: "Готово" })!.getAttribute("role")).not.toBe("alertdialog");
  });
});

describe("CMP-21@PoC Dialog — closing", () => {
  it("CMP-21@PoC AC3: Esc closes the dialog and focus returns to the button that opened it", () => {
    const opener = openWith((close) => deleteAccount(close));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("CMP-21@PoC AC3: Esc inside the open «✕» tooltip closes the tooltip only; the next Esc closes the dialog", () => {
    openWith((close) => deleteAccount(close));
    const x = screen.getByRole("button", { name: "Закрити" });
    act(() => x.focus());
    const tipId = x.getAttribute("aria-describedby")!;
    expect(document.getElementById(tipId)!.hidden).toBe(false);
    fireEvent.keyDown(x, { key: "Escape" });
    expect(dialogEl()).not.toBeNull();
    expect(document.getElementById(tipId)!.hidden).toBe(true);
    fireEvent.keyDown(x, { key: "Escape" });
    expect(dialogEl()).toBeNull();
  });

  it("CMP-21@PoC AC3: «✕» and a press on the backdrop close it too, with focus back on the opener", () => {
    const opener = openWith((close) => deleteAccount(close));
    act(() => screen.getByRole("button", { name: "Закрити" }).click());
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);

    act(() => opener.click());
    const dialog = dialogEl()!;
    // A press inside the box does not close; one that starts and ends on the backdrop does.
    fireEvent.mouseDown(screen.getByRole("heading"));
    fireEvent.click(dialog);
    expect(dialogEl()).not.toBeNull();
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("CMP-21@PoC AC3: a dialog that requires a decision has no «✕» and ignores the backdrop; Esc still closes", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        open
        onClose={onClose}
        title="Сесію завершено"
        actions={[{ label: "Увійти знову", variant: "primary", onClick: vi.fn() }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Закрити" })).toBeNull();
    fireEvent.mouseDown(dialogEl()!);
    fireEvent.click(dialogEl()!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialogEl()!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("CMP-21@PoC AC3: the native `cancel` (Esc in a browser) never closes the dialog behind the consumer's back", () => {
    openWith((close) => deleteAccount(close));
    const cancel = new Event("cancel", { cancelable: true });
    dialogEl()!.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });
});

describe("CMP-21@PoC Dialog — no stacking", () => {
  it("CMP-21@PoC AC5: a second dialog does not open over the first; it appears once the first closes", () => {
    function Two() {
      const [first, setFirst] = useState(true);
      return (
        <>
          <Dialog
            open={first}
            onClose={() => setFirst(false)}
            title="Перший"
            actions={[{ label: "Закрити перший", onClick: () => setFirst(false) }]}
          />
          <Dialog open onClose={vi.fn()} title="Другий" actions={[{ label: "Гаразд", onClick: vi.fn() }]} />
        </>
      );
    }
    render(<Two />);
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Перший" })).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Закрити перший" }).click());
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Другий" })).toBeTruthy();
  });
});

describe("CMP-21@PoC Dialog — states", () => {
  function Failing({ children }: { children?: ReactNode }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<ReactNode>(null);
    const onDelete = vi.fn(() => setBusy(true));
    return (
      <>
        <Dialog
          open
          onClose={vi.fn()}
          {...deleteAccount(vi.fn(), {
            busy,
            error,
            actions: [
              { label: "Скасувати", onClick: vi.fn() },
              { label: "Видалити рахунок", variant: "danger", onClick: onDelete },
              { label: "Видалити", variant: "primary", busyLabel: "Видаляємо…", onClick: onDelete },
            ],
          })}
        >
          {children}
        </Dialog>
        <button
          type="button"
          onClick={() => {
            setBusy(false);
            setError(
              <>
                <strong>Помилка</strong> Не вдалося видалити рахунок. Код: ACC-500
              </>,
            );
          }}
        >
          server-fails
        </button>
      </>
    );
  }

  it("CMP-21@PoC AC6: while the action runs the primary shows its busy label and the rest are inactive; Esc waits", () => {
    render(<Failing />);
    act(() => screen.getByRole("button", { name: "Видалити" }).click());
    const primary = screen.getByRole("button", { name: "Видаляємо…" });
    expect(primary!.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Скасувати" })!.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("alertdialog")!.getAttribute("aria-busy")).toBe("true");
    fireEvent.keyDown(dialogEl()!, { key: "Escape" });
    expect(dialogEl()).not.toBeNull();
  });

  it("CMP-21@PoC AC6: a server error keeps the dialog open with a message that starts with «Помилка»", () => {
    render(<Failing />);
    act(() => screen.getByRole("button", { name: "Видалити" }).click());
    act(() => screen.getByRole("button", { name: "server-fails", hidden: true }).click());
    const alert = within(screen.getByRole("alertdialog")).getByRole("alert");
    expect(alert.textContent).toMatch(/^Помилка /);
    expect(screen.getByRole("button", { name: "Видалити" })!.getAttribute("aria-disabled")).toBeNull();
  });

  it("CMP-21@PoC: an inactive action keeps its focus place, does nothing and is described by the reason line", () => {
    const onSave = vi.fn();
    render(
      <Dialog
        open
        onClose={vi.fn()}
        title="Нова ціль"
        note="Щоб продовжити, заповніть: Назва"
        actions={[
          { label: "Скасувати", onClick: vi.fn() },
          { label: "Додати ціль", variant: "primary", disabled: true, onClick: onSave },
        ]}
      />,
    );
    const save = screen.getByRole("button", { name: "Додати ціль" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(save!.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(save.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Щоб продовжити, заповніть: Назва",
    );
    act(() => save.click());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("CMP-21@PoC: «✕» is marked aria-disabled while busy and keeps its place in the focus order", () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} busy {...deleteAccount(vi.fn())} />);
    const x = screen.getByRole("button", { name: "Закрити" });
    expect(x.getAttribute("aria-disabled")).toBe("true");
    act(() => x.click());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("CMP-21@PoC: the «✕» tooltip is rendered inside the modal dialog (the rest of the page is inert)", () => {
    openWith((close) => deleteAccount(close));
    const close = screen.getByRole("button", { name: "Закрити" });
    const tip = document.getElementById(close.getAttribute("aria-describedby")!);
    expect(tip).not.toBeNull();
    expect(dialogEl()!.contains(tip)).toBe(true);
  });
});

describe("CMP-21@PoC Dialog — alignment and sizes", () => {
  it("CMP-21@PoC AC9: a confirmation with an icon, a title, one sentence and two buttons is centred", () => {
    openWith((close) => deleteAccount(close));
    expect(dialogEl()!.getAttribute("data-align")).toBe("center");
    expect(dialogEl()!.querySelector(".ws-dialog-icon")!.getAttribute("data-tone")).toBe("danger");
  });

  it("CMP-21@PoC AC10: a dialog with options or fields aligns everything to one left edge", () => {
    render(
      <Dialog
        open
        onClose={vi.fn()}
        title="Куди перенести транзакції?"
        actions={[{ label: "Гаразд", onClick: vi.fn() }]}
      >
        <fieldset>
          <legend>Рахунок</legend>
          <label>
            <input type="radio" name="a" /> Готівка
          </label>
        </fieldset>
      </Dialog>,
    );
    expect(dialogEl()!.getAttribute("data-align")).toBe("start");
  });

  it("CMP-21@PoC AC11: equal buttons whose labels do not fit one 560 px row stack full width, primary on top", () => {
    // The widest label is 200 px + 2 × 14 px padding + 2 × 1 px border = 230 px; 3 × 230 + 2 × 12 > 496.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(496);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains("ws-dialog-action-label") ? 200 : 0 } as DOMRect;
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el) =>
        ({
          columnGap: (el as HTMLElement).classList.contains("ws-dialog-actions") ? "12px" : "normal",
          paddingLeft: "14px",
          paddingRight: "14px",
          borderLeftWidth: "1px",
          borderRightWidth: "1px",
        }) as CSSStyleDeclaration,
    );
    const actions: DialogAction[] = [
      { label: "Повернутися до редагування", onClick: vi.fn() },
      { label: "Вийти без збереження змін", variant: "danger", onClick: vi.fn() },
      { label: "Зберегти всі зміни й вийти", variant: "primary", onClick: vi.fn() },
    ];
    render(<Dialog open onClose={vi.fn()} title="Зберегти зміни?" actions={actions} />);
    const row = dialogEl()!.querySelector(".ws-dialog-actions")!;
    expect(row!.getAttribute("data-layout")).toBe("column");
    expect([...row.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Зберегти всі зміни й вийти",
      "Повернутися до редагування",
      "Вийти без збереження змін",
    ]);
  });

  it("CMP-21@PoC AC12: «Зберегти зміни?» is the 560 px dialog with three equal buttons in one row", () => {
    // 3 × (100 + 28 + 2) + 2 × 12 = 414 ≤ 496: one row.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(496);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains("ws-dialog-action-label") ? 100 : 0 } as DOMRect;
    });
    openWith(unsaved, "Вийти");
    const dialog = screen.getByRole("dialog", { name: "Зберегти зміни?" });
    expect(dialog!.getAttribute("data-size")).toBe("default");
    const row = dialog.querySelector(".ws-dialog-actions")!;
    expect(row!.getAttribute("data-layout")).toBe("row");
    expect(
      [...row.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("data-variant")]),
    ).toEqual([
      ["Редагувати далі", "secondary"],
      ["Не зберігати", "danger"],
      ["Зберегти", "primary"],
    ]);
    expect(within(dialog).queryByRole("button", { name: "Скасувати" })).toBeNull();
  });

  it("CMP-21@PoC AC8: leaving a form with changes asks «Зберегти зміни?» with its text and exactly three buttons, no «Скасувати»; each button runs its own action", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(496);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains("ws-dialog-action-label") ? 100 : 0 } as DOMRect;
    });
    const onStay = vi.fn();
    const onDiscard = vi.fn();
    const onSave = vi.fn();
    render(
      <Dialog
        open
        onClose={vi.fn()}
        title="Зберегти зміни?"
        text="Збережіть їх, вийдіть без збереження або редагуйте далі."
        actions={[
          { label: "Редагувати далі", onClick: onStay },
          { label: "Не зберігати", variant: "danger", onClick: onDiscard },
          { label: "Зберегти", variant: "primary", onClick: onSave },
        ]}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Зберегти зміни?" });
    expect(within(dialog).getByText("Збережіть їх, вийдіть без збереження або редагуйте далі.")).toBeTruthy();
    const row = dialog.querySelector(".ws-dialog-actions")!;
    expect(row.getAttribute("data-layout")).toBe("row");
    const buttons = [...row.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Редагувати далі", "Не зберігати", "Зберегти"]);
    expect(buttons.map((b) => b.getAttribute("data-variant"))).toEqual(["secondary", "danger", "primary"]);
    expect(buttons[2]!.className).toContain("ws-button-primary");
    expect(buttons[1]!.className).not.toContain("ws-button-primary");
    expect(within(dialog).queryByRole("button", { name: "Скасувати" })).toBeNull();
    for (const b of buttons) fireEvent.click(b);
    expect([onStay, onDiscard, onSave].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("CMP-21@PoC AC25: 640 px only as `split`, 900 px only as `wide`; every other dialog is the 560 px default", () => {
    const one = (size?: DialogProps["size"]) => {
      render(
        <Dialog
          open
          onClose={vi.fn()}
          title="Т"
          size={size}
          actions={[{ label: "Гаразд", onClick: vi.fn() }]}
        />,
      );
      const value = dialogEl()!.getAttribute("data-size");
      cleanup();
      return value;
    };
    expect([one(), one("split"), one("wide")]).toEqual(["default", "split", "wide"]);
  });
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { useState } from "react";
import { Button } from "../button/Button.tsx";
import { AmountField } from "../field/Field.tsx";
import { Toast } from "../toast/Toast.tsx";
import { AppShell } from "../shell/AppShell.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Dialog } from "./Dialog.tsx";

/**
 * DS-14@PoC items 6, 8, 9, 10 (live regions), 11 and criteria 2, 3, 4, 6 and DS-09@PoC edge case 2, on the real
 * components. jsdom has no `showModal` and no Tab movement: `tab()` moves focus the way a browser does unless the
 * component takes the key. The stylesheet items are in `styles/ds14-items.test.ts`. Synthetic texts only.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
function tab(shift = false) {
  const active = (document.activeElement ?? document.body) as HTMLElement;
  if (!fireEvent.keyDown(active, { key: "Tab", shiftKey: shift })) return;
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const i = all.indexOf(active);
  all[shift ? (i - 1 + all.length) % all.length : (i + 1) % all.length]?.focus();
}
const dialogEl = () => document.querySelector<HTMLDialogElement>("dialog.ws-dialog");

/** A page: a link, the opener, a link — and a dialog of the given kind. */
function Page({ kind = "dialog" }: { kind?: "dialog" | "confirm" }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <a href="#before">Перед</a>
      <button type="button" onClick={() => setOpen(true)}>
        Додати витрату
      </button>
      <a href="#after">Після</a>
      {kind === "dialog" ? (
        <Dialog
          open={open}
          onClose={close}
          title="Нова витрата"
          closeLabel="Закрити"
          actions={[
            { label: "Скасувати", onClick: close },
            { label: "Додати", variant: "primary", onClick: close },
          ]}
        >
          <label>
            Сума
            <input type="text" />
          </label>
        </Dialog>
      ) : (
        <ConfirmDialog
          open={open}
          onClose={close}
          title="Видалити витрату?"
          text="Її не буде в звітах."
          closeLabel="Закрити"
          cancelLabel="Скасувати"
          confirmLabel="Видалити"
          onConfirm={close}
        />
      )}
    </>
  );
}

function openIt(ui = <Page />) {
  render(ui);
  const opener = screen.getByRole("button", { name: "Додати витрату" });
  opener.focus();
  act(() => opener.click());
  return opener;
}

describe("DS-14@PoC dialogs: focus goes in, stays, and returns", () => {
  it("DS-14@PoC FR 9, AC3: focus moves inside the dialog and Tab and Shift+Tab never reach the page behind it", () => {
    openIt();
    const dialog = dialogEl()!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    const seen = new Set<Element>();
    for (let i = 0; i < 14; i += 1) {
      tab();
      expect(dialog.contains(document.activeElement), `Tab ${i}`).toBe(true);
      seen.add(document.activeElement!);
    }
    for (let i = 0; i < 14; i += 1) {
      tab(true);
      expect(dialog.contains(document.activeElement), `Shift+Tab ${i}`).toBe(true);
    }
    // «✕», the field, «Скасувати» and «Додати» are all on the loop.
    expect(seen.size).toBeGreaterThanOrEqual(4);
    // Focus pushed to the page (a script, a click) is brought back in.
    act(() => screen.getByRole("link", { name: "Після" }).focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
    act(() => screen.getByRole("link", { name: "Перед" }).focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it.each(["dialog", "confirm"] as const)(
    "DS-14@PoC FR 9, AC2: Esc closes the %s and focus returns to the button that opened it",
    (kind) => {
      const opener = openIt(<Page kind={kind} />);
      expect(dialogEl()).not.toBeNull();
      expect(document.activeElement).not.toBe(opener);
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(dialogEl()).toBeNull();
      expect(document.activeElement).toBe(opener);
    },
  );

  it("DS-09@PoC EC2: two dialogs in a row — the new one is the only one open, above the page, and after it closes focus is back on the button that opened the first", () => {
    function Chain() {
      const [step, setStep] = useState<0 | 1 | 2>(0);
      return (
        <>
          <button type="button" onClick={() => setStep(1)}>
            Видалити рахунок
          </button>
          <Dialog
            open={step === 1}
            onClose={() => setStep(0)}
            title="Перший"
            actions={[{ label: "Далі", variant: "primary", onClick: () => setStep(2) }]}
          />
          <Dialog
            open={step === 2}
            onClose={() => setStep(0)}
            title="Другий"
            actions={[{ label: "Гаразд", variant: "primary", onClick: () => setStep(0) }]}
          />
        </>
      );
    }
    render(<Chain />);
    const opener = screen.getByRole("button", { name: "Видалити рахунок" });
    opener.focus();
    act(() => opener.click());
    expect(screen.getByRole("dialog", { name: "Перший" })).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Далі" }).click());
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    const second = screen.getByRole("dialog", { name: "Другий" });
    expect(second.contains(document.activeElement)).toBe(true);
    act(() => screen.getByRole("button", { name: "Гаразд" }).click());
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("DS-14@PoC FR 11: a dialog body taller than the dialog is reachable and scrollable from the keyboard — one Tab stop, a named region", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ws-dialog-body") ? 900 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ws-dialog-body") ? 300 : 0;
    });
    openIt();
    const body = dialogEl()!.querySelector<HTMLElement>(".ws-dialog-body")!;
    expect(body.tabIndex).toBe(0);
    expect(body.getAttribute("role")).toBe("region");
    expect(body.getAttribute("aria-label") ?? body.getAttribute("aria-labelledby")).toBeTruthy();
    // A body that fits is not a Tab stop of its own.
    cleanup();
    vi.restoreAllMocks();
    openIt();
    expect(dialogEl()!.querySelector<HTMLElement>(".ws-dialog-body")!.tabIndex).toBe(-1);
  });
});

describe("DS-14@PoC button in the loading state", () => {
  it("DS-14@PoC FR 6, AC6: pressing a loading button twice sends the action once, and the button keeps its markup and size classes", () => {
    const send = vi.fn();
    function Save() {
      const [busy, setBusy] = useState(false);
      return (
        <Button
          label="Зберегти"
          variant="primary"
          loading={busy}
          onClick={() => {
            send();
            setBusy(true);
          }}
        />
      );
    }
    render(
      <I18nProvider>
        <Save />
      </I18nProvider>,
    );
    const button = screen.getByRole("button", { name: "Зберегти" });
    const before = button.className;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.className).toBe(before);
    expect(button.querySelector(".ws-button-label")!.textContent).toBe("Зберегти");
    expect(button.querySelector(".ws-spinner")).not.toBeNull();
  });
});

describe("DS-14@PoC live regions", () => {
  it("DS-14@PoC FR 10: an error is announced at once (an assertive region that exists before it is filled, or an alert); a result is announced politely, once, and never takes the focus", () => {
    function Amount() {
      const [value, setValue] = useState<string | null>("");
      return (
        <I18nProvider>
          <AmountField label="Сума" currency="EUR" value={value ?? ""} onChange={setValue} />
        </I18nProvider>
      );
    }
    const { container } = render(<Amount />);
    const live = container.querySelector(".ws-field-live")!;
    expect(live.getAttribute("aria-live")).toBe("assertive");
    expect(live.textContent).toBe("");
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Сума" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12,345" } });
    fireEvent.blur(input);
    expect(container.querySelector(".ws-field-live")).toBe(live); // the same node: the change is announced
    expect(live.textContent).toMatch(/^Помилка/);
    cleanup();

    // A dialog's server error is an alert (assertive); a toast and a busy button are `status` (polite, atomic text once).
    render(
      <Dialog
        open
        onClose={vi.fn()}
        title="Видалити витрату?"
        error={<strong>Помилка Не вдалося видалити</strong>}
        actions={[{ label: "Скасувати", onClick: vi.fn() }]}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/^Помилка/);
    cleanup();

    const before = document.activeElement;
    render(<Toast text="Витрату додано" closeLabel="Закрити" onDismiss={() => undefined} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).not.toBe("assertive");
    expect(status.textContent).toContain("Витрату додано");
    expect(document.activeElement).toBe(before);
    cleanup();

    const { rerender } = render(
      <I18nProvider>
        <Button label="Зберегти" loading={false} />
      </I18nProvider>,
    );
    const busy = screen.getByRole("status");
    rerender(
      <I18nProvider>
        <Button label="Зберегти" loading />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider>
        <Button label="Зберегти" loading />
      </I18nProvider>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(busy.textContent).toBe("Виконується");
  });
});

describe("DS-14@PoC skip links", () => {
  const renderShell = () =>
    render(
      <I18nProvider>
        <AppShell
          sections={[
            {
              id: "planning",
              label: "Планування",
              icon: "planning",
              href: "#/planning/budget",
              pages: [{ id: "budget", label: "Бюджет", icon: "budget", href: "#/planning/budget" }],
            },
          ]}
          currentSectionId="planning"
          currentPageId="budget"
          brand={{ href: "#/planning/budget", label: "Willowsum, Бюджет" }}
          add={{ label: "Додати", items: [] }}
          profile={{ name: "Власник", space: "Мій простір", menuLabel: "Меню профілю", items: [] }}
        >
          <h1>Сторінка</h1>
          <button type="button">Дія сторінки</button>
        </AppShell>
      </I18nProvider>,
    );

  it("DS-14@PoC FR 8, AC4: the first Tab stop is «Перейти до вмісту», then «Перейти до навігації»; activating the first puts focus on the main area, the second on the navigation", () => {
    renderShell();
    const stops = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)];
    expect(stops.slice(0, 2).map((s) => s.textContent)).toEqual([
      "Перейти до вмісту",
      "Перейти до навігації",
    ]);
    expect(stops.slice(0, 2).every((s) => s.classList.contains("ws-skip"))).toBe(true);
    stops[0]!.focus();
    expect(document.activeElement).toBe(stops[0]);
    fireEvent.click(stops[0]!);
    const main = screen.getByRole("main");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(main);
    fireEvent.click(stops[1]!);
    expect(
      screen.getByRole("navigation", { name: "Основна навігація" }).contains(document.activeElement),
    ).toBe(true);
  });
});

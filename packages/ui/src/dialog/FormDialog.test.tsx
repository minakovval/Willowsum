import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { useState } from "react";
import { Field } from "../field/Field.tsx";
import { FormDialog, FormMore, type FormDialogField } from "./FormDialog.tsx";

/**
 * CMP-21@PoC «Форма створення або редагування сутності» (wave 2 row 90): the form dialog on `Dialog`, its steps
 * with the `dialog` step indicator, the reason line and «Додатково». jsdom has no layout: the fixed height of
 * the steps is checked on the stylesheet (`FormDialog.css.test.ts`) and in Chromium (`apps/web/e2e`). Synthetic
 * texts only.
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
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]"));
  const i = all.indexOf(active);
  const next = shift ? all[(i - 1 + all.length) % all.length] : all[(i + 1) % all.length];
  next?.focus();
}

interface Values {
  name: string;
  target: string;
  monthly: string;
  number: string;
  note: string;
}

const EMPTY: Values = { name: "", target: "", monthly: "", number: "", note: "" };
const STEPS = [{ label: "Основне" }, { label: "Внески" }, { label: "Додатково" }];

/** «Нова ціль» in three steps: Назва* and Цільова сума* on step 1, the rest optional; «Номер» may be taken. */
function GoalForm({
  initial = EMPTY,
  editing = false,
  onSubmit = () => {},
  onClose = () => {},
  taken = "",
}: {
  initial?: Values;
  editing?: boolean;
  onSubmit?: (v: Values) => void;
  onClose?: () => void;
  taken?: string;
}) {
  const [v, setV] = useState(initial);
  const set = (k: keyof Values) => (value: string) => setV((s) => ({ ...s, [k]: value }));
  const fields: FormDialogField[] = [
    { id: "name", label: "Назва", required: true, empty: v.name.trim() === "" },
    { id: "target", label: "Цільова сума", required: true, empty: v.target.trim() === "" },
    { id: "monthly", label: "Щомісячний внесок", step: 1, empty: v.monthly === "" },
    {
      id: "number",
      label: "Номер",
      step: 2,
      empty: v.number === "",
      error: taken && v.number === taken ? "Такий номер уже є." : null,
    },
    { id: "note", label: "Нотатка", step: 2, empty: v.note === "" },
  ];
  return (
    <I18nProvider>
      <button type="button">Нова ціль</button>
      <FormDialog
        open
        onClose={onClose}
        title={editing ? "Редагувати ціль" : "Нова ціль"}
        closeLabel="Закрити"
        steps={STEPS}
        fields={fields}
        editing={editing}
        submitLabel={editing ? "Зберегти" : "Додати ціль"}
        onSubmit={() => onSubmit(v)}
      >
        {(form) =>
          form.step === 0 ? (
            <>
              <Field
                label="Назва"
                required
                value={v.name}
                onChange={set("name")}
                onBlur={form.leave("name")}
                error={form.errorOf("name")}
              />
              <Field
                label="Цільова сума"
                required
                value={v.target}
                onChange={set("target")}
                onBlur={form.leave("target")}
                error={form.errorOf("target")}
              />
            </>
          ) : form.step === 1 ? (
            <Field
              label="Щомісячний внесок"
              value={v.monthly}
              onChange={set("monthly")}
              onBlur={form.leave("monthly")}
            />
          ) : (
            <>
              <Field
                label="Номер"
                value={v.number}
                onChange={set("number")}
                onBlur={form.leave("number")}
                error={form.errorOf("number")}
              />
              <Field label="Нотатка" value={v.note} onChange={set("note")} onBlur={form.leave("note")} />
            </>
          )
        }
      </FormDialog>
    </I18nProvider>
  );
}

const dialog = () => screen.getByRole("dialog");
const button = (name: string) => within(dialog()).getByRole("button", { name });
const barLabels = () =>
  [...document.querySelectorAll<HTMLElement>(".ws-dialog-action")].map((b) => b.textContent);
const steps = () => within(dialog()).getByRole("list", { name: "Кроки форми" });
const stepItems = () => [...steps().querySelectorAll<HTMLElement>(".ws-stepper-step")];
const shownStep = () => document.querySelector<HTMLElement>(".ws-form-step:not([inert])")!;
const input = (label: string) =>
  within(shownStep()).getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const leave = (label: string) => fireEvent.blur(input(label));
const reasonLine = () => document.querySelector<HTMLElement>(".ws-dialog-note:not([data-empty])");
const fillStep1 = () => {
  type("Назва", "Відпустка");
  type("Цільова сума", "3000");
};

describe("CMP-21@PoC FormDialog", () => {
  it("CMP-21@PoC AC13: three steps «1 Основне · 2 … · 3 …», required fields on step 1; «Далі» on step 1, «Назад» from step 2, the main action on every step", () => {
    render(<GoalForm />);
    expect(stepItems().map((s) => s.textContent?.replace(/Крок.*$/, ""))).toEqual([
      "1Основне",
      "2Внески",
      "3Додатково",
    ]);
    expect(
      within(shownStep())
        .getAllByRole("textbox")
        .map((i) => i.getAttribute("aria-required")),
    ).toEqual(["true", "true"]);
    expect(barLabels()).toEqual(["Скасувати", "Далі", "Додати ціль"]);
    fillStep1();
    act(() => button("Далі").click());
    expect(barLabels()).toEqual(["Скасувати", "Назад", "Далі", "Додати ціль"]);
    act(() => button("Далі").click());
    expect(barLabels()).toEqual(["Скасувати", "Назад", "Додати ціль"]);
    expect(document.querySelector(".ws-dialog-actions")!.getAttribute("data-bar")).toBe("form");
  });

  it("CMP-21@PoC AC13: one hint on top, «Поля з * обов’язкові.», and the form is aligned left", () => {
    render(<GoalForm />);
    const hints = document.querySelectorAll(".ws-form-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0]!.textContent).toBe("Поля з * обов’язкові.");
    expect(hints[0]!.closest(".ws-form-step")!.getAttribute("data-step")).toBe("0");
    expect(document.querySelector("dialog")!.getAttribute("data-align")).toBe("start");
  });

  it("CMP-21@PoC AC15: leaving the empty «Цільова сума» shows «Обов’язкове поле» and the reason line; «Далі», the main action and steps 2–3 are inactive", () => {
    render(<GoalForm />);
    type("Назва", "Відпустка");
    act(() => input("Цільова сума").focus());
    expect(within(shownStep()).queryByText(/Обов’язкове поле/)).toBeNull();
    leave("Цільова сума");
    expect(input("Цільова сума").getAttribute("aria-invalid")).toBe("true");
    expect(within(shownStep()).getByText(/Обов’язкове поле/)).toBeTruthy();
    expect(input("Цільова сума").closest(".ws-field")!.getAttribute("data-state")).toBe("error");
    expect(button("Далі").getAttribute("aria-disabled")).toBe("true");
    expect(button("Додати ціль").getAttribute("aria-disabled")).toBe("true");
    expect(reasonLine()!.textContent).toBe("Щоб продовжити, заповніть: Цільова сума");
    const [, second, third] = stepItems();
    for (const step of [second!, third!]) {
      expect(step.getAttribute("aria-disabled")).toBe("true");
      expect(step.dataset.state).toBe("unavailable");
      act(() => step.click());
    }
    expect(shownStep().dataset.step).toBe("0");
    // The error goes as soon as the value is valid.
    type("Цільова сума", "3000");
    expect(within(shownStep()).queryByText(/Обов’язкове поле/)).toBeNull();
    expect(reasonLine()).toBeNull();
  });

  it("CMP-21@PoC AC15: a field of another step is named with its step number", () => {
    function Form() {
      const [name, setName] = useState("");
      return (
        <I18nProvider>
          <FormDialog
            open
            onClose={() => {}}
            title="Нова транзакція"
            steps={[{ label: "Основне" }, { label: "Рахунок" }]}
            fields={[
              { id: "name", label: "Назва", required: true, empty: name === "" },
              { id: "account", label: "Рахунок", step: 1, required: true, empty: true },
            ]}
            submitLabel="Додати транзакцію"
            onSubmit={() => {}}
          >
            {(form) =>
              form.step === 0 ? <Field label="Назва" value={name} onChange={setName} /> : <span>Рахунок</span>
            }
          </FormDialog>
        </I18nProvider>
      );
    }
    render(<Form />);
    expect(reasonLine()!.textContent).toBe("Щоб продовжити, заповніть: Назва, Рахунок (крок 2)");
  });

  it("CMP-21@PoC AC16: «Назад» and step 1 on the indicator open the step with every value kept; passed steps show «✓»", () => {
    render(<GoalForm />);
    fillStep1();
    act(() => button("Далі").click());
    type("Щомісячний внесок", "250");
    act(() => button("Далі").click());
    type("Нотатка", "Море");
    expect(shownStep().dataset.step).toBe("2");
    expect(stepItems().map((s) => s.dataset.state)).toEqual(["done", "done", "current"]);
    expect(stepItems()[0]!.querySelector("svg")).toBeTruthy();
    expect(within(steps()).getByRole("button", { name: "Крок 1: Основне — заповнено" })).toBeTruthy();
    act(() => button("Назад").click());
    expect(shownStep().dataset.step).toBe("1");
    expect(input("Щомісячний внесок").value).toBe("250");
    act(() => stepItems()[0]!.click());
    expect(shownStep().dataset.step).toBe("0");
    expect(input("Назва").value).toBe("Відпустка");
    expect(input("Цільова сума").value).toBe("3000");
    expect(stepItems()[0]!.getAttribute("aria-current")).toBe("step");
    expect(
      stepItems()
        .slice(1)
        .map((s) => s.dataset.state),
    ).toEqual(["done", "done"]);
    act(() => stepItems()[2]!.click());
    expect(input("Нотатка").value).toBe("Море");
  });

  it("CMP-21@PoC AC17: with every required field on step 1 filled the main action works from step 1; while one is empty it is inactive on every step", () => {
    const submit = vi.fn();
    render(<GoalForm onSubmit={submit} />);
    act(() => button("Додати ціль").click());
    expect(submit).not.toHaveBeenCalled();
    type("Назва", "Відпустка");
    expect(button("Додати ціль").getAttribute("aria-disabled")).toBe("true");
    type("Цільова сума", "3000");
    expect(button("Додати ціль").getAttribute("aria-disabled")).toBeNull();
    expect(stepItems().map((s) => s.dataset.state)).toEqual(["current", "available", "available"]);
    act(() => button("Додати ціль").click());
    expect(submit).toHaveBeenCalledWith({ ...EMPTY, name: "Відпустка", target: "3000" });
  });

  it("CMP-21@PoC AC17: going back and emptying a required field makes the main action inactive on the later steps too", () => {
    render(<GoalForm />);
    fillStep1();
    act(() => button("Далі").click());
    act(() => button("Назад").click());
    type("Назва", "");
    act(() => stepItems()[1]!.click());
    expect(shownStep().dataset.step).toBe("0");
    expect(button("Додати ціль").getAttribute("aria-disabled")).toBe("true");
  });

  it("CMP-21@PoC AC18: the inactive «Далі» is reached by Tab, has aria-disabled and aria-describedby on the reason line, shows it on hover; Enter and Space do nothing", () => {
    render(<GoalForm />);
    type("Назва", "Відпустка");
    act(() => input("Цільова сума").focus());
    leave("Цільова сума");
    const next = button("Далі");
    let guard = 0;
    while (document.activeElement !== next && guard++ < 20) act(() => tab());
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.hasAttribute("disabled")).toBe(false);
    const line = reasonLine()!;
    expect(line.textContent).toBe("Щоб продовжити, заповніть: Цільова сума");
    expect(next.getAttribute("aria-describedby")).toBe(line.id);
    fireEvent.mouseEnter(next);
    const tip = within(dialog()).getByRole("tooltip");
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe("Щоб продовжити, заповніть: Цільова сума");
    fireEvent.keyDown(next, { key: "Enter" });
    fireEvent.keyDown(next, { key: " " });
    act(() => next.click());
    expect(shownStep().dataset.step).toBe("0");
  });

  it("CMP-21@PoC AC19: editing — clearing «Назва» makes «Зберегти» inactive with the reason line and later steps unavailable; typing it back makes it active", () => {
    render(<GoalForm editing initial={{ ...EMPTY, name: "Відпустка", target: "3000" }} />);
    expect(stepItems().map((s) => s.dataset.state)).toEqual(["current", "done", "done"]);
    expect(button("Зберегти").getAttribute("aria-disabled")).toBeNull();
    type("Назва", "");
    leave("Назва");
    expect(button("Зберегти").getAttribute("aria-disabled")).toBe("true");
    expect(reasonLine()!.textContent).toBe("Щоб продовжити, заповніть: Назва");
    expect(
      stepItems()
        .slice(1)
        .map((s) => s.dataset.state),
    ).toEqual(["unavailable", "unavailable"]);
    type("Назва", "Відпустка в горах");
    expect(button("Зберегти").getAttribute("aria-disabled")).toBeNull();
    expect(reasonLine()).toBeNull();
    expect(
      stepItems()
        .slice(1)
        .map((s) => s.dataset.state),
    ).toEqual(["done", "done"]);
  });

  it("CMP-21@PoC AC19: a passed step that became invalid shows «!» and its later steps are unavailable", () => {
    function Form() {
      const [name, setName] = useState("Відпустка");
      return (
        <I18nProvider>
          <button type="button" onClick={() => setName("")}>
            Очистити
          </button>
          <FormDialog
            open
            onClose={() => {}}
            title="Редагувати ціль"
            editing
            steps={STEPS}
            fields={[{ id: "name", label: "Назва", required: true, empty: name === "" }]}
            submitLabel="Зберегти"
            onSubmit={() => {}}
          >
            {(form) => <span>{form.step}</span>}
          </FormDialog>
        </I18nProvider>
      );
    }
    render(<Form />);
    act(() => stepItems()[1]!.click());
    // Outside the dialog in a real page; here the clear comes from the consumer's state.
    const clear = document.querySelector<HTMLButtonElement>("body > div > button")!;
    act(() => clear.click());
    expect(stepItems().map((s) => s.dataset.state)).toEqual(["attention", "current", "unavailable"]);
    expect(stepItems()[0]!.textContent).toContain("!");
    expect(within(steps()).getByRole("button", { name: "Крок 1: Основне — є помилка" })).toBeTruthy();
  });

  it("CMP-21@PoC AC20: a taken «Номер» in an optional field blocks the main action with «Щоб продовжити, виправте: Номер»", () => {
    render(<GoalForm taken="4417" />);
    fillStep1();
    act(() => stepItems()[2]!.click());
    type("Номер", "4417");
    leave("Номер");
    expect(within(shownStep()).getByText(/Такий номер уже є\./)).toBeTruthy();
    expect(button("Додати ціль").getAttribute("aria-disabled")).toBe("true");
    expect(reasonLine()!.textContent).toBe("Щоб продовжити, виправте: Номер");
    type("Номер", "4418");
    expect(button("Додати ціль").getAttribute("aria-disabled")).toBeNull();
  });

  it("CMP-21@PoC AC20: an empty required field and a blocking error together are both named", () => {
    render(<GoalForm taken="4417" />);
    type("Назва", "Відпустка");
    act(() => stepItems()[0]!.click());
    type("Цільова сума", "3000");
    act(() => stepItems()[2]!.click());
    type("Номер", "4417");
    act(() => stepItems()[0]!.click());
    type("Назва", "");
    expect(reasonLine()!.textContent).toBe("Щоб продовжити, заповніть: Назва; виправте: Номер (крок 3)");
  });

  it("CMP-21@PoC AC21: the reason line keeps its room while every button is active, so the bar does not move", () => {
    render(<GoalForm />);
    expect(reasonLine()).not.toBeNull();
    fillStep1();
    expect(reasonLine()).toBeNull();
    const slot = document.querySelector<HTMLElement>(".ws-dialog-note[data-empty]")!;
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.textContent).toBe("");
  });

  it("CMP-21@PoC AC21: every step is rendered in the same place; only the current one is shown, the others are inert and hidden from readers", () => {
    render(<GoalForm />);
    const all = [...document.querySelectorAll<HTMLElement>(".ws-form-step")];
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.hasAttribute("inert"))).toEqual([false, true, true]);
    expect(all.map((s) => s.getAttribute("aria-hidden"))).toEqual([null, "true", "true"]);
    expect(new Set(all.map((s) => s.parentElement))).toEqual(
      new Set([document.querySelector(".ws-form-steps")]),
    );
  });

  it("CMP-21@PoC AC24: on steps 2 and 3 the bar has «Скасувати», «Назад» and the main action (step 2 also «Далі»); «Скасувати» closes without changes", () => {
    const close = vi.fn();
    const submit = vi.fn();
    render(<GoalForm onClose={close} onSubmit={submit} />);
    fillStep1();
    act(() => button("Далі").click());
    expect(barLabels()).toEqual(["Скасувати", "Назад", "Далі", "Додати ціль"]);
    act(() => button("Далі").click());
    expect(barLabels()).toEqual(["Скасувати", "Назад", "Додати ціль"]);
    act(() => button("Скасувати").click());
    expect(close).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("CMP-21@PoC AC1: focus starts on the first field of step 1 and moves to the first field of each new step", () => {
    render(<GoalForm />);
    expect(document.activeElement).toBe(input("Назва"));
    fillStep1();
    act(() => button("Далі").click());
    expect(document.activeElement).toBe(input("Щомісячний внесок"));
  });

  it("CMP-21@PoC AC2: Tab never reaches a field of a hidden step", () => {
    render(<GoalForm />);
    const seen = new Set<Element | null>();
    for (let i = 0; i < 12; i++) {
      act(() => tab());
      seen.add(document.activeElement);
    }
    for (const el of seen) expect(el?.closest("[inert]")).toBeNull();
    expect(dialog().contains(document.activeElement)).toBe(true);
  });
});

describe("CMP-21@PoC FormMore («Додатково»)", () => {
  function RuleForm({ initialNote = "" }: { initialNote?: string }) {
    const [name, setName] = useState("Кава");
    const [note, setNote] = useState(initialNote);
    return (
      <I18nProvider>
        <FormDialog
          open
          onClose={() => {}}
          title="Правило категорії"
          fields={[
            { id: "name", label: "Назва", required: true, empty: name === "" },
            {
              id: "note",
              label: "Нотатка",
              empty: note === "",
              error: note.length > 5 ? "Нотатка довша за 5 символів." : null,
            },
          ]}
          submitLabel="Зберегти"
          onSubmit={() => {}}
        >
          {(form) => (
            <>
              <Field label="Назва" required value={name} onChange={setName} onBlur={form.leave("name")} />
              <FormMore label="Додатково: нотатка" fields={["note"]}>
                <Field
                  label="Нотатка"
                  value={note}
                  onChange={setNote}
                  onBlur={form.leave("note")}
                  error={form.errorOf("note")}
                />
              </FormMore>
            </>
          )}
        </FormDialog>
      </I18nProvider>
    );
  }

  const toggle = () => within(dialog()).getByRole("button", { name: "Додатково: нотатка" });
  const body = () => document.querySelector<HTMLElement>(".ws-form-more-body")!;

  it("CMP-21@PoC AC14: collapsed by default; a field with a value opens it, and its error under the field opens it too", () => {
    const { unmount } = render(<RuleForm />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(body().hidden).toBe(true);
    act(() => toggle().click());
    expect(body().hidden).toBe(false);
    act(() => toggle().click());
    expect(body().hidden).toBe(true);
    unmount();

    render(<RuleForm initialNote="Дуже довга нотатка" />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const note = within(body()).getByLabelText(/^Нотатка/);
    fireEvent.blur(note);
    expect(body().hidden).toBe(false);
    const field = note.closest(".ws-field")!;
    expect(field.parentElement).toBe(body());
    const error = within(field as HTMLElement).getByText(/Нотатка довша за 5 символів\./);
    expect(note.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // While it holds a value or an error it cannot be collapsed.
    act(() => toggle().click());
    expect(body().hidden).toBe(false);
  });
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Icon } from "../icons/Icon.tsx";
import { AmountField, Field, type AmountFieldProps, type FieldProps } from "./Field.tsx";

/**
 * CMP-02@PoC Field: markup, ARIA, states and behaviour. Sizes and colours are checked on the stylesheet in
 * `Field.css.test.ts`; the amount text in `amount.test.ts`.
 */

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");
const wrap = (ui: ReactNode) => <I18nProvider>{ui}</I18nProvider>;
/** The accessible description: the texts of `aria-describedby`, in order. */
const description = (el: HTMLElement) =>
  norm(
    (el.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
const fieldOf = (el: HTMLElement) => el.closest<HTMLElement>(".ws-field")!;

function Controlled(props: Omit<FieldProps, "value" | "onChange"> & { initial?: string }) {
  const { initial = "", ...rest } = props;
  const [value, setValue] = useState(initial);
  return <Field {...rest} value={value} onChange={setValue} />;
}

function Amount(
  props: Omit<AmountFieldProps, "value" | "onChange"> & {
    initial?: string | null;
    spy?: AmountFieldProps["onChange"];
  },
) {
  const { initial = null, spy, ...rest } = props;
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <AmountField
        {...rest}
        value={value}
        onChange={(v, p) => {
          spy?.(v, p);
          if (p === null) setValue(v);
        }}
      />
      <output data-testid="state">{value ?? ""}</output>
    </>
  );
}

/** Text width of the hidden copy: 8 px a character; the input's own width as given. */
function widths(inputWidth: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const w = this.classList.contains("ws-field-probe") ? (this.textContent ?? "").length * 8 : 0;
    return {
      width: w,
      height: 0,
      top: 0,
      left: 0,
      right: w,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "INPUT" ? inputWidth : 0;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CMP-02@PoC Field", () => {
  it("CMP-02@PoC AC1: the 41st character of «Назва цілі» is not added and the counter shows «40 / 40»", () => {
    render(wrap(<Controlled label="Назва цілі" maxLength={40} counter initial={"а".repeat(32)} />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Назва цілі" });
    const counter = () => norm(fieldOf(input).querySelector(".ws-field-counter")!.textContent);
    expect(counter()).toBe("32 / 40");
    expect(input.maxLength).toBe(40);
    fireEvent.change(input, { target: { value: "б".repeat(40) } });
    expect(counter()).toBe("40 / 40");
    // A paste or a browser that ignores `maxlength`: the field still keeps 40.
    fireEvent.change(input, { target: { value: "б".repeat(41) } });
    expect(input.value).toHaveLength(40);
    expect(counter()).toBe("40 / 40");
    // The counter sits inside the field and is read with it.
    expect(fieldOf(input).querySelector(".ws-field-box .ws-field-counter")).not.toBeNull();
    expect(description(input)).toContain("40 / 40");
  });

  it("CMP-02@PoC AC2: «12,345» in a euro field shows on leaving an error that starts with «Помилка» and asks for up to 2 decimals, with the loss border and aria-invalid", () => {
    const spy = vi.fn();
    render(wrap(<Amount label="Сума" currency="EUR" spy={spy} />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Сума" });
    expect(input.inputMode).toBe("decimal");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12,345" } });
    // No error while typing: it appears when the field is left.
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.blur(input);
    const error = fieldOf(input).querySelector(".ws-field-error")!;
    expect(norm(error.textContent)).toBe("Помилка. Використовуйте до 2 знаків після коми для євро.");
    expect(error.textContent!.startsWith("Помилка")).toBe(true);
    // A marker before the word, so the colour is not the only sign (NFR-08 FR 4).
    expect(error.querySelector(".ws-icon")).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // The `loss` border comes from the error state (see the CSS test).
    expect(fieldOf(input).dataset.state).toBe("error");
    expect(input.value).toBe("12,345");
    expect(spy).toHaveBeenLastCalledWith(null, "places");
  });

  it("CMP-02@PoC AC3: 4 512 300 000,00 in a 120 px amount field shows «4,51 млрд» underlined, the full value on hover and for editing on focus", () => {
    widths(120);
    render(wrap(<Amount label="Сума" currency="EUR" initial="4512300000.00" />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Сума" });
    expect(norm(input.value)).toBe("4,51 млрд");
    expect(input.dataset.abbreviated).toBe("true");

    fireEvent.mouseEnter(input);
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip.hidden).toBe(false);
    expect(norm(tip.textContent)).toBe("4 512 300 000,00");
    // The full value is also the description a screen reader hears.
    expect(description(input)).toContain("4 512 300 000,00");
    fireEvent.mouseLeave(input);

    fireEvent.focus(input);
    expect(norm(input.value)).toBe("4 512 300 000,00");
    expect(input.dataset.abbreviated).toBeUndefined();
    // The program reads the state, not the shown text.
    expect(screen.getByTestId("state").textContent).toBe("4512300000.00");
    fireEvent.blur(input);
    expect(norm(input.value)).toBe("4,51 млрд");
    expect(screen.getByTestId("state").textContent).toBe("4512300000.00");
  });

  it("CMP-02@PoC AC4: a field in error is announced with its label, value and error text", () => {
    render(
      wrap(
        <Field
          label="Сума"
          value="abc"
          hint="До 999 999 999,99"
          error="Введіть число, наприклад 3 000,00."
          onChange={() => {}}
        />,
      ),
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Сума" });
    expect(input.value).toBe("abc");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description(input)).toBe("Помилка. Введіть число, наприклад 3 000,00.");
    // The error replaces the hint.
    expect(fieldOf(input).querySelector(".ws-field-hint")).toBeNull();
    // The label is tied with `for`.
    expect(fieldOf(input).querySelector("label")!.htmlFor).toBe(input.id);
  });

  it("CMP-02@PoC AC4: the error is announced at once after the check: it fills a live region that was there before", () => {
    const { rerender } = render(wrap(<Field label="Сума" value="" hint="Підказка" onChange={() => {}} />));
    const input = screen.getByRole("textbox", { name: "Сума" });
    const live = fieldOf(input).querySelector<HTMLElement>(".ws-field-live")!;
    expect(live.getAttribute("aria-live")).toBe("assertive");
    expect(live.textContent).toBe("");
    expect(description(input)).toBe("Підказка");
    rerender(wrap(<Field label="Сума" value="" hint="Підказка" error="Вкажіть суму." onChange={() => {}} />));
    expect(fieldOf(input).querySelector(".ws-field-live")).toBe(live);
    expect(norm(live.textContent)).toBe("Помилка. Вкажіть суму.");
  });

  it("CMP-02@PoC AC5: a disabled field is disabled, keeps its label and has its reason beside it", () => {
    render(wrap(<Field label="Валюта" value="EUR" disabled hint="Валюту рахунку не можна змінити." />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Валюта" });
    expect(input.disabled).toBe(true);
    expect(fieldOf(input).dataset.state).toBe("disabled");
    expect(description(input)).toBe("Валюту рахунку не можна змінити.");
  });

  it("CMP-02@PoC AC6: the placeholder is the same element and font as the entered text", () => {
    render(wrap(<Controlled label="Назва" placeholder="Наприклад, Відпустка" />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Назва" });
    expect(input.placeholder).toBe("Наприклад, Відпустка");
    const before = input.className;
    fireEvent.change(input, { target: { value: "Відп" } });
    // Nothing about the input changes but its value (the type is the CSS test).
    expect(input.className).toBe(before);
    expect(input.value).toBe("Відп");
  });

  it("CMP-02@PoC AC7: «Назва» has its label above the field, outside it, and the field is one input in a box", () => {
    render(wrap(<Controlled label="Назва" />));
    const input = screen.getByRole("textbox", { name: "Назва" });
    const field = fieldOf(input);
    const [label, box] = Array.from(field.children);
    expect(label!.tagName).toBe("LABEL");
    expect(box!.classList.contains("ws-field-box")).toBe(true);
    expect(box!.contains(input)).toBe(true);
    expect(label!.contains(input)).toBe(false);
  });

  it("CMP-02@PoC FR «Клавіатура і екранний читач»: a required field has «*» and the word, and aria-required", () => {
    render(wrap(<Controlled label="Назва" required />));
    const input = screen.getByRole("textbox", { name: "Назва, обов’язкове поле" });
    expect(input.getAttribute("aria-required")).toBe("true");
    const star = fieldOf(input).querySelector(".ws-field-required")!;
    expect(star.textContent!.trim()).toBe("*");
    expect(star.getAttribute("aria-hidden")).toBe("true");
  });

  it("CMP-02@PoC FR «Стани»: read-only keeps its value and border state; empty shows the placeholder and the hint", () => {
    render(
      wrap(
        <>
          <Field label="Рахунок" value="Поточний ··4417" readOnly />
          <Controlled label="Нотатка" placeholder="Необов’язково" hint="До 200 символів" />
        </>,
      ),
    );
    const ro = screen.getByRole<HTMLInputElement>("textbox", { name: "Рахунок" });
    expect(ro.readOnly).toBe(true);
    expect(fieldOf(ro).dataset.state).toBe("readonly");
    const empty = screen.getByRole<HTMLInputElement>("textbox", { name: "Нотатка" });
    expect(empty.value).toBe("");
    expect(fieldOf(empty).dataset.state).toBe("default");
    expect(norm(fieldOf(empty).querySelector(".ws-field-hint")!.textContent)).toBe("До 200 символів");
  });

  it("CMP-02@PoC FR «Розміри і стиль»: the unit is inside on the right and read with the field; the search field has a 36 px size and a decorative magnifier", () => {
    render(
      wrap(
        <>
          <Field label="Ставка" value="12" suffix="%" onChange={() => {}} />
          <Field
            label="Пошук"
            type="search"
            size="search"
            value=""
            prefix={<Icon name="search" size={16} />}
            onChange={() => {}}
          />
        </>,
      ),
    );
    const rate = screen.getByRole("textbox", { name: "Ставка" });
    const suffix = fieldOf(rate).querySelector(".ws-field-box > .ws-field-suffix")!;
    expect(suffix.textContent).toBe("%");
    expect(rate.compareDocumentPosition(suffix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description(rate)).toBe("%");
    const search = screen.getByRole("searchbox", { name: "Пошук" });
    const box = fieldOf(search).querySelector<HTMLElement>(".ws-field-box")!;
    expect(box.dataset.size).toBe("search");
    const prefix = box.querySelector(".ws-field-prefix")!;
    expect(prefix.getAttribute("aria-hidden")).toBe("true");
    expect(prefix.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("CMP-02@PoC FR «Довгі значення»: a text wider than the field is cut off and only then has a tooltip with the full text", () => {
    widths(120);
    const long = "Відпустка в Карпатах з родиною";
    const { rerender } = render(wrap(<Field label="Назва" value={long} onChange={() => {}} />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Назва" });
    // The text stays whole in the field (the ellipsis is CSS); the tooltip carries it on hover.
    expect(input.value).toBe(long);
    fireEvent.mouseEnter(input);
    expect(screen.getByRole("tooltip").textContent).toBe(long);
    fireEvent.mouseLeave(input);
    rerender(wrap(<Field label="Назва" value="Відпустка" onChange={() => {}} />));
    fireEvent.mouseEnter(input);
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  it("CMP-02@PoC FR «Довгі значення»: a value with more digits than the currency is shown rounded with «≈», the full value on focus, unchanged on leaving", () => {
    const spy = vi.fn();
    render(wrap(<Amount label="Частка" currency="EUR" initial="0.3333" spy={spy} />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Частка" });
    expect(norm(input.value)).toBe("≈ 0,33");
    fireEvent.focus(input);
    expect(norm(input.value)).toBe("0,3333");
    fireEvent.blur(input);
    expect(norm(input.value)).toBe("≈ 0,33");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("CMP-02@PoC FR «Вміст»: leaving an amount pads it to the currency's digits; text that is not a number says what to enter", () => {
    const spy = vi.fn();
    render(wrap(<Amount label="Сума" currency="UAH" spy={spy} />));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Сума" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "3000,5" } });
    expect(spy).toHaveBeenLastCalledWith("3000.50", null);
    fireEvent.blur(input);
    expect(norm(input.value)).toBe("3 000,50");
    expect(screen.getByTestId("state").textContent).toBe("3000.50");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "три" } });
    fireEvent.blur(input);
    expect(norm(fieldOf(input).querySelector(".ws-field-error")!.textContent)).toBe(
      "Помилка. Введіть число, наприклад 3 000,00.",
    );
    expect(spy).toHaveBeenLastCalledWith(null, "invalid");
    // Fixing it clears the error as soon as the text is a number again.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("CMP-02@PoC FR «Вміст»: in English the error and the number follow the language", () => {
    render(
      <I18nProvider initialLocale="en">
        <Amount label="Amount" currency="EUR" />
      </I18nProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Amount" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12.345" } });
    fireEvent.blur(input);
    expect(norm(fieldOf(input).querySelector(".ws-field-error")!.textContent)).toBe(
      "Error. Use up to 2 decimal places for euros.",
    );
    fireEvent.focus(input);
    act(() => {
      fireEvent.change(input, { target: { value: "1,234.5" } });
    });
    fireEvent.blur(input);
    expect(input.value).toBe("1,234.50");
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type FormEvent } from "react";
import { Select } from "./Select.tsx";
import { SearchSelect } from "./SearchSelect.tsx";
import { ListButton } from "./ListButton.tsx";
import { AccountSelect, CategorySelect, type CategoryChoice } from "./choices.tsx";
import { selectVariant, type SearchGroup } from "./listbox.tsx";

const CURRENCIES = [
  { value: "EUR", label: "EUR — євро" },
  { value: "UAH", label: "UAH — гривня" },
  { value: "USD", label: "USD — долар США, валюта для рахунків за кордоном і відпусток" },
];

const cat = (value: string, label: string, n: number): CategoryChoice => ({
  value,
  label,
  color: `chart-cat-${n}`,
  icon: "budget",
});
const FOOD = [
  cat("groceries", "Продукти", 1),
  cat("cafe", "Кафе і ресторани", 2),
  cat("delivery", "Доставка їжі", 3),
];
const HOME = [cat("rent", "Оренда", 4), cat("utilities", "Комунальні", 5)];
const GROUPS = [
  { id: "food", title: "Харчування", categories: FOOD },
  { id: "home", title: "Дім", categories: HOME },
];

function RequiredForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(value ? undefined : "Оберіть валюту рахунку.");
  };
  return (
    <form onSubmit={submit} noValidate>
      <Select label="Валюта" options={CURRENCIES} value={value} onChange={setValue} required error={error} />
      <button type="submit">Зберегти</button>
    </form>
  );
}

function Controlled(props: { groups: SearchGroup[]; create?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <SearchSelect
      label="Контрагент"
      groups={props.groups}
      value={value}
      onChange={setValue}
      {...(props.create
        ? { create: { label: (q: string) => `Додати «${q}»`, onCreate: () => undefined } }
        : {})}
    />
  );
}

const PAYEES: SearchGroup[] = [
  {
    id: "all",
    title: "",
    options: ["Сільпо", "АТБ", "Продукти біля дому", "Новус", "Магазин «Продмаг»"].map((label, i) => ({
      value: `p${i}`,
      label,
    })),
  },
];

describe("CMP-03@PoC Select — native", () => {
  it("CMP-03@PoC AC1: a value longer than the field is cut with an ellipsis; the list shows the option in full", () => {
    render(<Select label="Валюта" options={CURRENCIES} value="USD" onChange={() => undefined} />);
    const select = screen.getByRole("combobox", { name: "Валюта" }) as HTMLSelectElement;
    expect(select.className).toContain("ws-select-control");
    const option = screen.getByRole("option", { name: CURRENCIES[2]!.label }) as HTMLOptionElement;
    expect(option.textContent).toBe(CURRENCIES[2]!.label);
    expect(option.selected).toBe(true);
  });

  it("CMP-03@PoC AC2: a required list without a value, on submit: the error «Помилка. Оберіть …» under it, aria-invalid, announced", () => {
    render(<RequiredForm />);
    const select = screen.getByRole("combobox", { name: /Валюта/ });
    expect(select.getAttribute("aria-invalid")).toBeNull();
    expect(select.getAttribute("aria-required")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("✕Помилка. Оберіть валюту рахунку.");
    expect(select.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.className).toBe("ws-select-error");
  });

  it("CMP-03@PoC AC3: the list is a native select, so ↓ moves the choice to the next option; the label names it", () => {
    const onChange = vi.fn();
    render(<Select label="Валюта" options={CURRENCIES} value="EUR" onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Валюта" });
    expect(select.tagName).toBe("SELECT");
    // The browser moves the choice on ↓ and fires `change`; jsdom does not, so the change is fired here.
    fireEvent.change(select, { target: { value: "UAH" } });
    expect(onChange).toHaveBeenCalledWith("UAH");
  });

  it("CMP-03@PoC AC4: a list of 15 choices is the «з пошуком» variant; 8 stay native", () => {
    expect(selectVariant(15)).toBe("search");
    expect(selectVariant(8)).toBe("native");
    const options = Array.from({ length: 15 }, (_, i) => ({ value: `c${i}`, label: `Пункт ${i + 1}` }));
    render(<Select label="Категорія" options={options} value="" onChange={() => undefined} />);
    expect(document.querySelector("select")).toBeNull();
    const control = screen.getByRole("button", { name: /Категорія/ });
    expect(control.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("CMP-03@PoC empty: no value shows «Оберіть…» first, in `ink-muted`", () => {
    render(<Select label="Валюта" options={CURRENCIES} value="" onChange={() => undefined} />);
    const select = screen.getByRole("combobox", { name: "Валюта" }) as HTMLSelectElement;
    expect(select.options[0]!.textContent).toBe("Оберіть…");
    expect(select.className).toContain("ws-select-control--empty");
  });

  it("CMP-03@PoC disabled: the native select is disabled and its reason is beside it and read with it", () => {
    render(
      <Select
        label="Банк"
        options={CURRENCIES}
        value="EUR"
        onChange={() => undefined}
        disabled
        disabledReason="Банк не змінюється після підключення."
      />,
    );
    const select = screen.getByRole("combobox", { name: "Банк" }) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    const reason = screen.getByText("Банк не змінюється після підключення.");
    expect(select.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("CMP-03@PoC loading: a skeleton in the shape of the field under the label, no control yet", () => {
    render(<Select label="Валюта" options={[]} value="" onChange={() => undefined} loading />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.querySelector(".ws-skeleton--field")).not.toBeNull();
    expect(screen.getByText("Валюта")).toBeTruthy();
  });

  it("CMP-03@PoC hint: the hint is under the field and describes it; the error replaces it", () => {
    const { rerender } = render(
      <Select
        label="Валюта"
        options={CURRENCIES}
        value=""
        onChange={() => undefined}
        hint="Валюта рахунку."
      />,
    );
    const select = screen.getByRole("combobox", { name: "Валюта" });
    expect(document.getElementById(select.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Валюта рахунку.",
    );
    rerender(
      <Select
        label="Валюта"
        options={CURRENCIES}
        value=""
        onChange={() => undefined}
        hint="Валюта рахунку."
        error="Оберіть валюту."
      />,
    );
    expect(screen.queryByText("Валюта рахунку.")).toBeNull();
  });

  it("CMP-03@PoC required: the label says «обов’язкове» in words, not only a mark", () => {
    render(<Select label="Валюта" options={CURRENCIES} value="" onChange={() => undefined} required />);
    expect(screen.getByText("обов’язкове")).toBeTruthy();
  });
});

describe("CMP-03@PoC Select — «з пошуком»", () => {
  it("CMP-03@PoC AC9: «прод», ↓ and Enter choose the first item containing «прод», close the panel, focus back on the control", () => {
    render(<Controlled groups={PAYEES} />);
    const control = screen.getByRole("button", { name: /Контрагент/ });
    fireEvent.click(control);
    const search = screen.getByRole("combobox");
    expect(document.activeElement).toBe(search);
    expect(search.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox");
    expect(search.getAttribute("aria-controls")).toBe(list.id);
    fireEvent.change(search, { target: { value: "прод" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Продукти біля дому",
      "Магазин «Продмаг»",
    ]);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]!.id);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(control);
    expect(control.textContent).toContain("Продукти біля дому");
    expect(control.getAttribute("aria-expanded")).toBe("false");
  });

  it("CMP-03@PoC FR: ↑ ↓ move the active option and Esc closes the panel and returns the focus to the control", () => {
    render(<Controlled groups={PAYEES} />);
    const control = screen.getByRole("button", { name: /Контрагент/ });
    fireEvent.keyDown(control, { key: "ArrowDown" });
    const search = screen.getByRole("combobox");
    const ids = screen.getAllByRole("option").map((o) => o.id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe(ids[1]);
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(search.getAttribute("aria-activedescendant")).toBe(ids[0]);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(control);
  });

  it("CMP-03@PoC empty search: no match shows «Нічого не знайдено» and the creation item built from the text", () => {
    render(<Controlled groups={PAYEES} create />);
    fireEvent.click(screen.getByRole("button", { name: /Контрагент/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Кава" } });
    expect(screen.getByRole("status").textContent).toBe("Нічого не знайдено");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Додати «Кава»"]);
  });

  it("CMP-03@PoC outside press: a press outside the field closes the panel", () => {
    render(<Controlled groups={PAYEES} />);
    fireEvent.click(screen.getByRole("button", { name: /Контрагент/ }));
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("CMP-03@PoC AC6: a transaction with «Сільпо»: search on top, «Часто для «Сільпо»» first, groups, «Нова категорія» last", () => {
    render(
      <CategorySelect
        label="Категорія"
        value=""
        onChange={() => undefined}
        merchant="Сільпо"
        top={[FOOD[0]!]}
        groups={GROUPS}
        onCreate={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Категорія/ }));
    const panel = document.querySelector(".ws-dropdown-panel")!;
    expect(panel.firstElementChild!.querySelector('[role="combobox"]')).not.toBeNull();
    const groups = screen.getAllByRole("group");
    expect(
      groups.map(
        (g) =>
          g.getAttribute("aria-labelledby") &&
          document.getElementById(g.getAttribute("aria-labelledby")!)!.textContent,
      ),
    ).toEqual(["Часто для «Сільпо»", "Харчування", "Дім"]);
    const options = screen.getAllByRole("option");
    expect(options.at(-1)!.textContent).toBe("Нова категорія");
    expect(options[0]!.querySelector(".ws-select-dot")).not.toBeNull();
  });

  it("CMP-03@PoC AC7: without a known merchant the first group is «Нещодавні» and «Нова категорія» is last", () => {
    const onCreate = vi.fn();
    render(
      <CategorySelect
        label="Категорія"
        value=""
        onChange={() => undefined}
        top={[HOME[0]!]}
        groups={GROUPS}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Категорія/ }));
    expect(screen.getAllByRole("group")[0]!.textContent).toContain("Нещодавні");
    const last = screen.getAllByRole("option").at(-1)!;
    expect(last.textContent).toBe("Нова категорія");
    fireEvent.click(last);
    expect(onCreate).toHaveBeenCalledWith("");
  });

  it("CMP-03@PoC AC8: every account and the chosen value show the name with the mask «··NNNN»", () => {
    function Accounts() {
      const [value, setValue] = useState("");
      return (
        <AccountSelect
          label="Рахунок"
          value={value}
          onChange={setValue}
          accounts={[
            { value: "a1", name: "Поточний", last4: "4417", secondary: "залишок 5 200,00 €" },
            { value: "a2", name: "Кредитна", last4: "9021", secondary: "залишок −640,00 €" },
          ]}
        />
      );
    }
    render(<Accounts />);
    const control = screen.getByRole("button", { name: /Рахунок/ });
    fireEvent.click(control);
    const labels = screen
      .getAllByRole("option")
      .map((o) => o.querySelector(".ws-select-option__label")!.textContent);
    expect(labels).toEqual(["Поточний ··4417", "Кредитна ··9021"]);
    expect(labels.every((l) => /··\d{4}$/.test(l!))).toBe(true);
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(control.textContent).toBe("Поточний ··4417");
    expect(screen.getByRole("button", { name: "Рахунок Поточний ··4417" })).toBe(control);
  });

  it("CMP-03@PoC disabled «з пошуком»: the control does not open", () => {
    render(<SearchSelect label="Рахунок" groups={PAYEES} value="" onChange={() => undefined} disabled />);
    const control = screen.getByRole("button", { name: /Рахунок/ }) as HTMLButtonElement;
    expect(control.disabled).toBe(true);
  });

  it("CMP-03@PoC error «з пошуком»: aria-invalid on the control and the error read with it", () => {
    render(
      <SearchSelect
        label="Рахунок"
        groups={PAYEES}
        value=""
        onChange={() => undefined}
        error="Оберіть рахунок."
      />,
    );
    const control = screen.getByRole("button", { name: /Рахунок/ });
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(control.getAttribute("aria-describedby")!)!.textContent).toContain(
      "Помилка. Оберіть рахунок.",
    );
  });
});

describe("CMP-03@PoC Select — «кнопка-список з підписом»", () => {
  const CATEGORIES = [
    { value: "all", label: "Усі" },
    { value: "food", label: "Продукти" },
    { value: "cafe", label: "Кафе" },
  ];

  it("CMP-03@PoC AC10: «Категорія: Усі» — aria-haspopup listbox, aria-expanded, the name «Категорія: Усі», no label above", () => {
    const { container } = render(
      <ListButton label="Категорія" options={CATEGORIES} value="all" onChange={() => undefined} />,
    );
    const button = screen.getByRole("button", { name: "Категорія: Усі" });
    expect(button.getAttribute("aria-haspopup")).toBe("listbox");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.className).toBe("ws-list-button");
    expect(button.textContent).toBe("Категорія:Усі");
    expect(container.querySelector("label")).toBeNull();
  });

  it("CMP-03@PoC FR: the list opens under the button with a check by the current item; arrows, Enter choose; focus back", () => {
    function Filter() {
      const [value, setValue] = useState("all");
      return <ListButton label="Категорія" options={CATEGORIES} value={value} onChange={setValue} />;
    }
    render(<Filter />);
    const button = screen.getByRole("button", { name: "Категорія: Усі" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Категорія" });
    expect(document.activeElement).toBe(list);
    const options = screen.getAllByRole("option");
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(options[0]!.querySelector(".ws-select-option__check")).not.toBeNull();
    expect(list.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Категорія: Продукти" }));
  });

  it("CMP-03@PoC FR: Esc closes the list without a change and returns the focus to the button", () => {
    const onChange = vi.fn();
    render(
      <ListButton
        label="Вигляд"
        options={[{ value: "full", label: "Повний" }]}
        value="full"
        onChange={onChange}
      />,
    );
    const button = screen.getByRole("button", { name: "Вигляд: Повний" });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onChange).not.toHaveBeenCalled();
  });
});

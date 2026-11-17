import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ListToolbar } from "../toolbar/ListToolbar.tsx";
import { FilterBar, FilterChecks, FilterRow, type FilterChipItem } from "./FilterBar.tsx";

const ACCOUNTS = [
  { value: "a1", label: "Поточний ··4417" },
  { value: "a2", label: "Ощадний ··1180" },
  { value: "a3", label: "Кредитна ··9021" },
];

/** A list with two filters on synthetic values: the applied ones become chips, the draft lives in the panel. */
function Bar({ onApplied = () => {} }: { onApplied?: (accounts: string[], type: string[]) => void }) {
  const [applied, setApplied] = useState<{ accounts: string[]; type: string[] }>({ accounts: [], type: [] });
  const [draft, setDraft] = useState(applied);
  const name = (v: string) => ACCOUNTS.find((a) => a.value === v)!.label;
  const chips: FilterChipItem[] = [];
  if (applied.accounts.length)
    chips.push({
      id: "accounts",
      field: "Рахунки",
      value: applied.accounts.map(name).join(", "),
      text: `Рахунки: ${applied.accounts.map(name).join(", ")}`,
    });
  if (applied.type.length) chips.push({ id: "type", field: "Тип", value: "списання", text: "Тип: списання" });
  const count = chips.length;
  return (
    <ListToolbar label="Керування списком">
      <input type="search" aria-label="Пошук" />
      <FilterBar
        count={count}
        chips={chips}
        onOpen={() => setDraft(applied)}
        onRemove={(id) => setApplied((a) => ({ ...a, [id]: [] }))}
        onApply={() => {
          setApplied(draft);
          onApplied(draft.accounts, draft.type);
        }}
        onReset={() => setApplied({ accounts: [], type: [] })}
      >
        <FilterRow
          label="Рахунки"
          summary={draft.accounts.length ? draft.accounts.map(name).join(", ") : "Усі"}
          unset={draft.accounts.length === 0}
        >
          <FilterChecks
            label="Рахунки"
            options={ACCOUNTS}
            value={draft.accounts}
            anyLabel="Усі рахунки"
            onChange={(accounts) => setDraft((d) => ({ ...d, accounts }))}
          />
        </FilterRow>
        <FilterRow
          label="Тип"
          summary={draft.type.length ? "Списання" : "Списання і надходження"}
          unset={draft.type.length === 0}
        >
          <FilterChecks
            label="Тип"
            multiple={false}
            anyLabel="Списання і надходження"
            options={[
              { value: "out", label: "Списання" },
              { value: "in", label: "Надходження" },
            ]}
            value={draft.type}
            onChange={(type) => setDraft((d) => ({ ...d, type }))}
          />
        </FilterRow>
      </FilterBar>
    </ListToolbar>
  );
}

const filtersButton = () => screen.getByRole("button", { name: /^Фільтри/ });
const row = (name: RegExp) => screen.getByRole("button", { name });

function chooseAccounts(...labels: string[]) {
  fireEvent.click(row(/^Рахунки:/));
  const list = screen.getByRole("listbox", { name: "Рахунки" });
  for (const label of labels) fireEvent.click(within(list).getByRole("option", { name: label }));
}

describe("CMP-32@PoC FilterBar", () => {
  it("CMP-32@PoC AC7, FR «Клавіатура і екранний читач»: «Фільтри» is a native button with aria-haspopup=dialog and aria-expanded; it opens a dialog without a scrim; «Фільтри · 2» has no separate badge; each chip's «×» is named «Прибрати фільтр: <поле> — <значення>»", () => {
    render(<Bar />);
    const button = filtersButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("Фільтри");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("dialog", { name: "Фільтри" });
    expect(panel.getAttribute("aria-modal")).toBeNull();
    chooseAccounts("Поточний ··4417", "Кредитна ··9021");
    fireEvent.click(row(/^Тип:/));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Тип" })).getByRole("option", { name: "Списання" }),
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Застосувати" }));
    expect(filtersButton().textContent).toBe("Фільтри · 2");
    expect(filtersButton().querySelector(".ws-badge")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Прибрати фільтр: Рахунки — Поточний ··4417, Кредитна ··9021" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прибрати фільтр: Тип — списання" })).toBeTruthy();
  });

  it("CMP-32@PoC AC2: the focused «×» of a chip is read as «Прибрати фільтр:» with the field and value; it removes that one filter and gives the focus back to «Фільтри»", () => {
    render(<Bar />);
    fireEvent.click(filtersButton());
    chooseAccounts("Ощадний ··1180");
    fireEvent.click(screen.getByRole("button", { name: "Застосувати" }));
    const remove = screen.getByRole("button", { name: "Прибрати фільтр: Рахунки — Ощадний ··1180" });
    act(() => remove.focus());
    expect(remove.getAttribute("title")).toBe("Прибрати фільтр: Рахунки — Ощадний ··1180");
    fireEvent.click(remove);
    expect(screen.queryByRole("button", { name: /^Прибрати фільтр/ })).toBeNull();
    expect(filtersButton().textContent).toBe("Фільтри");
    expect(document.activeElement).toBe(filtersButton());
  });

  it("CMP-32@PoC FR «Клавіатура і екранний читач»: the chips are a list named «Застосовані фільтри»; after «×» the focus goes to the next chip, and to «Фільтри» once none is left", () => {
    render(<Bar />);
    fireEvent.click(filtersButton());
    chooseAccounts("Ощадний ··1180");
    fireEvent.click(row(/^Тип:/));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Тип" })).getByRole("option", { name: "Списання" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Застосувати" }));
    const list = screen.getByRole("list", { name: "Застосовані фільтри" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(within(list).getByRole("button", { name: "Прибрати фільтр: Рахунки — Ощадний ··1180" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Прибрати фільтр: Тип — списання" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Прибрати фільтр: Тип — списання" }));
    expect(screen.queryByRole("list", { name: "Застосовані фільтри" })).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
  });

  it("CMP-32@PoC AC6, FR «Поведінка»: a change in the panel does not apply; the foot keeps «Скинути все» and «Застосувати» without a count; the list changes only on the press", () => {
    const applied = vi.fn();
    render(<Bar onApplied={applied} />);
    fireEvent.click(filtersButton());
    chooseAccounts("Поточний ··4417", "Ощадний ··1180");
    const panel = screen.getByRole("dialog", { name: "Фільтри" });
    expect(applied).not.toHaveBeenCalled();
    expect(
      within(panel)
        .getAllByRole("button")
        .map((b) => b.textContent)
        .slice(-2),
    ).toEqual(["Скинути все", "Застосувати"]);
    expect(filtersButton().textContent).toBe("Фільтри");
    fireEvent.click(within(panel).getByRole("button", { name: "Застосувати" }));
    expect(applied).toHaveBeenCalledWith(["a1", "a2"], []);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
  });

  it("CMP-32@PoC AC4, FR «Стани»: an unset row shows grey «Усі» / «Будь-який»; several values show through a comma, checked with check boxes; «Усі рахунки» clears them", () => {
    render(<Bar />);
    fireEvent.click(filtersButton());
    const accounts = row(/^Рахунки:/);
    expect(accounts.getAttribute("aria-label")).toBe("Рахунки: Усі");
    expect(accounts.hasAttribute("data-unset")).toBe(true);
    chooseAccounts("Поточний ··4417", "Ощадний ··1180");
    const list = screen.getByRole("listbox", { name: "Рахунки" });
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "true", "false"]);
    expect(options[1]!.querySelector(".ws-check-box[data-checked]")).not.toBeNull();
    expect(row(/^Рахунки:/).getAttribute("aria-label")).toBe("Рахунки: Поточний ··4417, Ощадний ··1180");
    expect(row(/^Рахунки:/).hasAttribute("data-unset")).toBe(false);
    fireEvent.click(within(list).getByRole("option", { name: "Усі рахунки" }));
    expect(row(/^Рахунки:/).getAttribute("aria-label")).toBe("Рахунки: Усі");
  });

  it("CMP-32@PoC AC5: the panel has only the rows of the list — no condition builder (attribute, operator, value)", () => {
    render(<Bar />);
    fireEvent.click(filtersButton());
    const panel = screen.getByRole("dialog", { name: "Фільтри" });
    expect(within(panel).queryByRole("button", { name: /Умова|Додати умову/ })).toBeNull();
    expect([...panel.querySelectorAll(".ws-filter-row__label")].map((l) => l.textContent)).toEqual([
      "Рахунки",
      "Тип",
    ]);
  });

  it("CMP-32@PoC FR «Клавіатура і екранний читач»: the lists move with the arrows, Space checks; one value closes its drop-down; Escape closes the drop-down, then the panel, back to «Фільтри»; the panel's controls are not the toolbar's", () => {
    render(<Bar />);
    fireEvent.click(filtersButton());
    const panel = screen.getByRole("dialog", { name: "Фільтри" });
    expect(document.activeElement).toBe(row(/^Рахунки:/));
    // The toolbar's ← → do not take the focus out of the panel.
    fireEvent.keyDown(row(/^Рахунки:/), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row(/^Рахунки:/));
    fireEvent.keyDown(row(/^Рахунки:/), { key: "ArrowDown" });
    const list = screen.getByRole("listbox", { name: "Рахунки" });
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: " " });
    expect(row(/^Рахунки:/).getAttribute("aria-label")).toBe("Рахунки: Поточний ··4417");
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(row(/^Рахунки:/));
    fireEvent.click(row(/^Тип:/));
    const type = screen.getByRole("listbox", { name: "Тип" });
    expect(type.getAttribute("aria-multiselectable")).toBeNull();
    fireEvent.keyDown(type, { key: "ArrowDown" });
    fireEvent.keyDown(type, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(row(/^Тип:/).getAttribute("aria-label")).toBe("Тип: Списання");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
    // Escape did not apply the draft.
    expect(filtersButton().textContent).toBe("Фільтри");
  });

  it("CMP-32@PoC FR «Поведінка»: «Скинути все» removes every filter; «Застосувати» that the consumer refuses keeps the panel open", () => {
    const refuse = vi.fn(() => false);
    const { unmount } = render(<Bar />);
    fireEvent.click(filtersButton());
    chooseAccounts("Поточний ··4417");
    fireEvent.click(screen.getByRole("button", { name: "Застосувати" }));
    expect(filtersButton().textContent).toBe("Фільтри · 1");
    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: "Скинути все" }));
    expect(filtersButton().textContent).toBe("Фільтри");
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    render(
      <FilterBar count={0} chips={[]} onRemove={() => {}} onApply={refuse} onReset={() => {}}>
        <FilterRow label="Сума" summary="Будь-яка" unset popup="dialog">
          <input aria-label="від" />
        </FilterRow>
      </FilterBar>,
    );
    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: "Застосувати" }));
    expect(refuse).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Фільтри" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Сума:/ }));
    expect(screen.getByRole("button", { name: /^Сума:/ }).getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "від" }));
  });
});

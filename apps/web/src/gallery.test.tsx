import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { colors, COLOR_TOKEN_NAMES, contrastRatio, formatRatio } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { App } from "./App.tsx";

/** No-break spaces (DS-08 item 11) compare as ordinary spaces. */
const norm = (s: string | null) => (s ?? "").replace(/&nbsp;|\u00A0|\u202F/g, " ");

/**
 * The page controls (theme, language, «Приховати суми»). The gallery renders every section at once
 * (about 4 350 elements), so a document-wide `screen.getByLabelText` takes about 2 s in jsdom and
 * `screen.getByRole(…, { name })` about 0.9 s; under a loaded full run that passed the 5 s limit.
 * Queries by label or by accessible name are scoped to the part of the page they test.
 */
const controls = () => within(document.querySelector<HTMLElement>("section.gallery-controls")!);

describe("/gallery/tokens (DS-22)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    installMatchMedia({ width: 390 });
    window.location.hash = "#/gallery/tokens";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // A test that fails between vi.useFakeTimers() and vi.useRealTimers() must not leave fake timers on.
    vi.useRealTimers();
  });

  it("is outside the app navigation, has one h1 and is closed to indexing", () => {
    render(<App />);
    // The only `nav` landmarks are the Pagination demos (CMP-13); there is no app navigation.
    for (const nav of screen.queryAllByRole("navigation"))
      expect(nav.getAttribute("aria-label")).toBe("Сторінки списку");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Дизайн-токени"]);
    expect(document.head.querySelector('meta[name="robots"]')!.getAttribute("content")).toContain("noindex");
  });

  it("shows every colour token in both themes with computed contrast ratios", () => {
    const { container } = render(<App />);
    const panels = container.querySelectorAll("#g-colors ~ .gallery-themes > [data-theme]");
    expect([...panels].map((p) => p.getAttribute("data-theme"))).toEqual(["light", "dark"]);
    for (const name of COLOR_TOKEN_NAMES) {
      expect(panels[0]!.textContent).toContain(colors[name].light);
      expect(panels[1]!.textContent).toContain(colors[name].dark);
    }
    const inkOnPaper = formatRatio(contrastRatio(colors.ink.light, colors["surface-100"].light));
    expect(container.querySelector("#g-contrast")!.parentElement!.textContent).toContain(`${inkOnPaper} : 1`);
    // No contrast pair fails: both contrast tables (the Progress section shows «✕ Помилка» as a state on purpose).
    const tables = container.querySelectorAll("#g-contrast ~ .gallery-themes > [data-theme]");
    expect(tables).toHaveLength(2);
    for (const table of tables) expect(norm(table.textContent)).not.toContain("✕ Помилка");
  });

  it("switches the page theme and hides amounts while keeping percentages", () => {
    const { container } = render(<App />);
    act(() => controls().getByLabelText("Темна").click());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    const amounts = container.querySelector("#g-amounts")!.parentElement!;
    expect(norm(amounts.textContent)).toContain("284 650,00 ₴");
    act(() => controls().getByRole("switch", { name: "Приховати суми" }).click());
    expect(norm(amounts.innerHTML)).not.toContain("284 650");
    expect(norm(amounts.textContent)).toContain("•••");
    expect(norm(amounts.textContent)).toContain("+2,4 %");
    expect(within(amounts as HTMLElement).getAllByRole("button", { name: "Сума прихована" }).length).toBe(4);
  });

  it("abbreviates large amounts with units and layout of the interface language (DS-04 item 11)", () => {
    // jsdom has no layout: every box is 40 px wide and text is 10 px per character, so the large
    // amounts do not fit and switch to the abbreviated form.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: (this.textContent ?? "").length * 10 } as DOMRect;
    });
    const { container } = render(<App />);
    const fit = () => norm(container.querySelector(".gallery-fit")!.innerHTML);
    expect(fit()).toContain("12,35 трлн €");
    expect(fit()).toContain("1,23 млн ₴");
    act(() => controls().getByLabelText("English").click());
    expect(fit()).toContain("€12.35tn");
    expect(fit()).toContain("₴1.23M");
  });

  it("DS-04@PoC AC13, FR 15: «Великі суми і скорочення» shows 0,01 € to 12 345 678 901,00 € in cards of 360, 240, 160 and 110 px, abbreviated with the full value in a tooltip", () => {
    // jsdom has no layout: every box is 40 px wide and text is 10 px per character, so the large
    // amounts do not fit and switch to the abbreviated form; 0,01 € is never abbreviated.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: (this.textContent ?? "").length * 10 } as DOMRect;
    });
    const { container } = render(<App />);
    const section = container.querySelector("#g-fit")!;
    expect(section.textContent).toBe("Великі суми і скорочення");
    const cases = [...container.querySelectorAll(".gallery-fit__case")];
    expect(cases.map((c) => (c.querySelector(".gallery-fit__box") as HTMLElement).style.inlineSize)).toEqual([
      "360px",
      "240px",
      "160px",
      "110px",
    ]);
    for (const box of cases) {
      const text = norm(box.textContent);
      expect(text).toContain("0,01 €");
      expect(norm(box.innerHTML)).toContain("12,35 млрд €");
      // The full value stays in the tooltip (CMP-25@PoC) and for screen readers.
      const tips = [...box.querySelectorAll(".ws-amount-fit[aria-describedby]")].map((el) =>
        norm(document.getElementById(el.getAttribute("aria-describedby")!)!.textContent),
      );
      expect(tips).toContain("12 345 678 901,00 €");
      // Each amount is one unbreakable run.
      expect(box.querySelectorAll(".ws-amount-fit").length).toBe(5);
    }
  });

  it("CMP-33@PoC, DS-12@PoC FR 9: «Іконки» shows the PoC set — no asset-type, insurance or investment icons; products end with «Інше»", () => {
    const { container } = render(<App />);
    const icons = container.querySelector("#g-icons")!.parentElement!;
    const codes = [...icons.querySelectorAll("code")].map((c) => c.textContent);
    expect(codes).toContain("mortgage");
    expect(codes).toContain("options");
    for (const name of ["property", "wine", "insurance-health", "investment-public"]) {
      expect(
        codes.some((c) => c?.includes(name)),
        name,
      ).toBe(false);
    }
    expect(within(icons as HTMLElement).getByText("Інше")).toBeTruthy();
    // Every icon on the page is decorative next to its caption.
    for (const icon of icons.querySelectorAll(".ws-icon"))
      expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("CMP-33@PoC AC3, DS-12@PoC AC2: «Кнопки лише з іконкою» — every icon-only button has a name and the same tooltip", () => {
    const { container } = render(<App />);
    const section = container.querySelector("#g-icon-buttons")!.parentElement as HTMLElement;
    const buttons = within(section).getAllByRole("button");
    expect(buttons.map((b) => norm(b.getAttribute("aria-label")))).toEqual([
      "Параметри",
      "Колонки",
      "Сортувати",
      "Фільтр",
      "Редагувати",
      "Налаштування рахунку",
      "Закрити",
    ]);
    for (const button of buttons) {
      expect(button.textContent).toBe("");
      act(() => button.focus());
      const tip = document.getElementById(button.getAttribute("aria-describedby")!)!;
      expect(tip.hidden).toBe(false);
      expect(tip.textContent).toBe(button.getAttribute("aria-label"));
    }
    const filter = within(section).getByRole("button", { name: "Фільтр" });
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    act(() => filter.click());
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    act(() => controls().getByLabelText("English").click());
    expect(within(section).getByRole("button", { name: "Options" })).toBeTruthy();
  });

  it("CMP-25@PoC gallery: the Tooltip section shows a cut-off name, a name that fits, an abbreviated amount and an icon-only button", () => {
    // jsdom has no layout: every box is 40 px wide, the names are 400 px of text, the amounts 10 px per character.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.textContent === "Подушка безпеки" ? 40 : 400;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: (this.textContent ?? "").length * 10 } as DOMRect;
    });
    const { container } = render(<App />);
    expect(container.querySelector("#g-tooltip")!.textContent).toBe("Підказка");
    const at = (c: string) => container.querySelector(`[data-case="${c}"]`)!;
    const cut = at("cut").querySelector<HTMLElement>(".ws-truncate")!;
    const fits = at("fits").querySelector<HTMLElement>(".ws-truncate")!;
    expect(cut.tabIndex).toBe(0);
    expect(norm(document.getElementById(cut.getAttribute("aria-describedby")!)!.textContent)).toBe(
      "Відпустка в Карпатах з дітьми влітку 2027 року",
    );
    expect(fits.hasAttribute("tabindex")).toBe(false);
    expect(fits.hasAttribute("aria-describedby")).toBe(false);
    expect(at("amount").querySelector(".ws-amount-fit[aria-describedby]")).not.toBeNull();
    const button = within(at("icon") as HTMLElement).getByRole("button", { name: "Додати транзакцію" });
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.getAttribute("role")).toBe(
      "tooltip",
    );
  });

  it("CMP-22@PoC gallery: the Skeleton section shows every variant, the slow line, and swaps the skeleton for its content", () => {
    const { container } = render(<App />);
    expect(container.querySelector("#g-skeleton")!.textContent).toBe("Скелетон");
    const at = (c: string) => container.querySelector(`[data-case="${c}"]`)!;
    expect(at("tile").querySelectorAll(".ws-skeleton-row > .ws-skeleton--tile")).toHaveLength(4);
    expect(at("circle").querySelectorAll(".ws-skeleton-row > .ws-skeleton--circle")).toHaveLength(4);
    expect(at("text").textContent).toContain("Ще завантажується…");
    expect(at("block").querySelector<HTMLElement>(".ws-skeleton--block")!.style.blockSize).toBe("128px");
    expect(at("field").querySelector(".ws-skeleton--field")).not.toBeNull();

    const swap = at("swap") as HTMLElement;
    expect(swap.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(swap.querySelectorAll(".ws-skeleton-row")).toHaveLength(3);
    act(() => within(swap).getByRole("button", { name: "Показати вміст" }).click());
    expect(swap.querySelector("[aria-busy]")).toBeNull();
    expect(swap.querySelectorAll("li")).toHaveLength(3);
    expect(within(swap).getByRole("heading", { name: "Транзакції" })).toBeTruthy();
    act(() => within(swap).getByRole("button", { name: "Показати скелетон" }).click());
    expect(swap.querySelectorAll(".ws-skeleton-row")).toHaveLength(3);
  });

  it("CMP-74@PoC gallery: the Progress section shows running, counting, stacked, done and error, and a live case that steps, fails and finishes", () => {
    const { container } = render(<App />);
    expect(container.querySelector("#g-progress")!.textContent).toBe("Прогрес");
    const at = (c: string) => container.querySelector<HTMLElement>(`[data-case="${c}"]`)!;
    expect(norm(at("queue").querySelector(".ws-progress-text")!.textContent)).toBe("31 з 103 · лишилось 72");
    expect(at("counting").textContent).toContain("Рахуємо…");
    expect(at("stacked").querySelector(".ws-progress-row--stacked")).not.toBeNull();
    expect(norm(at("stacked").textContent)).toContain("Розпізнаємо сторінку 4 з 12");

    const sync = at("sync");
    expect(norm(sync.querySelector('[data-row="done"] .ws-progress-text')!.textContent)).toBe(
      "✓ Готово · 1 214",
    );
    expect(norm(sync.querySelector('[data-row="running"] .ws-progress-text')!.textContent)).toBe(
      "500 з 1 200 · лишилось 700",
    );
    const error = sync.querySelector<HTMLElement>('[data-row="error"]')!;
    expect(norm(error.querySelector(".ws-progress-text")!.textContent)).toBe("✕ Помилка · 4 з 12");
    expect(within(error).getByRole("button", { name: "Спробувати ще раз" })).toBeTruthy();
    expect(within(sync).getAllByRole("progressbar")).toHaveLength(3);

    const live = at("live");
    const liveBar = within(live).getByRole("progressbar", { name: "Завантаження файлів" });
    expect(liveBar.getAttribute("aria-valuenow")).toBe("0");
    act(() => within(live).getByRole("button", { name: "Наступний крок" }).click());
    expect(liveBar.getAttribute("aria-valuenow")).toBe("1");
    act(() => within(live).getByRole("button", { name: "Зупинити помилкою" }).click());
    expect(norm(live.querySelector(".ws-progress-text")!.textContent)).toBe("✕ Помилка · 1 з 6");
    act(() => within(live).getByRole("button", { name: "Спробувати ще раз" }).click());
    for (let i = 0; i < 5; i++)
      act(() => within(live).getByRole("button", { name: "Наступний крок" }).click());
    expect(norm(live.querySelector(".ws-progress-text")!.textContent)).toBe("✓ Готово · 6");
    expect(norm(within(live).getByRole("status").textContent)).toBe("Готово, 6 файлів");
    act(() => within(live).getByRole("button", { name: "Почати знову" }).click());
    expect(liveBar.getAttribute("aria-valuenow")).toBe("0");
  });

  it("CMP-03@PoC gallery: the Select section shows the native list in every state, «з пошуком» and the list buttons", () => {
    const { container } = render(<App />);
    const section = container.querySelector("#g-select")!.closest("section")!;
    expect(container.querySelector("#g-select")!.textContent).toBe("Список вибору");
    const at = (c: string) => section.querySelector<HTMLElement>(`[data-case="${c}"]`)!;
    expect(within(at("default")).getByRole("combobox", { name: "Валюта" })).toBeTruthy();
    expect(at("long").querySelector("select")!.value).toBe("USD");
    expect(at("empty").querySelector(".ws-select-control--empty")).not.toBeNull();
    expect(within(at("error")).getByRole("alert").textContent).toContain("Помилка. Оберіть валюту рахунку.");
    expect((at("disabled").querySelector("select") as HTMLSelectElement).disabled).toBe(true);
    expect(at("disabled").textContent).toContain("Банк не змінюється після підключення рахунку.");
    expect(at("loading").querySelector(".ws-skeleton--field")).not.toBeNull();
    expect(within(at("categories")).getByRole("button", { name: /Категорія/ }).textContent).toContain(
      "Продукти",
    );
    expect(within(at("accounts")).getByRole("button", { name: /Рахунок/ }).textContent).toContain(
      "Поточний ··4417",
    );
    const buttons = within(at("list-buttons")).getAllByRole("button");
    expect(buttons.map((b) => norm(b.getAttribute("aria-label")))).toEqual([
      "Категорія: Усі",
      "Порівняти з: Середнє за 3 міс.",
      "Вигляд: Повний",
    ]);
  });

  it("CMP-01@PoC gallery: the Button section shows each variant at rest, with an icon, disabled with its reason and loading; sizes, icon-only, a row and a live case", () => {
    vi.useFakeTimers();
    const { container } = render(<App />);
    expect(container.querySelector("#g-button")!.textContent).toBe("Кнопка");
    const at = (c: string) => container.querySelector<HTMLElement>(`[data-case="${c}"]`)!;
    for (const [variant, name] of [
      ["primary", "Імпортувати виписку"],
      ["secondary", "Нова транзакція"],
      ["quiet", "Історія імпорту"],
      ["danger", "Видалити рахунок"],
    ] as const) {
      const buttons = within(at(`button-${variant}`)).getAllByRole("button", { name });
      expect(buttons, variant).toHaveLength(4);
      expect(buttons[1]!.querySelector(".ws-icon")).not.toBeNull();
      expect(buttons[2]!.getAttribute("aria-disabled")).toBe("true");
      expect(within(at(`button-${variant}`)).getByText("Заповніть назву цілі").id).toBe(
        buttons[2]!.getAttribute("aria-describedby"),
      );
      expect(buttons[3]!.getAttribute("aria-busy")).toBe("true");
    }
    expect(at("button-sizes").querySelectorAll(".ws-button-sm")).toHaveLength(3);
    expect(within(at("button-icon-only")).getByRole("button", { name: "Фільтр" }).textContent).toBe("");
    expect(at("button-row").querySelectorAll(".ws-button-primary")).toHaveLength(1);

    const live = at("button-live");
    const save = within(live).getByRole("button", { name: "Зберегти" });
    act(() => save.click());
    act(() => save.click());
    expect(live.querySelector("[data-saves]")!.textContent).toBe("Збережень: 1");
    expect(save.getAttribute("aria-busy")).toBe("true");
    act(() => vi.advanceTimersByTime(2000));
    expect(save.hasAttribute("aria-busy")).toBe(false);
    act(() => save.click());
    expect(live.querySelector("[data-saves]")!.textContent).toBe("Збережень: 2");
    vi.useRealTimers();
  });

  it("CMP-02@PoC gallery: the Field section shows empty, required with counter, error, disabled, read-only, search and the amount cases", () => {
    const { container } = render(<App />);
    expect(container.querySelector("#g-field")!.textContent).toBe("Поле введення");
    const at = (c: string) => container.querySelector<HTMLElement>(`[data-case="field-${c}"]`)!;
    const state = (c: string) => at(c).querySelector<HTMLElement>(".ws-field")!.dataset.state;

    const note = within(at("empty")).getByRole<HTMLInputElement>("textbox", { name: "Нотатка" });
    expect(note.placeholder).toBe("Наприклад, подарунок на день народження");
    expect(norm(at("empty").querySelector(".ws-field-hint")!.textContent)).toBe("До 200 символів");
    expect(
      within(at("required")).getByRole("textbox", { name: "Назва цілі, обов’язкове поле" }),
    ).toBeTruthy();
    expect(norm(at("required").querySelector(".ws-field-counter")!.textContent)).toBe("20 / 40");
    expect(state("error")).toBe("error");
    expect(norm(at("error").querySelector(".ws-field-error")!.textContent)).toBe(
      "Помилка. Введіть число, наприклад 12,5.",
    );
    expect(state("disabled")).toBe("disabled");
    expect(state("readonly")).toBe("readonly");
    expect(within(at("search")).getByRole("searchbox", { name: "Пошук транзакцій" })).toBeTruthy();

    const amount = within(at("amount")).getByRole<HTMLInputElement>("textbox", { name: "Сума" });
    expect(amount.inputMode).toBe("decimal");
    act(() => {
      amount.focus();
    });
    fireEvent.change(amount, { target: { value: "12,345" } });
    act(() => {
      amount.blur();
    });
    expect(norm(at("amount").querySelector(".ws-field-error")!.textContent)).toBe(
      "Помилка. Використовуйте до 2 знаків після коми для євро.",
    );
    expect(norm(within(at("approx")).getByRole<HTMLInputElement>("textbox").value)).toBe("≈ 0,33");
    expect(at("abbreviated").querySelector(".gallery-field__narrow")).not.toBeNull();
  });

  it("CMP-27@PoC gallery: the ListRow section shows an account, a debt with a real minus, a selected row, an archived record, a long name and the loading skeleton", () => {
    const { container } = render(<App />);
    expect(container.querySelector("#g-list-row")!.textContent).toBe("Рядок списку");
    const at = (c: string) => container.querySelector<HTMLElement>(`[data-case="${c}"]`)!;
    expect(norm(within(at("list-row-account")).getByRole("button").getAttribute("aria-label"))).toBe(
      "Поточний ··4417, monobank · EUR · оновлено 12 хв тому, Активне, 11 400,00 євро, зросло на 12,4 % за місяць",
    );
    expect(norm(at("list-row-debt").querySelector(".ws-amount")!.textContent)).toBe("−180 000,00 €");
    const box = within(at("list-row-selected")).getByRole<HTMLInputElement>("checkbox", {
      name: "Вибрати Кредитна ··9021",
    });
    expect(box.checked).toBe(true);
    act(() => box.click());
    expect(box.checked).toBe(false);
    expect(at("list-row-archived").querySelector(".ws-badge")!.getAttribute("data-tone")).toBe("neutral");
    expect(at("list-row-long").querySelector(".ws-row-title")!.textContent).toContain("Накопичувальний");
    expect(at("list-row-loading").querySelector('[aria-busy="true"]')).not.toBeNull();
    act(() => within(at("list-row-debt")).getByRole("button").click());
    expect(at("list-row-opened").textContent).toBe("Відкрито: debt");
  });

  it("CMP-28@PoC gallery: the TransactionRow section shows the states, a queue whose «Підтвердити» waits for the server, and the table columns", async () => {
    vi.useFakeTimers();
    const { container } = render(<App />);
    expect(container.querySelector("#g-transaction-row")!.textContent).toBe("Рядок транзакції");
    const at = (c: string) => container.querySelector<HTMLElement>(`[data-case="${c}"]`)!;
    const states = at("tx-states");
    expect(states.querySelectorAll(".ws-tx-row")).toHaveLength(6);
    expect(states.querySelector(".ws-tx-category-none")!.textContent).toBe("Без категорії");
    expect(within(states).getByRole("button", { name: "Об’єднати" })).toBeTruthy();

    const queue = at("tx-queue");
    expect(queue.querySelectorAll(".ws-tx-row-review")).toHaveLength(3);
    const confirm = within(queue).getAllByRole("button", { name: "Підтвердити" })[0]!;
    act(() => confirm.click());
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(queue.querySelectorAll(".ws-tx-row-review")).toHaveLength(3);
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(queue.querySelectorAll(".ws-tx-row-review")).toHaveLength(2);
    expect(
      [...queue.querySelectorAll('[role="status"]')].some(
        (s) => s.textContent === "Підтверджено. Лишилось 2",
      ),
    ).toBe(true);

    const head = at("tx-table").querySelector(".ws-tx-head")!;
    expect([...head.children].map((c) => c.textContent).filter(Boolean)).toEqual([
      "Контрагент",
      "Категорія",
      "Актив",
      "Рахунок",
      "Дата і час",
      "Сума",
    ]);
    expect(at("tx-loading").querySelector('[aria-busy="true"]')).not.toBeNull();
    vi.useRealTimers();
  });

  it("CMP-13@PoC gallery: the Pagination section shows the first, last, loading and empty cases and a live list that loads, focuses the first row and announces the range", () => {
    vi.useFakeTimers();
    sessionStorage.clear();
    const { container } = render(<App />);
    expect(container.querySelector("#g-pagination")!.textContent).toBe("Пагінація");
    const at = (c: string) => container.querySelector<HTMLElement>(`[data-case="${c}"]`)!;
    expect(norm(at("pagination-first").textContent)).toContain("1–25 з 1 240");
    expect(
      within(at("pagination-first"))
        .getByRole("button", { name: "Попередня сторінка" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(norm(at("pagination-last").textContent)).toContain("1 226–1 240 з 1 240");
    expect(
      within(at("pagination-last"))
        .getByRole("button", { name: "Наступна сторінка" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(norm(at("pagination-loading").textContent)).toContain("26–50 з 1 240");
    expect(at("pagination-empty").querySelector("nav")).toBeNull();

    const live = at("pagination-live");
    act(() => within(live).getByRole("button", { name: "Наступна сторінка" }).click());
    expect(norm(live.textContent)).toContain("1–25 з 1 240"); // the range waits for the data
    expect(live.querySelector('[role="status"]:not(.ws-visually-hidden)')).toBeNull();
    act(() => void vi.advanceTimersByTime(600));
    expect(norm(live.textContent)).toContain("26–50 з 1 240");
    expect(norm(within(live).getByRole("navigation").querySelector('[role="status"]')!.textContent)).toBe(
      "Показано 26–50 з 1 240",
    );
    expect(document.activeElement).toBe(live.querySelector("li"));
    expect(live.querySelector("li")!.textContent).toBe("Запис 26");
    vi.useRealTimers();
  });

  it("switches language to English", () => {
    render(<App />);
    act(() => controls().getByLabelText("English").click());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Design tokens");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Willowsum · Design tokens");
  });
});

describe("/gallery/tokens: CMP-21@PoC Dialog section", () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMedia({ width: 1280 });
    window.location.hash = "#/gallery/tokens";
  });

  it("CMP-21@PoC AC1: every case opens from its button with focus inside, never on a danger action, and closes back", () => {
    render(<App />);
    const section = document.getElementById("g-dialog")!.parentElement!;
    const openers = [...section.querySelectorAll<HTMLButtonElement>("button[data-case]")];
    expect(openers.map((b) => b.dataset.case)).toEqual([
      "delete",
      "unsaved",
      "options",
      "column",
      "error",
      "long",
      "split",
      "wide",
    ]);
    for (const opener of openers) {
      opener.focus();
      act(() => opener.click());
      const dialog = document.querySelector<HTMLDialogElement>("dialog.ws-dialog")!;
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect((document.activeElement as HTMLElement).dataset.variant).not.toBe("danger");
      act(() => {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(document.querySelector("dialog.ws-dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
  });

  it("CMP-21@PoC AC6: the synthetic delete runs, then fails with «Помилка» inside the open dialog", () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      act(() => document.querySelector<HTMLButtonElement>('button[data-case="error"]')!.click());
      act(() =>
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Видалити рахунок" }).click(),
      );
      expect(
        within(screen.getByRole("alertdialog"))
          .getByRole("button", { name: "Видаляємо…" })
          .getAttribute("aria-busy"),
      ).toBe("true");
      act(() => vi.advanceTimersByTime(1200));
      const alert = within(screen.getByRole("alertdialog")).getByRole("alert");
      expect(norm(alert.textContent)).toMatch(/^Помилка Не вдалося видалити рахунок/);
    } finally {
      vi.useRealTimers();
    }
  });
});

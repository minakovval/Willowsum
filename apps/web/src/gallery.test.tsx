import { act, render, screen, within } from "@testing-library/react";
import { colors, COLOR_TOKEN_NAMES, contrastRatio, formatRatio } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { App } from "./App.tsx";

/** No-break spaces (DS-08 item 11) compare as ordinary spaces. */
const norm = (s: string | null) => (s ?? "").replace(/&nbsp;|\u00A0|\u202F/g, " ");

describe("/gallery/tokens (DS-22)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    installMatchMedia({ width: 390 });
    window.location.hash = "#/gallery/tokens";
  });
  afterEach(() => vi.restoreAllMocks());

  it("is outside the app navigation, has one h1 and is closed to indexing", () => {
    render(<App />);
    expect(screen.queryByRole("navigation")).toBeNull();
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
    expect(norm(container.textContent)).not.toContain("✕ Помилка");
  });

  it("switches the page theme and hides amounts while keeping percentages", () => {
    const { container } = render(<App />);
    act(() => screen.getByLabelText("Темна").click());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    const amounts = container.querySelector("#g-amounts")!.parentElement!;
    expect(norm(amounts.textContent)).toContain("284 650,00 ₴");
    act(() => screen.getByRole("switch", { name: "Приховати суми" }).click());
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
    act(() => screen.getByLabelText("English").click());
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
      // The full value stays in the tooltip and for screen readers.
      const titles = [...box.querySelectorAll(".ws-amount-fit[title]")].map((el) =>
        norm(el.getAttribute("title")),
      );
      expect(titles).toContain("12 345 678 901,00 €");
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
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
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
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    act(() => filter.click());
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    act(() => screen.getByLabelText("English").click());
    expect(within(section).getByRole("button", { name: "Options" })).toBeTruthy();
  });

  it("switches language to English", () => {
    render(<App />);
    act(() => screen.getByLabelText("English").click());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Design tokens");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Willowsum · Design tokens");
  });
});

import { act, render, screen, within } from "@testing-library/react";
import { colors, COLOR_TOKEN_NAMES, contrastRatio, formatRatio } from "@willowsum/ui";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { App } from "./App.tsx";

/** No-break spaces (DS-08 item 11) compare as ordinary spaces. */
const norm = (s: string | null) => (s ?? "").replace(/\u00A0|\u202F/g, " ");

describe("/gallery/tokens (DS-22)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    installMatchMedia({ width: 390 });
    window.location.hash = "#/gallery/tokens";
  });

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
    expect(amounts.innerHTML).not.toContain("284 650");
    expect(norm(amounts.textContent)).toContain("•••");
    expect(norm(amounts.textContent)).toContain("+2,4 %");
    expect(within(amounts as HTMLElement).getAllByRole("button", { name: "Сума прихована" }).length).toBe(4);
  });

  it("switches language to English", () => {
    render(<App />);
    act(() => screen.getByLabelText("English").click());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Design tokens");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Willowsum · Design tokens");
  });
});

import { act, render, screen, within } from "@testing-library/react";
import { installMatchMedia, setViewport } from "@willowsum/ui/test-utils";
import { App } from "./App.tsx";

/** DS-10 acceptance 1, CMP-69, UX-09 item 5: the navigation form follows the window width. */
describe("app shell at three widths", () => {
  beforeEach(() => {
    window.location.hash = "#/";
    localStorage.clear();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  const nav = () => screen.getByRole("navigation", { name: "Основна навігація" });
  const labels = () =>
    within(nav())
      .getAllByRole("link")
      .map((a) => a.textContent);

  it("390 px: bottom bar with five Ukrainian items, Головна current", () => {
    installMatchMedia({ width: 390 });
    const { container } = render(<App />);
    expect(container.querySelector(".ws-shell")!.getAttribute("data-nav")).toBe("bottom");
    expect(nav().className).toContain("ws-nav-bottom");
    expect(labels()).toEqual(["Головна", "Гроші", "Активи", "Планування", "Ще"]);
    expect(within(nav()).getByRole("link", { name: "Головна" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("768 px: 64 px rail with the mark", () => {
    installMatchMedia({ width: 768 });
    const { container } = render(<App />);
    expect(container.querySelector(".ws-shell")!.getAttribute("data-nav")).toBe("rail");
    expect(nav().className).toContain("ws-nav-rail");
    expect(within(nav()).getByRole("img", { name: "Willowsum" })).toBeTruthy();
    expect(labels()).toHaveLength(5);
  });

  it("1280 px: 212 px sidebar with the wordmark", () => {
    installMatchMedia({ width: 1280 });
    const { container } = render(<App />);
    expect(container.querySelector(".ws-shell")!.getAttribute("data-nav")).toBe("sidebar");
    expect(nav().className).toContain("ws-nav-sidebar");
    expect(within(nav()).getByText("Willowsum")).toBeTruthy();
  });

  it("switches form live at 599 → 600 → 1279 → 1280 px without losing the page", () => {
    installMatchMedia({ width: 599 });
    const { container } = render(<App />);
    const shell = () => container.querySelector(".ws-shell")!.getAttribute("data-nav");
    expect(shell()).toBe("bottom");
    act(() => setViewport({ width: 600 }));
    expect(shell()).toBe("rail");
    act(() => setViewport({ width: 1279 }));
    expect(shell()).toBe("rail");
    act(() => setViewport({ width: 1280 }));
    expect(shell()).toBe("sidebar");
  });

  it("has skip links and a focusable main area", () => {
    installMatchMedia({ width: 390 });
    render(<App />);
    expect(screen.getByRole("link", { name: "Перейти до вмісту" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Перейти до навігації" })).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
    expect(document.title).toBe("Willowsum · Головна");
  });

  it("has no «Приховати суми» action in the PoC shell (UX-09@PoC), even when the gallery stored the mode", () => {
    localStorage.setItem("ws-hide-amounts", "1");
    installMatchMedia({ width: 1280 });
    render(<App />);
    expect(screen.queryByRole("button", { name: "Приховати суми" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Приховати суми" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Загальні дії" })).toBeNull();
  });

  it("marks the current section after navigation and moves focus to main", () => {
    installMatchMedia({ width: 1280 });
    render(<App />);
    act(() => {
      window.location.hash = "#/money";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(within(nav()).getByRole("link", { name: "Гроші" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Гроші");
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});

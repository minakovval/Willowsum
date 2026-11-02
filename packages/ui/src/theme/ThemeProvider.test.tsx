import { act, render, screen } from "@testing-library/react";
import { installMatchMedia, setViewport } from "../test-utils/matchMedia.ts";
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "./ThemeProvider.tsx";
import { ThemeSwitch } from "./ThemeSwitch.tsx";

function Probe() {
  const { theme, preference } = useTheme();
  return <output data-testid="theme">{`${preference}:${theme}`}</output>;
}

const ui = () =>
  render(
    <ThemeProvider>
      <ThemeSwitch />
      <Probe />
    </ThemeProvider>,
  );

describe("ThemeProvider (DS-11)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("follows the device by default with no data-theme attribute", () => {
    installMatchMedia({ dark: true });
    ui();
    expect(screen.getByTestId("theme").textContent).toBe("system:dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applies a system change at once in «Як у системі»", () => {
    installMatchMedia({ dark: false });
    ui();
    act(() => setViewport({ dark: true }));
    expect(screen.getByTestId("theme").textContent).toBe("system:dark");
  });

  it("keeps a manual «Світла» when the device turns dark, and stores the choice", () => {
    installMatchMedia({ dark: false });
    ui();
    act(() => screen.getByLabelText("Світла").click());
    act(() => setViewport({ dark: true }));
    expect(screen.getByTestId("theme").textContent).toBe("light:light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("restores «Темна» on the next visit", () => {
    installMatchMedia({ dark: false });
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    ui();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect((screen.getByLabelText("Темна") as HTMLInputElement).checked).toBe(true);
  });

  it("falls back to the system theme when storage is unavailable", () => {
    installMatchMedia({ dark: true });
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    ui();
    expect(screen.getByTestId("theme").textContent).toBe("system:dark");
    act(() => screen.getByLabelText("Темна").click());
    expect(screen.getByTestId("theme").textContent).toBe("dark:dark");
    spy.mockRestore();
    set.mockRestore();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { PageTabs } from "./PageTabs.tsx";

const TABS = [
  { id: "a", label: "Перша", href: "#/x/a" },
  { id: "b", label: "Друга", href: "#/x/b" },
  { id: "c", label: "Третя", href: "#/x/c" },
];

describe("PageTabs (CMP-11 «Вкладки сторінки» for sub-pages with their own address)", () => {
  beforeEach(() => {
    window.location.hash = "#/x/b";
  });

  it("is a named tablist of links; only the selected tab is in the Tab order and names the panel", () => {
    render(
      <PageTabs label="Розділи" tabs={TABS} selected="b" panelId="p">
        <p>Вміст</p>
      </PageTabs>,
    );
    expect(screen.getByRole("tablist", { name: "Розділи" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual(["#/x/a", "#/x/b", "#/x/c"]);
    const panel = screen.getByRole("tabpanel", { name: "Друга" });
    expect(panel.textContent).toBe("Вміст");
    expect(tabs[1]!.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("← → move to the neighbouring tab (wrapping) and open it; Home and End go to the first and the last", () => {
    render(
      <PageTabs label="Розділи" tabs={TABS} selected="b" panelId="p">
        <p>Вміст</p>
      </PageTabs>,
    );
    const second = screen.getByRole("tab", { name: "Друга" });
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(window.location.hash).toBe("#/x/c");
    expect(document.activeElement?.textContent).toBe("Третя");
    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(window.location.hash).toBe("#/x/a");
    fireEvent.keyDown(second, { key: "End" });
    expect(window.location.hash).toBe("#/x/c");
    fireEvent.keyDown(second, { key: "Home" });
    expect(window.location.hash).toBe("#/x/a");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Третя" }), { key: "ArrowRight" });
    expect(window.location.hash).toBe("#/x/a");
    fireEvent.keyDown(second, { key: "Enter" });
    expect(window.location.hash).toBe("#/x/a");
  });
});

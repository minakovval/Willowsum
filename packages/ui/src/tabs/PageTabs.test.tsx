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

describe("PageTabs in the shell (UX-09@PoC)", () => {
  const sets: Record<string, { id: string; label: string }[]> = {
    "Гроші → Транзакції": [
      { id: "tx", label: "Транзакції" },
      { id: "review", label: "До розбору · 3" },
      { id: "pairs", label: "Пари · 2" },
    ],
    "Планування → Борги": [
      { id: "debts", label: "Борги" },
      { id: "plan", label: "План погашення" },
      { id: "strategy", label: "Стратегія" },
      { id: "progress", label: "Прогрес" },
    ],
  };

  it("PageTabs: the «Транзакції» and «Борги» tab sets get one tablist of pill links with the same classes (only part of the navigation item on tabs: the «Бюджет» tabs do not exist yet, so it stays uncovered)", () => {
    const shapes = Object.entries(sets).map(([name, list]) => {
      const { container, unmount } = render(
        <PageTabs
          label={name}
          tabs={list.map((t) => ({ ...t, href: `#/${t.id}` }))}
          selected={list[0]!.id}
          panelId="p"
        >
          <p>Вміст</p>
        </PageTabs>,
      );
      const shape = {
        list: container.querySelector("[role=tablist]")!.className,
        tabs: Array.from(container.querySelectorAll("[role=tab]")).map((t) => t.tagName + "." + t.className),
        labels: Array.from(container.querySelectorAll("[role=tab]")).map((t) => t.textContent),
      };
      unmount();
      return shape;
    });
    expect(shapes.map((s) => s.labels)).toEqual(Object.values(sets).map((l) => l.map((t) => t.label)));
    for (const shape of shapes) {
      expect(shape.list).toBe(shapes[0]!.list);
      expect(new Set(shape.tabs.map((t) => t.replace(/^A\./, ""))).size).toBe(1);
      expect(shape.tabs[0]).toBe(shapes[0]!.tabs[0]);
    }
  });

  it("UX-09@PoC EC 1: a page with one sub-page has no tabs; its content is still shown", () => {
    render(
      <PageTabs label="Рахунки" tabs={[{ id: "a", label: "Рахунки", href: "#/a" }]} selected="a" panelId="p">
        <p>Вміст</p>
      </PageTabs>,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("Вміст")).toBeTruthy();
  });
});

import { render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { AppShell, type NavSection } from "./AppShell.tsx";

const sections: NavSection[] = [
  {
    id: "money",
    label: "Гроші",
    icon: "money",
    href: "#/money/transactions",
    pages: [
      {
        id: "transactions",
        label: "Транзакції",
        icon: "transactions",
        href: "#/money/transactions",
        badge: { count: 3, label: "3 до розбору" },
      },
      { id: "accounts", label: "Рахунки", icon: "accounts", href: "#/money/accounts" },
    ],
  },
  {
    id: "planning",
    label: "Планування",
    icon: "planning",
    href: "#/planning/budget",
    pages: [{ id: "budget", label: "Бюджет", icon: "budget", href: "#/planning/budget" }],
  },
];

function renderShell(props: { currentSectionId: string | null; currentPageId: string | null }) {
  localStorage.clear();
  return render(
    <I18nProvider>
      <AppShell
        sections={sections}
        {...props}
        brand={{ href: "#/planning/budget", label: "Willowsum, Бюджет" }}
        add={{ label: "Додати", items: [] }}
        profile={{ name: "Власник", space: "Мій простір", menuLabel: "Меню профілю", items: [] }}
      >
        <h1>Сторінка</h1>
      </AppShell>
    </I18nProvider>,
  );
}

describe("AppShell (CMP-69@PoC)", () => {
  it("CMP-69 AC1: on a page below L2 (L3) the L1 section is current", () => {
    renderShell({ currentSectionId: "money", currentPageId: null });
    const nav = screen.getByRole("navigation", { name: "Основна навігація" });
    expect(within(nav).getByRole("link", { name: "Гроші" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows L2 pages only for the current section", () => {
    renderShell({ currentSectionId: "planning", currentPageId: "budget" });
    const nav = screen.getByRole("navigation", { name: "Основна навігація" });
    expect(within(nav).queryByRole("link", { name: /Транзакції/ })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Бюджет" }).getAttribute("aria-current")).toBe("page");
  });

  it("CMP-69 AC4 / UX-09 AC7: the count badge «3» is read as part of the item name", () => {
    renderShell({ currentSectionId: "money", currentPageId: "accounts" });
    const item = screen.getByRole("link", { name: "Транзакції, 3 до розбору" });
    const badge = item.querySelector(".ws-nav-badge")!;
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
  });

  it("no badge when the count is zero (UX-09 item 2)", () => {
    const zero = structuredClone(sections);
    zero[0]!.pages[0]!.badge = { count: 0, label: "0 до розбору" };
    render(
      <I18nProvider>
        <AppShell
          sections={zero}
          currentSectionId="money"
          currentPageId="transactions"
          brand={{ href: "#/", label: "Willowsum, Бюджет" }}
          add={{ label: "Додати", items: [] }}
          profile={{ name: "Власник", space: "Мій простір", menuLabel: "Меню профілю", items: [] }}
        >
          <h1>Сторінка</h1>
        </AppShell>
      </I18nProvider>,
    );
    expect(screen.getByRole("link", { name: "Транзакції" }).querySelector(".ws-nav-badge")).toBeNull();
  });
});

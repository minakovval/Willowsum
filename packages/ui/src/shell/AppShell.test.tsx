import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { AppShell, FocusShell, NAV_COLLAPSED_STORAGE_KEY, type NavSection } from "./AppShell.tsx";

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

/** The sidebar as the app builds it: «+ Додати» with its items, the profile menu with «Налаштування». */
function renderApp(collapsed = false) {
  localStorage.clear();
  if (collapsed) localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, "1");
  return render(
    <I18nProvider>
      <AppShell
        sections={sections}
        currentSectionId="money"
        currentPageId="transactions"
        brand={{ href: "#/planning/budget", label: "Willowsum, Бюджет" }}
        add={{
          label: "Додати",
          items: [
            {
              id: "transaction",
              label: "Транзакція",
              icon: "transactions",
              href: "#/money/transactions/new",
            },
          ],
        }}
        profile={{
          name: "Олена Коваль",
          space: "Мій простір",
          menuLabel: "Меню профілю",
          items: [{ id: "settings", label: "Налаштування", icon: "settings", href: "#/settings" }],
        }}
      >
        <h1>Сторінка</h1>
      </AppShell>
    </I18nProvider>,
  );
}
const sidebar = () => screen.getByRole("navigation", { name: "Основна навігація" });

describe("UX-09@PoC navigation items of the shell", () => {
  it("UX-09@PoC FR 4: the navigation is one labelled sidebar with a collapse button — no bottom bar, no second navigation", () => {
    const { container } = renderApp();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(container.querySelector(".ws-shell")!.getAttribute("data-nav")).toBe("sidebar");
    expect(container.querySelector("[data-nav='bottom'], .ws-nav-bottom, .ws-nav-rail")).toBeNull();
    expect(within(sidebar()).getByRole("link", { name: "Гроші" }).textContent).toBe("Гроші");
    expect(within(sidebar()).getByRole("button", { name: "Згорнути навігацію" })).toBeTruthy();
  });

  it("UX-09@PoC FR 13: the first two stops are «Перейти до вмісту» and «Перейти до навігації»; they move focus to the main area and to the navigation; every item is a link or a button", () => {
    const { container } = renderApp();
    const skips = Array.from(container.querySelectorAll<HTMLAnchorElement>("a.ws-skip"));
    expect(skips.map((a) => a.textContent)).toEqual(["Перейти до вмісту", "Перейти до навігації"]);
    expect(container.querySelector(".ws-shell")!.firstElementChild).toBe(skips[0]);
    fireEvent.click(skips[0]!);
    expect(document.activeElement).toBe(screen.getByRole("main"));
    fireEvent.click(skips[1]!);
    expect(sidebar().contains(document.activeElement)).toBe(true);
    const items = sidebar().querySelectorAll(".ws-nav-item, .ws-nav-profile, .ws-nav-add");
    expect(items.length).toBeGreaterThan(4);
    for (const item of items) expect(["A", "BUTTON"]).toContain(item.tagName);
  });

  it("UX-09@PoC FR 15: every L2 page has its own 16 px icon, the L1 sections have 20 px ones", () => {
    renderApp();
    const l1 = sidebar().querySelectorAll(".ws-nav-section > .ws-nav-item svg");
    expect(Array.from(l1).map((svg) => svg.getAttribute("width"))).toEqual(["20", "20"]);
    const l2 = Array.from(sidebar().querySelectorAll(".ws-nav-page > a svg"));
    expect(l2).toHaveLength(2);
    for (const svg of l2) expect(svg.getAttribute("width")).toBe("16");
    expect(new Set(l2.map((svg) => svg.innerHTML)).size).toBe(2);
  });

  it("UX-09@PoC FR 16: the collapse button beside the mark makes an icon-only rail; the choice is kept; a collapsed item is named by its label (tooltip)", () => {
    const { container, unmount } = renderApp();
    const brand = sidebar().querySelector(".ws-nav-brand")!;
    const collapse = within(brand as HTMLElement).getByRole("button", { name: "Згорнути навігацію" });
    expect(brand.querySelector(".ws-nav-brand-link")).toBeTruthy();
    fireEvent.click(collapse);
    expect(container.querySelector(".ws-shell")!.getAttribute("data-collapsed")).toBe("true");
    expect(localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY)).toBe("1");
    expect(sidebar().querySelector(".ws-wordmark-name")).toBeNull();
    // No separate expand icon in the rail: only the «›» handle on the edge expands it.
    expect(within(sidebar()).queryByRole("button", { name: "Згорнути навігацію" })).toBeNull();
    expect(within(sidebar()).getAllByRole("button", { name: "Розгорнути навігацію" })).toHaveLength(1);
    // The label of an item stays in the DOM as its name and shows as a tooltip on hover (CSS).
    expect(within(sidebar()).getByRole("link", { name: "Гроші" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Додати" }).getAttribute("title")).toBe("Додати");
    unmount();
    const again = renderApp(true);
    expect(again.container.querySelector(".ws-shell")!.getAttribute("data-collapsed")).toBe("true");
  });

  it("UX-09@PoC FR 17: «+ Додати» is the primary button under the mark; the profile at the bottom opens its menu upwards; collapsed — an icon button and only the avatar", () => {
    const { unmount } = renderApp();
    const top = sidebar().querySelector(".ws-nav-top")!;
    const add = within(top as HTMLElement).getByRole("button", { name: "Додати" });
    expect(add.className).toContain("ws-button-primary");
    expect(top.querySelector(".ws-nav-brand")!.nextElementSibling).toBe(add.closest(".ws-menu-root") ?? add);
    const bottom = sidebar().querySelector(".ws-nav-bottom-area")!;
    const profile = within(bottom as HTMLElement).getByRole("button", { name: /Меню профілю/ });
    expect(profile.textContent).toContain("ОК");
    expect(profile.textContent).toContain("Олена Коваль");
    expect(profile.textContent).toContain("Мій простір");
    // At the bottom of the window (as the profile is) the menu opens upwards.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: window.innerHeight - 56,
      bottom: window.innerHeight - 12,
      height: 0,
    } as DOMRect);
    fireEvent.click(profile);
    expect(document.querySelector(".ws-menu.ws-menu-up")).toBeTruthy();
    vi.restoreAllMocks();
    expect(sidebar().querySelector("input[type='search'], [role='search']")).toBeNull();
    unmount();

    renderApp(true);
    expect(screen.getByRole("button", { name: "Додати" }).className).toContain("ws-icon-button");
    const rail = screen.getByRole("button", { name: "Меню профілю" });
    expect(rail.textContent).toBe("ОК");
  });

  it("UX-09@PoC FR 18: the profile menu has «Налаштування» with an icon that leads to the settings page", () => {
    renderApp();
    fireEvent.click(within(sidebar()).getByRole("button", { name: /Меню профілю/ }));
    const item = within(screen.getByRole("menu", { name: "Меню профілю" })).getByRole("menuitem", {
      name: "Налаштування",
    });
    expect(item.querySelector("svg")).toBeTruthy();
    expect(item.getAttribute("href")).toBe("#/settings");
  });
});

describe("UX-09@PoC focus mode", () => {
  const renderFocus = (unsaved?: { onSave: () => void }) => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <FocusShell title="Імпорт виписки" closeLabel="Закрити" onClose={onClose} unsaved={unsaved}>
          <p>Форма</p>
        </FocusShell>
      </I18nProvider>,
    );
    return onClose;
  };

  it("UX-09@PoC AC 6: with unsaved data «×» asks «Зберегти зміни?» inside the page with «Редагувати далі», «Не зберігати», «Зберегти»; nothing closes until a choice", () => {
    const onSave = vi.fn();
    const onClose = renderFocus({ onSave });
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    expect(onClose).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "Зберегти зміни?" });
    const labels = within(dialog)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((l) => l !== "");
    expect(labels).toEqual(expect.arrayContaining(["Редагувати далі", "Не зберігати", "Зберегти"]));

    fireEvent.click(within(dialog).getByRole("button", { name: "Редагувати далі" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Не зберігати" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    act(() => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Зберегти" }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("UX-09@PoC FR 10: without unsaved data «×» leaves at once, without a dialog", () => {
    const onClose = renderFocus();
    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { App } from "./App.tsx";
import { CHILDREN, resolveRoute, SECTIONS } from "./routing/routes.ts";
import { resetNavigationSession } from "./routing/session.ts";

/**
 * UX-09@PoC, CMP-69@PoC, CMP-71@PoC, GRID-00@PoC: the PoC shell — a 212 px sidebar with the L1
 * sections «Гроші» and «Планування», their L2 pages, «+ Додати», the profile menu and the
 * keyboard shortcuts.
 */
const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

const nav = () => screen.getByRole("navigation", { name: "Основна навігація" });
const navLink = (name: string) => within(nav()).getByRole("link", { name });
const sectionLabels = () =>
  Array.from(nav().querySelectorAll(".ws-nav-section > .ws-nav-item")).map(
    (a) => a.querySelector(".ws-nav-label")?.textContent,
  );
const pageLabels = () =>
  Array.from(nav().querySelectorAll(".ws-nav-page .ws-nav-label")).map((el) => el.textContent);
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;

/** Clicks a hash link the way a browser does (jsdom does not follow `#…` hrefs on its own). */
const follow = (link: HTMLElement) => {
  act(() => {
    fireEvent.click(link);
  });
  const href = link.getAttribute("href");
  if (href?.startsWith("#/")) go(href);
};

const key = (code: string, target: Element = document.body) =>
  act(() => {
    fireEvent.keyDown(target, { code, key: code.replace(/^Key/, "").toLowerCase() });
  });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  window.location.hash = "#/";
  localStorage.clear();
  sessionStorage.clear();
  resetNavigationSession();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("UX-09@PoC navigation", () => {
  it("UX-09 AC1: after sign-in the app opens «Планування › Бюджет»; the sidebar has only «Гроші» and «Планування»", () => {
    render(<App />);
    expect(window.location.hash).toBe("#/planning/budget");
    expect(h1()).toBe("Бюджет");
    expect(document.title).toBe("Willowsum · Бюджет");
    expect(sectionLabels()).toEqual(["Гроші", "Планування"]);
    for (const absent of ["Головна", "Активи", "Ще"]) {
      expect(within(nav()).queryByRole("link", { name: absent })).toBeNull();
    }
    expect(navLink("Планування").getAttribute("aria-current")).toBe("page");
    expect(navLink("Бюджет").getAttribute("aria-current")).toBe("page");
  });

  it("UX-09 item 2: «Планування» has «Бюджет», «Цілі», «Регулярні платежі», «Борги» (always visible); no «Чи можу я дозволити» (PoC v2)", () => {
    render(<App />);
    expect(pageLabels()).toEqual(["Бюджет", "Цілі", "Регулярні платежі", "Борги"]);
    expect(within(nav()).queryByRole("link", { name: /Чи можу я дозволити/ })).toBeNull();
    follow(navLink("Борги"));
    expect(h1()).toBe("Борги");
    expect(screen.getByText("Тут поки нічого немає")).toBeTruthy();
  });

  it("UX-09 AC7 (structure): «Гроші» shows only «Транзакції» and «Рахунки»; no «До розбору», «Пари», «Підключення» items", () => {
    window.location.hash = "#/money/transactions";
    render(<App />);
    expect(pageLabels()).toEqual(["Транзакції", "Рахунки"]);
    for (const absent of ["До розбору", "Пари", "Підключення"]) {
      expect(within(nav()).queryByRole("link", { name: new RegExp(`^${absent}`) })).toBeNull();
    }
  });

  it("UX-09 item 2 (PoC v2 routes): «Чи можу я дозволити» and the bank connection pages are not registered", () => {
    for (const path of [
      "/planning/afford",
      "/money/connections",
      "/money/connections/new",
      "/money/connections/1/source",
      "/money/accounts/connections",
      "/money/accounts/connect",
      "/money/accounts/reconnect",
      "/money/accounts/monobank-token",
    ]) {
      expect(resolveRoute(path).kind, path).toBe("notFound");
    }
    const paths = [
      ...SECTIONS.flatMap((s) => [s.path, ...s.pages.map((p) => p.path)]),
      ...CHILDREN.map((c) => c.path),
    ];
    expect(paths.filter((p) => /afford|connect|bank|mono|token/.test(p))).toEqual([]);
    expect(SECTIONS.flatMap((s) => s.pages.map((p) => p.id))).toEqual([
      "transactions",
      "accounts",
      "budget",
      "goals",
      "recurring",
      "debts",
    ]);
  });

  it("UX-09 items 2, 18: «Рахунки» and «Налаштування» offer no bank connection entry points", () => {
    for (const hash of ["#/money/accounts", "#/settings"]) {
      window.location.hash = hash;
      const { unmount } = render(<App />);
      for (const absent of [
        /Підключення/,
        /Підключити/,
        /Перепідключити/,
        /monobank/i,
        /токен/i,
        /Джерела даних/,
      ]) {
        expect(screen.queryByText(absent), `${hash} ${absent}`).toBeNull();
        expect(screen.queryByRole("link", { name: absent }), `${hash} ${absent}`).toBeNull();
        expect(screen.queryByRole("tab", { name: absent }), `${hash} ${absent}`).toBeNull();
      }
      unmount();
    }
  });

  it("UX-09 AC2 / CMP-69 AC3: an L1 section reopens its last L2 page; the active section returns to its root and scrolls up", () => {
    window.location.hash = "#/money/accounts";
    render(<App />);
    expect(h1()).toBe("Рахунки");

    follow(navLink("Планування"));
    expect(window.location.hash).toBe("#/planning/budget");

    follow(navLink("Гроші"));
    expect(window.location.hash).toBe("#/money/accounts");
    expect(h1()).toBe("Рахунки");

    vi.mocked(window.scrollTo).mockClear();
    follow(navLink("Гроші"));
    expect(window.location.hash).toBe("#/money/transactions");
    expect(h1()).toBe("Транзакції");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

    // Pressing the active section while already on its root still scrolls to the top.
    vi.mocked(window.scrollTo).mockClear();
    follow(navLink("Гроші"));
    expect(window.location.hash).toBe("#/money/transactions");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("UX-09 item 7 / CMP-69 AC1: the deepest ancestor is current at L1 and L2 on a page below L2", () => {
    window.location.hash = "#/money/transactions/import";
    render(<App />);
    expect(h1()).toBe("Імпорт");
    expect(navLink("Гроші").getAttribute("aria-current")).toBe("page");
    expect(navLink("Транзакції").getAttribute("aria-current")).toBe("page");
    expect(navLink("Рахунки").getAttribute("aria-current")).toBeNull();
    // UX-09 item 8: breadcrumbs from the page hierarchy.
    const crumbs = screen.getByRole("navigation", { name: "Хлібні крихти" });
    expect(
      within(crumbs)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Гроші", "Транзакції", "Імпорт"]);
  });

  it("UX-09 AC13 / CMP-69 AC7: «+ Додати» full width under the mark, profile with avatar, name and space at the bottom; no search, bell or «Приховати суми»", () => {
    render(<App />);
    const sidebar = nav();
    const add = within(sidebar).getByRole("button", { name: "Додати" });
    expect(add.className).toContain("ws-button-primary");
    expect(add.closest(".ws-nav-top")).toBeTruthy();
    const profile = within(sidebar).getByRole("button", { name: /Меню профілю/ });
    expect(profile.closest(".ws-nav-bottom-area")).toBeTruthy();
    expect(profile.textContent).toContain("Власник");
    expect(profile.textContent).toContain("Мій простір");
    expect(profile.querySelector(".ws-avatar")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Пошук|Сповіщення|Приховати суми/ })).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(document.querySelector(".ws-nav-bottom, .ws-nav-rail")).toBeNull();
  });

  it("UX-09 AC10: «+ Додати» has only «Транзакція», «Рахунок», «Ціль» with icons; «T» opens the transaction form, «A» opens nothing", () => {
    render(<App />);
    act(() => screen.getByRole("button", { name: "Додати" }).click());
    const menu = screen.getByRole("menu", { name: "Додати" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.querySelector(".ws-menu-label")?.textContent)).toEqual([
      "Транзакція",
      "Рахунок",
      "Ціль",
    ]);
    for (const item of items) expect(item.querySelector("svg")).toBeTruthy();
    expect(items[0]!.getAttribute("aria-keyshortcuts")).toBe("T");
    expect(items[0]!.textContent).toContain("T");

    key("KeyA", items[0]!);
    expect(window.location.hash).toBe("#/planning/budget");
    expect(screen.getByRole("menu", { name: "Додати" })).toBeTruthy();

    key("KeyT", items[0]!);
    go(window.location.hash);
    expect(window.location.hash).toBe("#/money/transactions/new");
    expect(h1()).toBe("Нова транзакція");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("UX-09 AC8: «+ Додати → Транзакція» opens the quick-add form with «Імпортувати виписку», which opens the import wizard in focus mode", () => {
    render(<App />);
    act(() => screen.getByRole("button", { name: "Додати" }).click());
    follow(screen.getByRole("menuitem", { name: "Транзакція" }));
    expect(h1()).toBe("Нова транзакція");
    follow(screen.getByRole("link", { name: "Імпортувати виписку" }));
    expect(window.location.hash).toBe("#/import");
    expect(h1()).toBe("Імпорт виписки");
    expect(screen.queryByRole("navigation", { name: "Основна навігація" })).toBeNull();
  });

  it("UX-09 AC9 / AC5: «Імпортувати виписку» on «Транзакції» opens the same wizard; «×» goes back by history; focus mode has no navigation", () => {
    window.location.hash = "#/money/transactions";
    render(<App />);
    follow(screen.getByRole("link", { name: "Імпортувати виписку" }));
    expect(window.location.hash).toBe("#/import");
    expect(screen.queryByRole("navigation", { name: "Основна навігація" })).toBeNull();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => go("#/money/transactions"));
    act(() => screen.getByRole("button", { name: "Закрити" }).click());
    expect(back).toHaveBeenCalledTimes(1);
    expect(h1()).toBe("Транзакції");
  });

  it("UX-09 item 10: «×» on a directly opened wizard (no earlier page) goes to «Гроші › Транзакції»", () => {
    window.location.hash = "#/import";
    render(<App />);
    const back = vi.spyOn(window.history, "back");
    act(() => screen.getByRole("button", { name: "Закрити" }).click());
    go(window.location.hash);
    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/money/transactions");
  });

  it("UX-09 item 14: «Історія імпорту» beside «Імпортувати виписку» opens the «Імпорт» page", () => {
    window.location.hash = "#/money/transactions";
    render(<App />);
    follow(screen.getByRole("link", { name: "Історія імпорту" }));
    expect(h1()).toBe("Імпорт");
  });

  it("UX-09 AC11 / CMP-69 AC5: the collapse button beside the mark makes a 64 px icon rail that survives a reload", () => {
    installMatchMedia({ width: 1440 });
    const { container, unmount } = render(<App />);
    const shell = () => container.querySelector(".ws-shell")!;
    expect(shell().getAttribute("data-collapsed")).toBe("false");
    const collapse = within(nav()).getByRole("button", { name: "Згорнути навігацію" });
    expect(collapse.closest(".ws-nav-brand")).toBeTruthy();
    act(() => collapse.click());
    expect(shell().getAttribute("data-collapsed")).toBe("true");
    unmount();

    const again = render(<App />);
    expect(again.container.querySelector(".ws-shell")!.getAttribute("data-collapsed")).toBe("true");
    // Names stay as accessible names and show as tooltips; only the avatar remains at the bottom.
    expect(navLink("Гроші")).toBeTruthy();
    expect(within(nav()).getByRole("button", { name: "Додати" }).textContent).not.toContain("Додати");
    expect(within(nav()).getByRole("button", { name: /Меню профілю/ }).textContent).not.toContain(
      "Мій простір",
    );
    expect(within(nav()).queryByRole("button", { name: "Згорнути навігацію" })).toBeNull();
  });

  it("UX-09 AC12 / CMP-69 AC6: a collapsed sidebar has only the «›» handle on its edge, which expands it", () => {
    localStorage.setItem("ws-nav-collapsed", "1");
    const { container } = render(<App />);
    const handle = screen.getByRole("button", { name: "Розгорнути навігацію" });
    expect(handle.textContent).toBe("›");
    expect(handle.closest(".ws-nav-edge")).toBeTruthy();
    act(() => handle.click());
    expect(container.querySelector(".ws-shell")!.getAttribute("data-collapsed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Розгорнути навігацію" })).toBeNull();
    expect(localStorage.getItem("ws-nav-collapsed")).toBeNull();
  });

  it("UX-09 AC14 / CMP-69 AC7: L1 icons are 20 px; every L2 page has its own 16 px icon", () => {
    window.location.hash = "#/money/transactions";
    render(<App />);
    for (const a of nav().querySelectorAll(".ws-nav-section > .ws-nav-item")) {
      expect(a.querySelector("svg")!.getAttribute("width")).toBe("20");
    }
    const pageIcons = Array.from(nav().querySelectorAll(".ws-nav-page svg"));
    expect(pageIcons).toHaveLength(2);
    for (const svg of pageIcons) expect(svg.getAttribute("width")).toBe("16");
    const glyphs = pageIcons.map((svg) => svg.innerHTML);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("UX-09 AC15: an unknown address shows «Сторінку не знайдено» with «На Бюджет» to «Планування › Бюджет»", () => {
    window.location.hash = "#/assets";
    render(<App />);
    expect(h1()).toBe("Сторінку не знайдено");
    const toBudget = screen.getByRole("link", { name: "На Бюджет" });
    follow(toBudget);
    expect(h1()).toBe("Бюджет");
  });

  it("UX-09 AC16: «Налаштування» opens from the profile menu; there is no «Ще» section", () => {
    render(<App />);
    act(() =>
      within(nav())
        .getByRole("button", { name: /Меню профілю/ })
        .click(),
    );
    const menu = screen.getByRole("menu", { name: "Меню профілю" });
    const settings = within(menu).getByRole("menuitem", { name: "Налаштування" });
    expect(settings.querySelector("svg")).toBeTruthy();
    follow(settings);
    expect(h1()).toBe("Налаштування");
    expect(within(nav()).queryByRole("link", { name: "Ще" })).toBeNull();
  });

  it("UX-09 item 1: the old sections are gone: /money and /planning open their roots, / opens Бюджет", () => {
    window.location.hash = "#/money";
    render(<App />);
    expect(window.location.hash).toBe("#/money/transactions");
    go("#/planning");
    expect(window.location.hash).toBe("#/planning/budget");
    go("#/");
    expect(window.location.hash).toBe("#/planning/budget");
  });
});

describe("CMP-69@PoC keyboard shortcuts", () => {
  it.each([
    ["KeyT", "Транзакції"],
    ["KeyB", "Бюджет"],
    ["KeyG", "Цілі"],
    ["KeyA", "Рахунки"],
  ])("G, then %s opens «%s» (CMP-69 AC2)", (code, title) => {
    window.location.hash = "#/settings";
    render(<App />);
    key("KeyG");
    key(code);
    go(window.location.hash);
    expect(h1()).toBe(title);
  });

  it("does not act while the focus is in an input field", () => {
    window.location.hash = "#/settings";
    render(<App />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    key("KeyG", input);
    key("KeyB", input);
    expect(h1()).toBe("Налаштування");
    input.remove();
  });
});

describe("CMP-71@PoC brand mark link", () => {
  it("CMP-71 AC3 / item «Стани»: the mark with the name links to «Планування → Бюджет» as «Willowsum, Бюджет»", () => {
    window.location.hash = "#/money/accounts";
    render(<App />);
    const brand = within(nav()).getByRole("link", { name: "Willowsum, Бюджет" });
    expect(brand.getAttribute("href")).toBe("#/planning/budget");
    expect(brand.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(brand.querySelector("svg")!.getAttribute("width")).toBe("24");
    expect(brand.textContent).toBe("Willowsum");
  });
});

describe("UX-09@PoC no «Приховати суми»", () => {
  it("has no «Приховати суми» action in the PoC shell (UX-09@PoC), even when the gallery stored the mode", () => {
    localStorage.setItem("ws-hide-amounts", "1");
    render(<App />);
    expect(screen.queryByRole("button", { name: "Приховати суми" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Приховати суми" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Загальні дії" })).toBeNull();
  });
});

describe("GRID-00@PoC shell", () => {
  it("GRID-00 AC2: at 1280 px the navigation is the 212 px sidebar", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".ws-shell")!.getAttribute("data-nav")).toBe("sidebar");
    expect(nav().className).toContain("ws-nav-sidebar");
  });

  it("GRID-00 AC8: the first focusable element is «Перейти до вмісту»; after navigation the focus moves to main", () => {
    render(<App />);
    const focusables = document.querySelectorAll<HTMLElement>("a[href], button");
    expect(focusables[0]!.textContent).toBe("Перейти до вмісту");
    expect(screen.getByRole("link", { name: "Перейти до навігації" })).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
    follow(navLink("Цілі"));
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

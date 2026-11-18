import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { resetAuthState } from "../auth/testing.tsx";
import { rememberPage, resetNavigationSession } from "../routing/session.ts";
import { resolveRoute } from "../routing/routes.ts";
import { AppLayout } from "./AppLayout.tsx";

/** UX-09@PoC: the sections and pages the user layout builds (FR 6, FR 12). */
const layout = (sectionId: "money" | "planning", pageId: string) =>
  render(
    <I18nProvider>
      <AppLayout sectionId={sectionId} pageId={pageId}>
        <h1>Сторінка</h1>
      </AppLayout>
    </I18nProvider>,
  );
const nav = () => screen.getByRole("navigation", { name: "Основна навігація" });

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  resetNavigationSession();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("UX-09@PoC section navigation", () => {
  it("UX-09@PoC FR 6: the first press of a section opens the last L2 page opened in it, else its root; the active section returns to its root and scrolls up", () => {
    const first = layout("planning", "budget");
    // Nothing opened in «Гроші» yet: its root.
    expect(within(nav()).getByRole("link", { name: "Гроші" }).getAttribute("href")).toBe(
      "#/money/transactions",
    );
    rememberPage("money", "/money/accounts");
    first.unmount();
    const second = layout("planning", "budget");
    const money = within(nav()).getByRole("link", { name: "Гроші" });
    expect(money.getAttribute("href")).toBe("#/money/accounts");

    // The active section: the root, and a press on the root scrolls up.
    second.unmount();
    window.location.hash = "#/planning/budget";
    layout("planning", "budget");
    const planning = within(nav()).getByRole("link", { name: "Планування" });
    expect(planning.getAttribute("href")).toBe("#/planning/budget");
    fireEvent.click(planning);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("UX-09@PoC FR 12: no admin panel shell — the layout has no admin entry and no admin route exists", () => {
    layout("planning", "budget");
    expect(within(nav()).queryByRole("link", { name: /адмін|admin/i })).toBeNull();
    for (const path of ["/admin", "/admin/users", "/admin/dashboard"])
      expect(resolveRoute(path).kind).toBe("notFound");
  });
});

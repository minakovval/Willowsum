import { render, screen } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { App } from "../App.tsx";
import { NO_ACCESS_PATH, resolveRoute } from "../routing/routes.ts";

/** S-029 «Немає доступу» (DAT-05@PoC FR 6, П-7, AC5; canvas NoAccess). */
describe("S-029 «Немає доступу»", () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMedia({ width: 1280 });
    window.location.hash = `#${NO_ACCESS_PATH}`;
  });

  it("DAT-05@PoC FR 6: the route shows one h1, the board's text and «На Головну» to the start page", async () => {
    render(<App />);
    expect(resolveRoute(NO_ACCESS_PATH).kind).toBe("noAccess");
    expect((await screen.findAllByRole("heading", { level: 1 })).map((h) => h.textContent)).toEqual([
      "Немає доступу",
    ]);
    expect(
      screen.getByText(
        "Цей розділ для вас закритий у налаштуваннях простору. Якщо він потрібен, зверніться до власника простору.",
      ),
    ).toBeTruthy();
    const home = screen.getByRole("link", { name: "На Головну" });
    expect(home.getAttribute("href")).toMatch(/^#\//);
    expect(document.title).toContain("Немає доступу");
  });

  it("DAT-05@PoC AC5: a record outside the user's reach is «не знайдено», not «Немає доступу» (only modules and widgets are)", async () => {
    window.location.hash = "#/money/transactions/00000000-0000-0000-0000-000000000000x";
    render(<App />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Сторінку не знайдено");
    expect(screen.queryByText("Немає доступу")).toBeNull();
  });
});

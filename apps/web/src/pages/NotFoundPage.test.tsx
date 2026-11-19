import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, resetAuthState } from "../auth/testing.tsx";
import { resolveRoute, START_PATH } from "../routing/routes.ts";
import { TransactionDetailPage } from "../transactions/TransactionDetailPage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/** UX-09@PoC «Сторінку не знайдено» (FR 19, AC 15, EC 2) and the start page (FR 5). */
const wrap = (node: React.ReactNode, client = fakeApi({}).client) =>
  render(
    <I18nProvider>
      <AuthApiProvider value={client}>{node}</AuthApiProvider>
    </I18nProvider>,
  );

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  window.location.hash = "#/money/accounts/nothing";
});

describe("UX-09@PoC «Сторінку не знайдено»", () => {
  it("UX-09@PoC FR 19: a short explanation without a record name or count and «На Бюджет» to «Планування → Бюджет»", () => {
    wrap(<NotFoundPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Сторінку не знайдено");
    const body = screen.getByText("Можливо, адресу введено з помилкою.");
    expect(body.textContent).not.toMatch(/\d/);
    const home = screen.getByRole("link", { name: "На Бюджет" });
    expect(home.getAttribute("href")).toBe("#/planning/budget");
    expect(home.className).toContain("ws-button-primary");
    // Inside the shell: the sidebar is there and no section is current.
    expect(document.querySelector('.ws-nav-item[aria-current="page"]')).toBeNull();
  });

  it("UX-09@PoC FR 5: the start page and the target of «На Бюджет» is «Планування → Бюджет»", () => {
    expect(START_PATH).toBe("/planning/budget");
    expect(resolveRoute(START_PATH).kind).toBe("page");
    wrap(<NotFoundPage />);
    expect(screen.getByRole("link", { name: "На Бюджет" }).getAttribute("href")).toBe(`#${START_PATH}`);
    expect(screen.getByRole("link", { name: /^Willowsum/ }).getAttribute("href")).toBe(`#${START_PATH}`);
  });

  it("UX-09@PoC EC 2: a direct link to a record that does not exist shows «Сторінку не знайдено»", async () => {
    const id = "00000000-0000-4000-8000-0000000000ff";
    window.location.hash = `#/money/transactions/${id}`;
    const { client } = fakeApi({
      [`GET /v1/transactions/${id}`]: { status: 404, body: { code: "not_found" } },
    });
    wrap(<TransactionDetailPage />, client);
    expect((await screen.findByRole("heading", { level: 1, name: "Сторінку не знайдено" })).textContent).toBe(
      "Сторінку не знайдено",
    );
    expect(screen.getByRole("link", { name: "На Бюджет" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(id);
  });

  it("UX-09@PoC EC 2: a bare unknown address resolves to the not-found route, and so does a malformed record id", () => {
    expect(resolveRoute("/money/transactions/not-an-id").kind).toBe("notFound");
    expect(resolveRoute("/assets").kind).toBe("notFound");
  });
});

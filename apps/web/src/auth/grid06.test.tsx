import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, screen } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, plain, problem, renderAt, resetAuthState, TOKEN } from "./testing.tsx";

/**
 * GRID-06@PoC: the page grid of the sign-in, recovery and «Це був не я» screens. The measured layout at 1280 px
 * (AC2) is in e2e/layout.spec.ts; here the structure, focus mode and the CSS rules that make it.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app.css"), "utf8").replace(
  /\s+/g,
  " ",
);
const FOCUS_SCREENS = [
  "#/login",
  "#/signup",
  "#/password/reset",
  `#/password/reset?token=${TOKEN}`,
  "#/not-me",
];

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("GRID-06@PoC sign-in and onboarding page grids", () => {
  it("GRID-06@PoC FR 1: on Expanded the mark and the card take the 6 middle columns of the 12-column grid", () => {
    expect(css).toContain(
      ".auth-page { display: grid; grid-template-columns: repeat(var(--ws-columns), minmax(0, 1fr)); column-gap: var(--ws-gutter);",
    );
    // Margins and the 1200 px content limit come from the tokens (GRID-00 FR 2, 5), not from the page.
    expect(css).toMatch(
      /\.auth-page \{[^}]*max\(var\(--ws-page-margin\), \(100% - var\(--ws-content-max\)\) \/ 2\)/,
    );
    expect(css).toContain("@media (min-width: 1024px) { .auth-column { grid-column: 4 / span 6; } }");
    expect(css).toMatch(/\.auth-card \{[^}]*width: 100%;/);
  });

  it("GRID-06@PoC FR 1, FR 2: sign-in, recovery and «Це був не я» share one frame — the mark and the card in one column", () => {
    for (const hash of FOCUS_SCREENS) {
      const view = renderAt(hash, fakeApi({}).client);
      const card = screen.getByRole("main");
      expect(card.className, hash).toBe("auth-card");
      expect(card.parentElement!.className, hash).toBe("auth-column");
      expect(card.parentElement!.querySelector(".auth-brand"), hash).not.toBeNull();
      expect(card.parentElement!.parentElement!.className, hash).toBe("auth-page");
      view.unmount();
    }
  });

  it("GRID-06@PoC FR 5, AC1: focus mode — no sidebar, rail or bottom bar on these screens", () => {
    for (const hash of FOCUS_SCREENS) {
      const view = renderAt(hash, fakeApi({}).client);
      expect(screen.queryByRole("navigation"), hash).toBeNull();
      expect(document.querySelector(".ws-nav-sidebar, .ws-nav-rail, .ws-nav-bottom"), hash).toBeNull();
      view.unmount();
    }
  });

  it("GRID-06@PoC AC3: after 5 failures the sign-in is locked for 15 min and then the CAPTCHA is in the card", async () => {
    const { client } = fakeApi({
      "POST /v1/sessions": problem(429, "SIGN_IN_LOCKED", { "retry-after": "900" }),
    });
    renderAt("#/login", client);
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), {
      target: { value: "olena@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
      target: { value: "wrong one" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
    expect(plain((await screen.findByRole("alert")).textContent)).toContain("Вхід тимчасово заблоковано.");
    const captcha = screen.getByRole("checkbox", { name: "Я не робот" });
    expect(screen.getByRole("main").contains(captcha)).toBe(true);
    expect(screen.getByRole("button", { name: /^Увійти · 15:00/ }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("GRID-06@PoC AC4: Enter on «Показати пароль» shows the password, sends nothing, the focus stays", () => {
    const { client, calls } = fakeApi({});
    renderAt("#/login", client);
    const field = screen.getByLabelText(/^Пароль/, { selector: "input" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "correct horse battery" } });
    const toggle = screen.getByRole("button", { name: "Показати пароль" });
    toggle.focus();
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);
    expect(field.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(toggle);
    expect(calls).toEqual([]);
  });

  it("GRID-06@PoC EC1: an unknown email gets the same answer as a wrong password", async () => {
    const texts: string[] = [];
    for (const address of ["olena@example.com", "nobody@example.com"]) {
      const view = renderAt(
        "#/login",
        fakeApi({ "POST /v1/sessions": problem(401, "INVALID_CREDENTIALS") }).client,
      );
      fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), { target: { value: address } });
      fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
        target: { value: "anything at all" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
      texts.push(plain((await screen.findByRole("alert")).textContent));
      view.unmount();
    }
    expect(texts[0]).toContain("Невірний email або пароль");
    expect(texts[1]).toBe(texts[0]);
  });
});

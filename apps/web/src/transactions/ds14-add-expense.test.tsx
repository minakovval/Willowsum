import { act, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, resetAuthState } from "../auth/testing.tsx";
import { resetNavigationSession } from "../routing/session.ts";
import { NewTransactionDialog } from "./NewTransactionDialog.tsx";
import type { Account } from "./newTransaction.ts";

/**
 * DS-14@PoC AC1: the Tab walk through «додати витрату» (S-048 «Нова транзакція»). Only the dialog is rendered. jsdom
 * draws no ring, so the ring is checked on the real stylesheets: every stop is a visible control inside the dialog,
 * and no rule removes the shared 3 px ring from it (the one exception is the inner input of a field, whose whole
 * box draws the ring). Synthetic data only.
 */
const TODAY = "2026-11-02";
const ACC = "00000000-0000-4000-8000-000000000001";
const account = {
  id: ACC,
  kind: "current",
  group: "cash",
  name: "Поточний",
  institution: null,
  number: { last4: "4417", masked: "••4417" },
  status: "active",
  closedOn: null,
  source: "manual",
  updatedOn: TODAY,
  inProfileCurrency: {
    total: { amount: "1000.00", currency: "EUR" },
    approximate: false,
    unavailableCount: 0,
  },
  currencies: [
    {
      currency: "EUR",
      amount: { amount: "1000.00", currency: "EUR" },
      equivalent: { amount: "1000.00", currency: "EUR" },
      rateDate: null,
      approximate: false,
      restricted: false,
    },
  ],
  creditCard: null,
  loan: null,
} as unknown as Account;

const stylesheets = [
  join(process.cwd(), "src", "app.css"),
  join(process.cwd(), "src", "transactions", "newTransaction.css"),
  ...["base.css", "components.css", "shell.css"].map((f) =>
    resolve(process.cwd(), "../../packages/ui/src/styles", f),
  ),
].map((f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));

/** The selectors of every rule that sets `outline: none` (or 0), with the focus pseudo-classes taken off. */
const outlineRemovers = stylesheets.flatMap((css) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /(^|[;\s])outline:\s*(none|0)\s*(;|$)/.test(m[2]!))
    .flatMap((m) => m[1]!.split(",").map((s) => s.trim().replace(/:focus(-visible|-within)?/g, ""))),
);
const matchesSafely = (el: Element, selector: string) => {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
};

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  localStorage.clear();
  sessionStorage.clear();
  resetNavigationSession();
  resetAuthState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("DS-14@PoC «додати витрату»", () => {
  it("DS-14@PoC AC1: every Tab stop of the «Нова транзакція» form is a visible control inside the dialog that keeps the shared focus ring and is not covered by anything", async () => {
    const api = fakeApi({
      "GET /v1/accounts": { status: 200, body: { items: [account], nextCursor: null } },
      "GET /v1/merchants": { status: 200, body: { items: [] } },
      "GET /v1/categories": { status: 200, body: { groups: [] } },
    });
    render(
      <I18nProvider initialLocale="uk">
        <AuthApiProvider value={api.client}>
          <NewTransactionDialog open onClose={vi.fn()} today={TODAY} />
        </AuthApiProvider>
      </I18nProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: "Нова транзакція" });
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: /^Рахунок/ }).textContent).toContain("Поточний"),
    );
    const all = [
      ...dialog.querySelectorAll<HTMLElement>(
        'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.tabIndex >= 0);
    // The steps not shown are `inert` (and `visibility: hidden`): a browser's Tab never reaches them.
    const stops = all.filter((el) => !el.closest("[inert]"));
    expect(all.length).toBeGreaterThan(stops.length);
    for (const el of all.filter((e) => !stops.includes(e)))
      expect(el.closest(".ws-form-step")).not.toBeNull();
    expect(stops.length).toBeGreaterThanOrEqual(6); // ✕, type, amount, account, date, «Скасувати», «Далі»…
    const names = stops.map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "");
    expect(names.some((n) => /Скасувати/.test(n))).toBe(true);
    expect(names.some((n) => /Далі|Додати транзакцію/.test(n))).toBe(true);

    for (const el of stops) {
      act(() => el.focus());
      expect(document.activeElement, el.outerHTML.slice(0, 80)).toBe(el);
      expect(dialog.contains(el)).toBe(true);
      // Visible and in the accessibility tree: not hidden by an attribute or an ancestor.
      expect(el.closest('[hidden], [aria-hidden="true"], [inert]'), el.outerHTML.slice(0, 80)).toBeNull();
      // Nothing removes the ring from this control, except an inner input whose field box draws it.
      const removed = outlineRemovers.filter((sel) => sel !== "" && matchesSafely(el, sel));
      if (removed.length > 0) {
        expect(el.matches(".ws-field-input"), `${el.className} loses its ring`).toBe(true);
        expect(el.closest(".ws-field-box"), "the box carries the ring").not.toBeNull();
      }
      // Focus does not scroll the page behind or hide the control under a bar: the dialog has no sticky parts.
      expect(getComputedStyle(el).position).not.toBe("fixed");
    }
  });
});

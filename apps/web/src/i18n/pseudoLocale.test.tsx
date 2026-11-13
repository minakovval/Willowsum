import { act, render } from "@testing-library/react";
import { DEFAULT_LOCALE, PSEUDO_LOCALE } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { App } from "../App.tsx";
import { CHILDREN, IMPORT_WIZARD_PATH, SECTIONS, SETTINGS_PATH } from "../routing/routes.ts";
import { resetNavigationSession } from "../routing/session.ts";
import { initialLocale, offeredLanguages } from "./languages.ts";

/**
 * NFR-09@PoC FR 2 (criterion «Додавання мови»): the left-to-right pseudo-locale in the web app. It is offered
 * in development, test and CI builds, never in the production build, and it is chosen with `?lang=en-XA`.
 * NFR-09@PoC FR 1 (criterion «i18n»): with the pseudo-locale on, every text of every app screen is
 * pseudo-localised — a hard-coded string would show up as plain text.
 */
const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

/** Text left once every pseudo-localised «[…]» segment (nested ones too) and the product name are removed. */
function leftover(text: string): string {
  let out = text;
  for (let prev = ""; prev !== out;) {
    prev = out;
    out = out.replace(/\[[^[\]]*\]/g, " ");
  }
  return out.replace(/Willowsum/g, " ");
}
const LETTER = /\p{L}/u;
/** Attributes whose text the user reads or hears. */
const TEXT_ATTRIBUTES = ["aria-label", "aria-description", "title", "placeholder", "alt", "data-label"];

function untranslated(root: HTMLElement): string[] {
  const found: string[] = [];
  const body = leftover(root.textContent ?? "");
  if (LETTER.test(body)) found.push(`text: ${body.replace(/\s+/g, " ").trim()}`);
  for (const el of root.querySelectorAll("*")) {
    for (const name of TEXT_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value && LETTER.test(leftover(value))) found.push(`${name}: ${value}`);
    }
  }
  return found;
}

const APP_PATHS = [
  ...SECTIONS.flatMap((s) => s.pages.map((p) => p.path)),
  ...CHILDREN.map((c) => c.path),
  SETTINGS_PATH,
  IMPORT_WIZARD_PATH,
  "/signup",
  "/login",
  "/no-such-page",
];

describe("NFR-09@PoC FR 2: the pseudo-locale is offered outside production only", () => {
  it("NFR-09@PoC FR 2: development, test and CI builds offer it after the real languages", () => {
    for (const mode of ["development", "test", "ci"]) {
      expect(
        offeredLanguages(mode).map((l) => l.code),
        mode,
      ).toEqual(["uk", "en", PSEUDO_LOCALE]);
    }
  });

  it("NFR-09@PoC FR 2: the production build never offers it", () => {
    expect(offeredLanguages("production").map((l) => l.code)).toEqual(["uk", "en"]);
  });

  it("NFR-09@PoC FR 2: `?lang=` picks an offered language outside production", () => {
    expect(initialLocale("?lang=en-XA", "development")).toBe(PSEUDO_LOCALE);
    expect(initialLocale("?x=1&lang=en", "ci")).toBe("en");
  });

  it("NFR-09@PoC FR 2: `?lang=` is ignored in production and for an unknown code (Ukrainian, П-25)", () => {
    expect(initialLocale("?lang=en-XA", "production")).toBe(DEFAULT_LOCALE);
    expect(initialLocale("?lang=en", "production")).toBe(DEFAULT_LOCALE);
    expect(initialLocale("?lang=xx", "development")).toBe(DEFAULT_LOCALE);
    expect(initialLocale("", "development")).toBe(DEFAULT_LOCALE);
  });
});

describe("NFR-09@PoC FR 1, FR 2: every app screen in the pseudo-locale", () => {
  beforeEach(() => {
    installMatchMedia({ width: 1280 });
    localStorage.clear();
    sessionStorage.clear();
    resetNavigationSession();
    window.history.replaceState(null, "", "/?lang=en-XA#/");
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("NFR-09@PoC FR 2: `?lang=en-XA` switches the app to the pseudo-locale, left to right", () => {
    render(<App />);
    expect(document.documentElement.lang).toBe(PSEUDO_LOCALE);
    expect(document.documentElement.dir).toBe("ltr");
    // The tab title is a pseudo message with the pseudo page name inside it.
    expect(document.title).toMatch(/^\[.*\[.+\].*\]$/);
  });

  it.each(APP_PATHS)("NFR-09@PoC FR 1: %s has no text outside the translation catalogue", (path) => {
    const { container } = render(<App />);
    go(`#${path}`);
    expect(container.textContent?.trim()).not.toBe("");
    expect(untranslated(document.body)).toEqual([]);
  });
});

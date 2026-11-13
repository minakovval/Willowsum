import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, screen, waitFor } from "@testing-library/react";
import {
  accentTextViolations,
  accentUsageViolations,
  controlBorderViolations,
  surface300TextViolations,
  transitionDurationViolations,
  warningMeaningViolations,
} from "@willowsum/ui/tokens";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, renderAt, resetAuthState } from "./auth/testing.tsx";
import { resetNavigationSession } from "./routing/session.ts";
import {
  AUTH_PATHS,
  CHILDREN,
  GALLERY_TOKENS_PATH,
  IMPORT_WIZARD_PATH,
  SECTIONS,
  SETTINGS_PATH,
} from "./routing/routes.ts";

/**
 * DS-06@PoC, DS-08@PoC, DS-13@PoC on the app: colour roles and motion in the app's stylesheets and
 * sources, and the heading structure of every route. The tokens and the package stylesheets are
 * checked in `packages/ui` (`tokens/ds06.test.ts`, `styles/typography.test.ts`, `styles/motion.test.ts`).
 */
// jsdom replaces the global URL, so the path is built from the module path itself.
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";

function files(dir: string, ext: readonly string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full, ext);
    return ext.some((e) => name.endsWith(e)) ? [full] : [];
  });
}

const sheets = files(join(appRoot, "src"), [".css"]).map((f) => [
  f.slice(appRoot.length),
  readFileSync(f, "utf8"),
]);
const sources = files(join(appRoot, "src"), [".ts", ".tsx"])
  .filter((f) => !/\.test\.tsx?$/.test(f))
  .map((f) => [f.slice(appRoot.length), readFileSync(f, "utf8")]);

describe("DS-06@PoC colour roles in the app", () => {
  it("finds the app stylesheets", () => {
    expect(sheets.length).toBeGreaterThan(0);
  });

  it("DS-06@PoC AC4: the app paints nothing in the accent (it is the small leaf and the goal icon only)", () => {
    for (const [name, css] of sheets) expect(accentUsageViolations(css!), name).toEqual([]);
    for (const [name, code] of sources) {
      expect(code, name).not.toMatch(
        /--ws-accent|--ws-mark-small|cssVar\(\s*["']accent["']\s*\)|colors(\.accent|\[["']accent["']\])/,
      );
    }
  });

  it("DS-06@PoC AC5: no text in the app is accent-coloured", () => {
    for (const [name, css] of sheets) expect(accentTextViolations(css!), name).toEqual([]);
  });

  it("DS-06@PoC AC6: text the app sets on surface-300 is ink", () => {
    for (const [name, css] of sheets) expect(surface300TextViolations(css!), name).toEqual([]);
  });

  it("DS-06@PoC AC9: the app's warning colours never mark a goal or an error", () => {
    for (const [name, css] of sheets) expect(warningMeaningViolations(css!), name).toEqual([]);
  });

  it("DS-06@PoC AC11: the app's fields, buttons and checkboxes are not bordered in the decorative line", () => {
    const controls = [/(input|button|checkbox|select|field|captcha|submit)/];
    for (const [name, css] of sheets) expect(controlBorderViolations(css!, controls), name).toEqual([]);
  });
});

describe("DS-13@PoC motion in the app", () => {
  it("DS-13@PoC AC3: every app transition lasts duration-interaction (150 ms, within 120–200 ms)", () => {
    for (const [name, css] of sheets) expect(transitionDurationViolations(css!), name).toEqual([]);
  });
});

/** Every route of the PoC app, with a path that opens it. */
const ROUTES: readonly string[] = [
  ...SECTIONS.flatMap((s) => s.pages.map((p) => p.path)),
  ...CHILDREN.map((c) => c.path),
  SETTINGS_PATH,
  IMPORT_WIZARD_PATH,
  GALLERY_TOKENS_PATH,
  ...Object.keys(AUTH_PATHS),
  "/no-such-page",
];

describe("DS-08@PoC heading structure", () => {
  beforeEach(() => {
    installMatchMedia({ width: 1280 });
    localStorage.clear();
    sessionStorage.clear();
    resetNavigationSession();
    resetAuthState();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(ROUTES)("DS-08@PoC AC3: %s has exactly one h1 and skips no heading level", async (path) => {
    renderAt(`#${path}`, fakeApi({}).client);
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1));
    const levels = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']")).map(
      (h) => Number(h.getAttribute("aria-level") ?? h.tagName.slice(1)),
    );
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++)
      expect(levels[i]! - levels[i - 1]!, `${path}: ${levels.join(",")}`).toBeLessThanOrEqual(1);
  });
});

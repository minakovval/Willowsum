import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "@willowsum/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cspProblems, webCsp, webHeaders } from "../security-headers.ts";

/**
 * Security review of PR #86 (NFR-14 FR 3–4, criterion «CSP без небезпечних джерел»): the CI check of the
 * policy really fails on every unsafe source it claims to catch (also in other letter case), and on host
 * wildcards and insecure schemes; only hashed assets are immutable; theme-init.js — the one script that
 * replaced the inline one — really applies the stored theme and never breaks the page.
 */
describe("criterion 4: the check of the policy fails on unsafe sources", () => {
  it.each([
    ["'wasm-unsafe-eval'", "script-src 'self' 'wasm-unsafe-eval'"],
    ["data: in script-src", "script-src 'self' data:"],
    ["http: in upper case", "img-src HTTP:"],
    ["an http:// host in upper case", "connect-src HTTP://API.EXAMPLE"],
    ["'unsafe-eval' in upper case", "script-src 'UNSAFE-EVAL'"],
    ["a bare * in frame-ancestors", "frame-ancestors *"],
  ])("%s", (_where, csp) => {
    expect(cspProblems(csp)).not.toEqual([]);
  });

  it("the real policy passes (control)", () => {
    expect(cspProblems(webCsp({ https: true }))).toEqual([]);
  });

  // Was a defect (review of PR #86, non-blocking): host wildcards, non-TLS WebSocket sources and an
  // inline-script allowance passed the check. Fixed in cspProblems.
  it.each([
    ["a host wildcard", "script-src 'self' https://*.cdn.example"],
    ["a scheme-less host wildcard", "connect-src *.example"],
    ["ws: (WebSocket without TLS)", "connect-src 'self' ws://socket.example"],
    ["'unsafe-inline' scripts", "script-src 'self' 'unsafe-inline'"],
  ])("%s is reported", (_where, csp) => {
    expect(cspProblems(csp)).not.toEqual([]);
  });
});

describe("FR 4: only files with a content hash in the name are immutable", () => {
  it.each([
    "/assets/logo.png",
    "/assets/logo-a.png",
    "/assets/index-abc.js",
    "/assets/index-B3x9kQ7a.js.map/x",
  ])("%s is revalidated (no-cache)", (path) => {
    expect(webHeaders(path, { https: true })["cache-control"]).toBe("no-cache");
  });
});

describe("FR 3: theme-init.js works as the CSP-allowed replacement of the inline script", () => {
  const script = readFileSync(join(process.cwd(), "public", "theme-init.js"), "utf8");
  const run = () => new Function(script)() as void;

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    localStorage.clear();
  });

  it("applies a stored light or dark theme", () => {
    for (const theme of ["dark", "light"]) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      run();
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(theme);
    }
  });

  it("ignores any other stored value (no attribute injection from storage)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark" onload="x');
    run();
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it("does not throw when storage is blocked (private mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(run).not.toThrow();
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });
});

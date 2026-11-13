// @vitest-environment node
import { cspProblems, webCsp, webHeaders, WEB_CSP_DIRECTIVES } from "../security-headers.ts";
import viteConfig, { securityHeaders } from "../vite.config.ts";

/**
 * NFR-14 FR 2–4 and criterion «CSP без небезпечних джерел» (the automatic check of the policy in CI: the
 * `web` job runs these tests). What staging serves is checked there (CICD-07).
 */
describe("NFR-14 criterion «CSP без небезпечних джерел»: the web CSP has no unsafe sources", () => {
  it("0 http: sources, no 'unsafe-eval', no wildcard — over HTTPS and in the local preview", () => {
    expect(cspProblems(webCsp({ https: true }))).toEqual([]);
    expect(cspProblems(webCsp({ https: false }))).toEqual([]);
  });

  it("the check itself finds http: sources, 'unsafe-eval' and wildcards", () => {
    expect(cspProblems("script-src 'self' http://cdn.example; img-src http:")).toHaveLength(2);
    expect(cspProblems("script-src 'self' 'unsafe-eval'")).toEqual(["script-src: 'unsafe-eval'"]);
    expect(cspProblems("default-src *; script-src https:")).toHaveLength(2);
  });
});

describe("NFR-14 FR 3: the CSP of the table «Політика вмісту вебу»", () => {
  it("every directive and source of the table, in order", () => {
    expect(webCsp({ https: true })).toBe(
      [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src https://challenges.cloudflare.com",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
    expect(Object.keys(WEB_CSP_DIRECTIVES)).toHaveLength(13);
  });

  it("over plain HTTP (local preview) upgrade-insecure-requests is left out, nothing else changes", () => {
    expect(webCsp({ https: false })).toBe(webCsp({ https: true }).replace("; upgrade-insecure-requests", ""));
  });
});

describe("NFR-14 FR 2, FR 4, AC3: headers on every static path", () => {
  it.each([
    "/",
    "/index.html",
    "/theme-init.js",
    "/favicon.svg",
    "/assets/index-B3x9kQ7a.js",
    "/no-such-file",
  ])(
    "%s has HSTS, nosniff, Referrer-Policy, closed Permissions-Policy, COOP, X-Frame-Options DENY and the CSP",
    (path) => {
      const headers = webHeaders(path, { https: true });
      expect(headers).toMatchObject({
        "strict-transport-security": "max-age=31536000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "cross-origin-opener-policy": "same-origin",
        "x-frame-options": "DENY",
        "content-security-policy": webCsp({ https: true }),
      });
      // Closed: every listed feature is denied to every origin.
      for (const feature of headers["permissions-policy"]!.split(", "))
        expect(feature).toMatch(/^[a-z-]+=\(\)$/);
    },
  );

  it("AC3: a page cannot be framed by another site (X-Frame-Options DENY and frame-ancestors 'none')", () => {
    const headers = webHeaders("/", { https: true });
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("FR 4: the HTML shell is no-cache; hashed assets are immutable; unhashed files are revalidated", () => {
    expect(webHeaders("/", { https: true })["cache-control"]).toBe("no-cache");
    expect(webHeaders("/index.html", { https: true })["cache-control"]).toBe("no-cache");
    expect(webHeaders("/theme-init.js", { https: true })["cache-control"]).toBe("no-cache");
    expect(webHeaders("/assets/index-B3x9kQ7a.js", { https: true })["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(webHeaders("/app/assets/index-B3x9kQ7a.css", { https: true })["cache-control"]).toContain(
      "immutable",
    );
  });

  it("HSTS only over HTTPS", () => {
    expect(webHeaders("/", { https: false })["strict-transport-security"]).toBeUndefined();
  });
});

describe("NFR-14: vite preview serves dist/ with these headers", () => {
  it("the plugin is in the config and sets every header of webHeaders on a request", () => {
    const plugins = (viteConfig as { plugins?: unknown[] }).plugins?.flat() as { name?: string }[];
    expect(plugins.map((p) => p?.name)).toContain("willowsum-security-headers");
    const set: Record<string, string> = {};
    let next = false;
    const plugin = securityHeaders();
    const hook = plugin.configurePreviewServer as (server: unknown) => void;
    hook({
      config: { preview: { https: false } },
      middlewares: {
        use: (fn: (req: unknown, res: unknown, next: () => void) => void) =>
          fn(
            { url: "/assets/index-B3x9kQ7a.js?v=1" },
            { setHeader: (n: string, v: string) => (set[n] = v) },
            () => {
              next = true;
            },
          ),
      },
    });
    expect(next).toBe(true);
    expect(set).toEqual(webHeaders("/assets/index-B3x9kQ7a.js", { https: false }));
  });
});

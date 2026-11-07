/**
 * Security headers of the web app's static files (NFR-14 FR 2–4; ADR-0007). The single source for whatever
 * serves `dist/`: the Vite preview server applies it here (vite.config.ts), and the server or CDN of staging
 * and production must send exactly `webHeaders(path)` (checked on staging by CICD-07). The admin panel
 * (`apps/admin`, later) uses the same policy.
 *
 * The CSP is the table «Політика вмісту вебу»; it is never sent by the API, which has its own (NFR-14 FR 3).
 */

/** The CAPTCHA provider's origin (Cloudflare Turnstile): the only third-party source of the policy. */
export const CAPTCHA_ORIGIN = "https://challenges.cloudflare.com";

export const WEB_CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "default-src": ["'self'"],
  "script-src": ["'self'", CAPTCHA_ORIGIN],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "frame-src": [CAPTCHA_ORIGIN],
  "worker-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "upgrade-insecure-requests": [],
});

export interface WebHeaderOptions {
  /** Served over HTTPS (staging, production): HSTS and `upgrade-insecure-requests` are sent. */
  readonly https: boolean;
}

/** The CSP header value. Over plain HTTP (local preview) `upgrade-insecure-requests` is left out. */
export function webCsp(options: WebHeaderOptions): string {
  return Object.entries(WEB_CSP_DIRECTIVES)
    .filter(([name]) => options.https || name !== "upgrade-insecure-requests")
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

/** Hashed build assets (`assets/<name>-<hash>.<ext>`, Vite's output): their content never changes. */
const HASHED_ASSET_RE = /^\/(.*\/)?assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/** Every header for one path of the static site (the path without query). */
export function webHeaders(path: string, options: WebHeaderOptions): Record<string, string> {
  return {
    ...(options.https ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    // Closed: no browser feature is used by the app.
    "permissions-policy":
      "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()",
    "cross-origin-opener-policy": "same-origin",
    "x-frame-options": "DENY",
    "content-security-policy": webCsp(options),
    // NFR-14 FR 4: the HTML shell (and every unhashed file) is revalidated; hashed assets are immutable.
    "cache-control": HASHED_ASSET_RE.test(path) ? "public, max-age=31536000, immutable" : "no-cache",
  };
}

/**
 * Problems of a CSP (NFR-14 criterion «CSP без небезпечних джерел»): any `http:` source, `'unsafe-eval'`, a
 * bare wildcard. Empty means the policy is safe. Run in CI by the web tests.
 */
export function cspProblems(csp: string): string[] {
  const problems: string[] = [];
  for (const directive of csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)) {
    const [name, ...sources] = directive.split(/\s+/);
    for (const source of sources) {
      const s = source.toLowerCase();
      if (s === "http:" || s.startsWith("http://") || s === "ws:" || s.startsWith("ws://"))
        problems.push(`${name}: insecure source ${source}`);
      if (s === "'unsafe-eval'" || s === "'wasm-unsafe-eval'") problems.push(`${name}: ${source}`);
      if (s === "'unsafe-inline'" && (name === "script-src" || name === "default-src"))
        problems.push(`${name}: inline scripts ${source}`);
      // A bare *, a scheme-only source, or a host pattern (*.example, https://*.example).
      if (
        s === "*" ||
        s === "https:" ||
        s === "wss:" ||
        /^([a-z][a-z0-9+.-]*:\/\/)?\*/.test(s) ||
        (s === "data:" && name === "script-src")
      )
        problems.push(`${name}: wildcard ${source}`);
    }
  }
  return problems;
}

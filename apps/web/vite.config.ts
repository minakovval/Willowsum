import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { webHeaders } from "./security-headers.ts";
import { captchaConfig } from "./src/auth/captcha/config.ts";

/**
 * NFR-14 FR 2–4: `vite preview` serves `dist/` with the same headers the deployed static site must send
 * (security-headers.ts). The dev server is left alone: its hot reload injects inline scripts the CSP forbids.
 */
export function securityHeaders(): Plugin {
  return {
    name: "willowsum-security-headers",
    configurePreviewServer(server) {
      const https = Boolean(server.config.preview.https);
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "/").split("?")[0] ?? "/";
        for (const [name, value] of Object.entries(webHeaders(path, { https }))) res.setHeader(name, value);
        next();
      });
    },
  };
}

/**
 * ACC-01 FR 12 (ADR-0009): a production build without the Cloudflare Turnstile site key would ship the synthetic CAPTCHA
 * widget, whose token the deployed API refuses — sign-up would silently break. So `vite build` in mode `production`
 * (`pnpm --filter @willowsum/web build:production`, the deploy build) fails without a well-formed
 * `VITE_CAPTCHA_SITE_KEY`. Local and CI builds use mode `ci` (`pnpm build`) and the dev server never builds, so they
 * keep working without the key.
 */
export function requireCaptchaSiteKey(): Plugin {
  return {
    name: "willowsum-captcha-site-key",
    apply: "build",
    configResolved(config) {
      if (config.mode !== "production") return;
      if (captchaConfig(config.env).mode !== "turnstile")
        throw new Error(
          "VITE_CAPTCHA_SITE_KEY is missing or malformed: a production build needs the Cloudflare Turnstile site key " +
            "(ACC-01 FR 12). Local and CI builds: `pnpm build` (mode ci).",
        );
    },
  };
}

/**
 * The API is served on the web app's own origin (`/v1/…`; CSP `connect-src 'self'`). Locally the dev and preview servers
 * pass `/v1` to the API process (`WS_API_ORIGIN`, default the API's local port 8080); the browser's Origin header is kept,
 * so the API's Origin check (NFR-15 FR 5, `WS_ALLOWED_ORIGINS`) sees the page's real origin.
 */
const API_PROXY = {
  "/v1": { target: process.env["WS_API_ORIGIN"] ?? "http://localhost:8080", changeOrigin: false },
};

// `base: "./"` keeps every asset URL relative, so `dist/` can be published as one static site
// under any path. Routes live in the URL hash for the same reason (no server rewrites needed).
export default defineConfig({
  base: "./",
  plugins: [react(), securityHeaders(), requireCaptchaSiteKey()],
  server: { proxy: API_PROXY },
  preview: { proxy: API_PROXY },
  build: {
    target: "es2022",
  },
});

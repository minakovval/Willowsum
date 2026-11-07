import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { webHeaders } from "./security-headers.ts";

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

// `base: "./"` keeps every asset URL relative, so `dist/` can be published as one static site
// under any path. Routes live in the URL hash for the same reason (no server rewrites needed).
export default defineConfig({
  base: "./",
  plugins: [react(), securityHeaders()],
  build: {
    target: "es2022",
  },
});

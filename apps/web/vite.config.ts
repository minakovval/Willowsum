import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `base: "./"` keeps every asset URL relative, so `dist/` can be published as one static site
// under any path. Routes live in the URL hash for the same reason (no server rewrites needed).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
  },
});

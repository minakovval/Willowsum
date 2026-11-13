import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freePort, startE2eApi } from "../../api/test/e2e-support.ts";

/**
 * Starts the stack of the end-to-end run (NFR-07@PoC) and returns its teardown:
 * - the real API process on a fresh database with every migration (apps/api/test/e2e-support.ts);
 * - the static build (`vite build --mode ci`: synthetic CAPTCHA, no keys) served by `vite preview`, which sends the
 *   production headers and CSP and passes `/v1` to the API on the page's own origin, as the deployed site will.
 * Tests read the addresses from `WS_E2E_BASE_URL` and `WS_E2E_DATABASE_URL` (set here, inherited by the workers).
 */
const webDir = fileURLToPath(new URL("..", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

async function waitForPage(url: string, timeoutMs: number, failed: () => string | null): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const error = failed();
    if (error !== null) throw new Error(`vite preview stopped:\n${error}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${url} did not answer within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(`${webDir}/dist/index.html`))
    throw new Error("No apps/web/dist: build first (pnpm --filter @willowsum/web e2e builds, then tests)");
  const webPort = await freePort();
  const baseUrl = `http://localhost:${webPort}`;
  const api = await startE2eApi(baseUrl);

  const preview = spawn(
    process.execPath,
    [viteBin, "preview", "--host", "localhost", "--port", String(webPort), "--strictPort"],
    { cwd: webDir, env: { ...process.env, WS_API_ORIGIN: api.origin }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let exit: number | null | undefined;
  preview.stdout!.on("data", (d) => (output += d));
  preview.stderr!.on("data", (d) => (output += d));
  const exited = new Promise<void>((resolve) =>
    preview.on("exit", (code) => {
      exit = code;
      resolve();
    }),
  );
  const teardown = async () => {
    if (exit === undefined) {
      preview.kill("SIGTERM");
      await exited;
    }
    await api.stop();
  };
  try {
    await waitForPage(`${baseUrl}/`, 30_000, () => (exit === undefined ? null : output));
    // The proxy reaches the API: its public meta route answers through the web origin.
    const meta = await fetch(`${baseUrl}/v1/meta`);
    if (meta.status !== 200) throw new Error(`/v1/meta through the web origin answered ${meta.status}`);
  } catch (error) {
    await teardown();
    throw error;
  }
  process.env["WS_E2E_BASE_URL"] = baseUrl;
  process.env["WS_E2E_DATABASE_URL"] = api.databaseUrl;
  return teardown;
}

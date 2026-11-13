import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { freePort, startE2eApi } from "../../api/test/e2e-support.ts";

/**
 * Starts the stack of the end-to-end run (NFR-07@PoC) and returns its teardown:
 * - the real API process on a fresh database with every migration (apps/api/test/e2e-support.ts);
 * - the static build (`vite build --mode ci`: synthetic CAPTCHA, no keys) served by `vite preview` with the app's own
 *   config — the production headers and CSP, `/v1` passed to the API on the page's own origin, as the deployed site.
 *
 * The page is served over HTTPS, like every deployed environment, with a self-signed certificate made for this run
 * only (the browsers are told to accept it). Over plain http WebKit on Linux drops the session cookie, which is
 * always `Secure` (NFR-15 FR 5). Tests read the addresses from `WS_E2E_BASE_URL` and `WS_E2E_DATABASE_URL` (set
 * here, inherited by the workers).
 */
const webDir = fileURLToPath(new URL("..", import.meta.url));

/** A throw-away certificate for `localhost` (openssl, one day); the key never leaves the temporary folder. */
function localCertificate(): { key: string; cert: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "ws-e2e-tls-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  return {
    key: readFileSync(key, "utf8"),
    cert: readFileSync(cert, "utf8"),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Status of a GET over HTTPS, trusting only this run's certificate. */
function status(url: string, ca: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request(url, { ca }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(`${webDir}/dist/index.html`))
    throw new Error("No apps/web/dist: build first (pnpm --filter @willowsum/web e2e builds, then tests)");
  const tls = localCertificate();
  const webPort = await freePort();
  const baseUrl = `https://localhost:${webPort}`;
  // The throw-away key is removed even when the API never starts (teardown below does not exist yet).
  const api = await startE2eApi(baseUrl).catch((error: unknown) => {
    tls.remove();
    throw error;
  });
  // vite.config.ts reads the API's address for its `/v1` proxy when it loads.
  process.env["WS_API_ORIGIN"] = api.origin;
  let server: Awaited<ReturnType<typeof preview>> | undefined;
  const teardown = async () => {
    await server?.close();
    await api.stop();
    tls.remove();
  };
  try {
    server = await preview({
      root: webDir,
      logLevel: "warn",
      preview: {
        host: "localhost",
        port: webPort,
        strictPort: true,
        https: { key: tls.key, cert: tls.cert },
      },
    });
    if ((await status(`${baseUrl}/`, tls.cert)) !== 200) throw new Error("the web app did not answer");
    // The proxy reaches the API: its public meta route answers through the web origin.
    const meta = await status(`${baseUrl}/v1/meta`, tls.cert);
    if (meta !== 200) throw new Error(`/v1/meta through the web origin answered ${meta}`);
  } catch (error) {
    await teardown();
    throw error;
  }
  process.env["WS_E2E_BASE_URL"] = baseUrl;
  process.env["WS_E2E_DATABASE_URL"] = api.databaseUrl;
  return teardown;
}

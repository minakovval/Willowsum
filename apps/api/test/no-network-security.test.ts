import dgram from "node:dgram";
import dns from "node:dns";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedHost } from "../../../tools/test-guards/no-network.mjs";

// Security review of ARC-05 (PR #84): the no-network test guard (tools/test-guards/no-network.mjs).

/** Documentation range (RFC 5737): never routed. */
const OUTSIDE = "203.0.113.10";
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const GUARD = path.join(repoRoot, "tools/test-guards/no-network.mjs");

/** Resolves with the socket's first outcome; a connect means the guard let the connection through. */
function outcome(socket: net.Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("error", (e: NodeJS.ErrnoException) => resolve(String(e.code)));
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("security ARC-05: allowed hosts are loopback and the configured database host, exactly", () => {
  it("the database host is allowed by its exact name; look-alikes and proxy hosts are not", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u@db.ci.test:5432/x");
    vi.stubEnv("PGHOST", "");
    vi.stubEnv("WS_DB_HOST", "");
    vi.stubEnv("WS_MIGRATION_DATABASE_URL", "");
    vi.stubEnv("HTTPS_PROXY", "http://proxy.ci.test:3128");
    vi.stubEnv("HTTP_PROXY", "http://proxy.ci.test:3128");
    expect(isAllowedHost("db.ci.test")).toBe(true);
    expect(isAllowedHost("DB.CI.TEST")).toBe(true);
    for (const host of [
      "evil-db.ci.test",
      "x.db.ci.test",
      "db.ci.test.evil.example",
      "ci.test",
      "proxy.ci.test",
    ])
      expect(isAllowedHost(host), host).toBe(false);
  });

  it("IPv6 forms: only loopback and IPv4-mapped loopback are allowed", () => {
    const none = new Set<string>();
    for (const host of ["::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"])
      expect(isAllowedHost(host, none)).toBe(true);
    for (const host of [
      `::ffff:${OUTSIDE}`,
      "::ffff:10.0.0.1",
      "[::ffff:8.8.8.8]",
      "2001:db8::1",
      "fe80::1",
      "fc00::1",
      "::2",
    ])
      expect(isAllowedHost(host, none), host).toBe(false);
  });

  it("raw sockets with extra options still go through the guard", async () => {
    for (const options of [
      { host: OUTSIDE, port: 443, allowHalfOpen: true },
      { host: OUTSIDE, port: 443, keepAlive: true, noDelay: true },
      { host: OUTSIDE, port: 443, family: 4 },
      { host: `::ffff:${OUTSIDE}`, port: 443 },
      { host: "localhost.evil.example", port: 443 },
    ])
      expect(await outcome(net.connect(options)), JSON.stringify(options)).toBe("WS_NETWORK_BLOCKED");
  });

  // BLOCKING, fixed (no-network.mjs:48): `/^127\./` is applied to host names, so any DNS name that starts with
  // «127.» passes and may resolve to a public address.
  it("a host name that only starts like a loopback address is not allowed", () => {
    for (const host of ["127.evil.example", "127.0.0.1.nip.io", "127.1"])
      expect(isAllowedHost(host, new Set()), host).toBe(false);
  });

  // BLOCKING, fixed (no-network.mjs:56): Node treats an empty `path` as «no path» and connects over TCP, but the
  // guard treats any string `path` as a Unix socket and lets it through.
  it("an empty `path` option does not turn the guard off", async () => {
    expect(await outcome(net.connect({ path: "", host: OUTSIDE, port: 443 } as net.NetConnectOpts))).toBe(
      "WS_NETWORK_BLOCKED",
    );
  });

  // BLOCKING, fixed (no-network.mjs:67-74): the guard checks the name, never the address it resolves to, so an
  // allowed name with a custom `lookup` (or a hosts/DNS entry) reaches any address.
  it("an allowed name that resolves to a non-loopback address is blocked", async () => {
    const lookup = ((_h: string, o: dns.LookupOptions, cb: (...a: unknown[]) => void) =>
      o.all ? cb(null, [{ address: OUTSIDE, family: 4 }]) : cb(null, OUTSIDE, 4)) as net.LookupFunction;
    expect(await outcome(net.connect({ host: "localhost", port: 443, lookup }))).toBe("WS_NETWORK_BLOCKED");
  });

  // Non-blocking, fixed (ADR-0005 claims «до DNS»): UDP and direct DNS queries leave the machine unguarded.
  it("UDP datagrams and direct DNS queries to the outside are blocked", async () => {
    const sent = await new Promise<Error | null>((resolve) => {
      const socket = dgram.createSocket("udp4");
      socket.send("x", 53, OUTSIDE, (error) => {
        socket.close();
        resolve(error);
      });
    });
    expect((sent as NodeJS.ErrnoException | null)?.code).toBe("WS_NETWORK_BLOCKED");
    await expect(dns.promises.resolve4("example.com")).rejects.toMatchObject({ code: "WS_NETWORK_BLOCKED" });
  });
});

describe("security ARC-05: every Vitest configuration loads the guard", () => {
  function vitestPackages(): string[] {
    const dirs: string[] = [];
    for (const group of ["apps", "packages", "tools"]) {
      for (const name of readdirSync(path.join(repoRoot, group))) {
        const pkg = path.join(repoRoot, group, name, "package.json");
        if (!existsSync(pkg)) continue;
        const scripts = (JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> })
          .scripts;
        if (Object.values(scripts ?? {}).some((s) => /\bvitest\b/.test(s))) dirs.push(path.join(group, name));
      }
    }
    return dirs;
  }

  it("each package that runs Vitest has configurations, and each one lists no-network.mjs in setupFiles", async () => {
    const packages = vitestPackages();
    expect(packages).toEqual(
      expect.arrayContaining(["apps/api", "apps/web", "packages/ui", "tools/synthetic"]),
    );
    const configs: string[] = [];
    for (const dir of packages) {
      const found = readdirSync(path.join(repoRoot, dir)).filter((f) =>
        /^vitest(\.[a-z]+)?\.config\.(ts|mts|js|mjs)$/.test(f),
      );
      expect(found, dir).not.toEqual([]);
      configs.push(...found.map((f) => path.join(repoRoot, dir, f)));
    }
    expect(configs.map((c) => path.relative(repoRoot, c))).toContain("apps/api/vitest.integration.config.ts");
    for (const config of configs) {
      const loaded = (await import(pathToFileURL(config).href)) as {
        default: { test?: { setupFiles?: unknown } };
      };
      const setup = [loaded.default.test?.setupFiles ?? []].flat().map((f) => path.resolve(String(f)));
      expect(setup, path.relative(repoRoot, config)).toContain(GUARD);
    }
  });
});

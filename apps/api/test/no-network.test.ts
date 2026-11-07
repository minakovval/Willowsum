import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAllowedHost as allowed } from "../../../tools/test-guards/no-network.mjs";

/** Documentation range (RFC 5737): never routed, so a leak would hang rather than succeed. */
const OUTSIDE = "203.0.113.10";

function socketError(socket: net.Socket): Promise<NodeJS.ErrnoException> {
  return new Promise((resolve) => socket.once("error", resolve));
}

let server: http.Server;
let port = 0;
beforeAll(async () => {
  server = http.createServer((_, res) => res.end("local ok"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});

describe("ARC-05 criterion «Тести, що потребують інтернету в CI — 0»: tests cannot reach the network", () => {
  it("ARC-05: fetch to an outside host fails at once with WS_NETWORK_BLOCKED", async () => {
    await expect(fetch("https://example.com/")).rejects.toMatchObject({ code: "WS_NETWORK_BLOCKED" });
    await expect(fetch(new Request(`http://${OUTSIDE}/x`))).rejects.toMatchObject({
      code: "WS_NETWORK_BLOCKED",
    });
  });

  it("ARC-05: raw sockets, http and TLS to an outside host are blocked before any connection", async () => {
    const raw = net.connect({ host: OUTSIDE, port: 443 });
    expect((await socketError(raw)).code).toBe("WS_NETWORK_BLOCKED");
    const byArgs = net.connect(80, "example.com");
    expect((await socketError(byArgs)).code).toBe("WS_NETWORK_BLOCKED");
    const request = http.get(`http://${OUTSIDE}/`);
    expect((await new Promise<NodeJS.ErrnoException>((r) => request.once("error", r))).code).toBe(
      "WS_NETWORK_BLOCKED",
    );
    const secure = tls.connect({ host: "example.com", port: 443, servername: "example.com" });
    expect((await socketError(secure)).code).toBe("WS_NETWORK_BLOCKED");
  });

  it("ARC-05: this machine stays reachable (local servers, the test database)", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(await response.text()).toBe("local ok");
    const viaName = await fetch(`http://localhost:${port}/`).catch(() => fetch(`http://127.0.0.1:${port}/`));
    expect(viaName.ok).toBe(true);
    const socket = net.connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.destroy();
  });

  it("allows only local hosts and the configured database host", () => {
    const db = new Set(["pg.internal.test"]);
    for (const host of [
      undefined,
      "",
      "localhost",
      "127.0.0.1",
      "127.5.5.5",
      "::1",
      "[::1]",
      "app.localhost",
    ])
      expect(allowed(host, db)).toBe(true);
    expect(allowed("pg.internal.test", db)).toBe(true);
    for (const host of ["example.com", OUTSIDE, "10.0.0.1", "localhost.example.com", "api.stripe.com"])
      expect(allowed(host, db)).toBe(false);
  });
});

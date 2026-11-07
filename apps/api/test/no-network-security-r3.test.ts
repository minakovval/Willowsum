import dgram, { createSocket as namedCreateSocket } from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

// Security review of ARC-05 (PR #84), round 3: the database-host exemption from the loopback-only lookup,
// UDP lookups (createSocket and the Socket constructor), the blocked dgram.connect, dns.lookupService.

const OUTSIDE = "203.0.113.10";
const BLOCKED = "WS_NETWORK_BLOCKED";
/** The public constructor (`new dgram.Socket(options)`), which @types/node does not declare. */
const UdpSocket = dgram.Socket as unknown as new (options: dgram.SocketOptions) => dgram.Socket;
const code = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;

function outcome(socket: net.Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("error", (e: NodeJS.ErrnoException) => resolve(String(e.code)));
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
  });
}

/** Answers `target` with OUTSIDE and every other name (the implicit bind to 0.0.0.0 included) with itself. */
function redirecting(target: string, seen: string[] = []): net.LookupFunction {
  return ((h: string, o: dns.LookupOptions | number, cb: (...a: unknown[]) => void) => {
    seen.push(h);
    const address = h === target ? OUTSIDE : h;
    const family = net.isIP(address) || 4;
    return typeof o === "object" && o?.all ? cb(null, [{ address, family }]) : cb(null, address, family);
  }) as net.LookupFunction;
}

function udpSend(socket: dgram.Socket, address: string, port = 9): Promise<string> {
  return new Promise((resolve) => {
    socket.once("error", (e: NodeJS.ErrnoException) => resolve(String(e.code)));
    socket.send("x", port, address, (e) => {
      socket.close();
      resolve(e ? String(code(e)) : "sent");
    });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("security ARC-05 r3: the database host does not switch off the loopback-only lookup", () => {
  // BLOCKING, fixed: CI's job `api` sets DATABASE_URL=postgres://…@localhost:5432/… (.github/workflows/pr-checks.yml),
  // so «localhost» is in the database-host set, which skips the loopback-only lookup (no-network.mjs,
  // needsLoopbackLookup). During the integration run a custom lookup sends «localhost» anywhere (TCP and UDP).
  it("with DATABASE_URL on localhost, «localhost» must still resolve to loopback (TCP and UDP)", async () => {
    for (const [name, value] of [
      ["DATABASE_URL", "postgres://postgres:postgres@localhost:5432/postgres"],
      ["PGHOST", "localhost"],
      ["WS_DB_HOST", "LOCALHOST"],
    ] as const) {
      vi.stubEnv(name, value);
      expect(
        await outcome(net.connect({ host: "localhost", port: 443, lookup: redirecting("localhost") })),
        name,
      ).toBe(BLOCKED);
      const udp = dgram.createSocket({ type: "udp4", lookup: redirecting("localhost") as never });
      expect(await udpSend(udp, "localhost"), name).toBe(BLOCKED);
      vi.unstubAllEnvs();
    }
  });

  // BLOCKING, fixed (same cause): the database host is trusted by name, but a custom lookup decides where that name goes.
  it("a custom lookup is never consulted for the database host", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u@db.ci.test:5432/x");
    const seen: string[] = [];
    const result = await outcome(
      net.connect({ host: "db.ci.test", port: 443, lookup: redirecting("db.ci.test", seen) }),
    );
    expect(result).not.toBe("connected");
    expect(seen).toEqual([]);
    const udp = dgram.createSocket({ type: "udp4", lookup: redirecting("db.ci.test", seen) as never });
    expect(await udpSend(udp, "db.ci.test")).not.toBe("sent");
    expect(seen).toEqual([]);
  });
});

describe("security ARC-05 r3: UDP lookups", () => {
  it("createSocket: a custom lookup cannot redirect an IP literal (it is its own answer)", async () => {
    const server = dgram.createSocket("udp4");
    server.bind(0, "127.0.0.1");
    await once(server, "listening");
    const received = once(server, "message");
    const client = dgram.createSocket({ type: "udp4", lookup: redirecting("127.0.0.1") as never });
    expect(await udpSend(client, "127.0.0.1", server.address().port)).toBe("sent");
    const timeout = new Promise((resolve) => setTimeout(() => resolve("not received"), 1_000));
    expect(await Promise.race([received.then(() => "received"), timeout])).toBe("received");
    server.close();
  });

  it("createSocket: the same for an IPv6 literal (udp6, ::1)", async (ctx) => {
    const server = dgram.createSocket("udp6");
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.bind(0, "::1", () => resolve(true));
    });
    // Machines without IPv6 loopback (some sandboxes) cannot run this case.
    if (!bound) return ctx.skip();
    const received = once(server, "message");
    const lookup = ((h: string, _o: unknown, cb: (...a: unknown[]) => void) =>
      cb(null, h === "::1" ? `::ffff:${OUTSIDE}` : h, 6)) as never;
    const client = dgram.createSocket({ type: "udp6", lookup });
    expect(await udpSend(client, "::1", server.address().port)).toBe("sent");
    const timeout = new Promise((resolve) => setTimeout(() => resolve("not received"), 1_000));
    expect(await Promise.race([received.then(() => "received"), timeout])).toBe("received");
    server.close();
  });

  it("createSocket: localhost through a custom lookup must be loopback, also for connect()", async () => {
    const udp = dgram.createSocket({ type: "udp4", lookup: redirecting("localhost") as never });
    expect(await udpSend(udp, "localhost")).toBe(BLOCKED);
    // The ESM named import is the guarded createSocket too (syncBuiltinESMExports runs after the dgram guard).
    const named = namedCreateSocket({ type: "udp4", lookup: redirecting("localhost") as never });
    expect(await udpSend(named, "localhost")).toBe(BLOCKED);
    const connecting = dgram.createSocket({ type: "udp4", lookup: redirecting("localhost") as never });
    const result = await new Promise<string>((resolve) => {
      connecting.once("error", (e: NodeJS.ErrnoException) => resolve(String(e.code)));
      connecting.once("connect", () => resolve("connected"));
      connecting.connect(9, "localhost");
    });
    connecting.close();
    expect(result).toBe(BLOCKED);
  });

  // Recommended, fixed (ADR-0005 listed it as a limit): `new dgram.Socket({ lookup })` bypasses the createSocket
  // wrapper, and its lookup can send «localhost» or even the literal 127.0.0.1 to an outside address (verified).
  it("the Socket constructor gets the same lookup guard as createSocket", async () => {
    const named = new UdpSocket({ type: "udp4", lookup: redirecting("localhost") as never });
    expect(await udpSend(named, "localhost")).toBe(BLOCKED);
    const server = dgram.createSocket("udp4");
    server.bind(0, "127.0.0.1");
    await once(server, "listening");
    const received = once(server, "message");
    const literal = new UdpSocket({ type: "udp4", lookup: redirecting("127.0.0.1") as never });
    expect(await udpSend(literal, "127.0.0.1", server.address().port)).toBe("sent");
    const timeout = new Promise((resolve) => setTimeout(() => resolve("not received"), 1_000));
    expect(await Promise.race([received.then(() => "received"), timeout])).toBe("received");
    server.close();
  });

  it("the guards keep dgram's types intact", () => {
    expect(dgram.createSocket("udp4")).toBeInstanceOf(dgram.Socket);
  });

  it("a blocked connect() emits 'error' and never calls the connect callback", async () => {
    const socket = dgram.createSocket("udp4");
    let called = false;
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      socket.once("error", resolve);
      socket.connect(9, OUTSIDE, () => {
        called = true;
      });
    });
    socket.close();
    expect(error.code).toBe(BLOCKED);
    expect(called).toBe(false);
  });
});

describe("security ARC-05 r3: dns.lookupService", () => {
  it("is blocked for an outside address in the callback and promise forms", async () => {
    const viaCallback = await new Promise<Error | null>((resolve) =>
      dns.lookupService(OUTSIDE, 22, (e) => resolve(e)),
    );
    expect(code(viaCallback)).toBe(BLOCKED);
    await expect(dns.promises.lookupService(OUTSIDE, 22)).rejects.toMatchObject({ code: BLOCKED });
    await expect(dns.promises.lookupService(`::ffff:${OUTSIDE}`, 22)).rejects.toMatchObject({
      code: BLOCKED,
    });
  });

  it("is allowed for loopback", async () => {
    const error = await dns.promises.lookupService("127.0.0.1", 22).then(
      () => null,
      (e: unknown) => e,
    );
    expect(code(error)).not.toBe(BLOCKED);
  });
});

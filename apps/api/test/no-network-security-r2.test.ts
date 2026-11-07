import dgram from "node:dgram";
import dns, { lookup as namedLookup, resolve4 as namedResolve4 } from "node:dns";
import { resolve4 as namedPromiseResolve4 } from "node:dns/promises";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { isAllowedHost } from "../../../tools/test-guards/no-network.mjs";

// Security review of ARC-05 (PR #84), round 2: the IP-literal checks, the lookup wrapper, UDP and DNS.

const OUTSIDE = "203.0.113.10";
const BLOCKED = "WS_NETWORK_BLOCKED";

function outcome(socket: net.Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("error", (e: NodeJS.ErrnoException) => resolve(String(e.code)));
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
  });
}

/** A lookup that answers with the given addresses (all forms Node may ask for). */
function fakeLookup(addresses: readonly string[]): net.LookupFunction {
  return ((_h: string, o: dns.LookupOptions, cb: (...a: unknown[]) => void) =>
    o.all
      ? cb(
          null,
          addresses.map((address) => ({ address, family: net.isIP(address) })),
        )
      : cb(null, addresses[0], net.isIP(addresses[0]!))) as net.LookupFunction;
}

const code = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;

describe("security ARC-05 r2: IP literals", () => {
  it("only 127.0.0.0/8 and 0.0.0.0 among IPv4 literals", () => {
    const none = new Set<string>();
    for (const ok of ["127.0.0.1", "127.255.255.254", "0.0.0.0"])
      expect(isAllowedHost(ok, none), ok).toBe(true);
    for (const bad of [
      "12.0.0.1",
      "126.0.0.1",
      "128.0.0.1",
      "0.1.2.3",
      "10.0.0.1",
      "169.254.169.254",
      "255.255.255.255",
      "1.27.0.0",
    ])
      expect(isAllowedHost(bad, none), bad).toBe(false);
  });

  it("a numeric-string port is a port, not a Unix socket path", async () => {
    expect(await outcome(net.connect("443" as unknown as number, OUTSIDE))).toBe(BLOCKED);
    const direct = new net.Socket();
    direct.connect("443" as unknown as number, OUTSIDE);
    expect(await outcome(direct)).toBe(BLOCKED);
  });
});

describe("security ARC-05 r2: the loopback-only lookup", () => {
  it("every answer must be loopback, in any order", async () => {
    for (const answers of [
      [OUTSIDE],
      ["127.0.0.1", OUTSIDE],
      [OUTSIDE, "127.0.0.1"],
      ["::1", `::ffff:${OUTSIDE}`],
    ])
      expect(
        await outcome(net.connect({ host: "localhost", port: 443, lookup: fakeLookup(answers) })),
        answers.join(),
      ).toBe(BLOCKED);
  });

  it("also when Socket#connect is called directly with plain options", async () => {
    const socket = new net.Socket();
    socket.connect({ host: "localhost", port: 443, lookup: fakeLookup([OUTSIDE]) });
    expect(await outcome(socket)).toBe(BLOCKED);
  });

  // Non-blocking, fixed: a UDP socket created with its own `lookup` sends to «localhost» wherever that lookup says.
  it("a UDP socket with a custom lookup cannot reach a non-loopback address through «localhost»", async () => {
    const socket = dgram.createSocket({ type: "udp4", lookup: fakeLookup([OUTSIDE]) as never });
    const error = await new Promise<Error | null>((resolve) =>
      socket.send("x", 9, "localhost", (e) => resolve(e)),
    );
    socket.close();
    expect(code(error)).toBe(BLOCKED);
  });
});

describe("security ARC-05 r2: UDP", () => {
  const passThrough = ((h: string, _o: unknown, cb: (...a: unknown[]) => void) => cb(null, h, 4)) as never;
  it("every send form and connect() to an outside address are blocked", async () => {
    const send = (fn: (s: dgram.Socket, cb: (e: Error | null) => void) => void) =>
      new Promise<Error | null>((resolve) => {
        // A pass-through lookup: the UDP guard itself must block (not only the guarded dns.lookup behind it).
        const s = dgram.createSocket({ type: "udp4", lookup: passThrough });
        fn(s, (e) => {
          s.close();
          resolve(e);
        });
      });
    expect(code(await send((s, cb) => s.send("x", 53, OUTSIDE, cb)))).toBe(BLOCKED);
    expect(code(await send((s, cb) => s.send(Buffer.from("xyz"), 0, 3, 53, OUTSIDE, cb)))).toBe(BLOCKED);
    expect(code(await send((s, cb) => s.send(["x", "y"], 53, OUTSIDE, cb)))).toBe(BLOCKED);
    const connected = await new Promise<unknown>((resolve) => {
      const s = dgram.createSocket({ type: "udp4", lookup: passThrough });
      s.once("error", (e) => {
        s.close();
        resolve(e);
      });
      // Node calls connect's callback only on success; a blocked connect emits «error» like a real failure.
      s.connect(53, OUTSIDE, ((error?: Error) => {
        s.close();
        resolve(error ?? null);
      }) as () => void);
    });
    expect(code(connected)).toBe(BLOCKED);
  });
});

describe("security ARC-05 r2: DNS", () => {
  const viaCallback = (fn: (cb: (e: Error | null) => void) => void) =>
    new Promise<Error | null>((resolve) => fn((e) => resolve(e)));

  it("callback forms: dns.lookup, dns.resolve*, dns.reverse and a Resolver", async () => {
    expect(code(await viaCallback((cb) => dns.lookup("example.com", cb)))).toBe(BLOCKED);
    expect(code(await viaCallback((cb) => dns.lookup("example.com", { all: true }, cb)))).toBe(BLOCKED);
    expect(code(await viaCallback((cb) => dns.resolve4("example.com", cb)))).toBe(BLOCKED);
    expect(code(await viaCallback((cb) => dns.resolve("example.com", "TXT", cb)))).toBe(BLOCKED);
    expect(code(await viaCallback((cb) => dns.reverse(OUTSIDE, cb)))).toBe(BLOCKED);
    expect(code(await viaCallback((cb) => new dns.Resolver().resolve4("example.com", cb)))).toBe(BLOCKED);
  });

  it("promise forms: dns.promises and its Resolver", async () => {
    await expect(dns.promises.lookup("example.com")).rejects.toMatchObject({ code: BLOCKED });
    await expect(new dns.promises.Resolver().resolveTxt("example.com")).rejects.toMatchObject({
      code: BLOCKED,
    });
  });

  it("ESM named imports of node:dns and node:dns/promises are the guarded functions", async () => {
    expect(code(await viaCallback((cb) => namedLookup("example.com", cb)))).toBe(BLOCKED);
    expect(code(await viaCallback((cb) => namedResolve4("example.com", cb)))).toBe(BLOCKED);
    await expect(namedPromiseResolve4("example.com")).rejects.toMatchObject({ code: BLOCKED });
  });

  it("local names still resolve (the guard does not break localhost)", async () => {
    const { address } = await dns.promises.lookup("localhost");
    expect(["127.0.0.1", "::1"]).toContain(address);
  });
});

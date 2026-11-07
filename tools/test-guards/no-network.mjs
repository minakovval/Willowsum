// Створено: 2026-11-07 · Оновлено: 2026-11-07 (рецензії PR #84, три раунди)
//
// ARC-05 criterion «Тести, що потребують інтернету в CI — 0» (ADR-0005): a Vitest setup file that every
// package's test config loads. A test may reach only this machine and the PostgreSQL host of the integration
// tests (DATABASE_URL, PGHOST, WS_DB_HOST):
// - IP literals: loopback only (127.0.0.0/8, ::1, IPv4-mapped 127.x, the unspecified address);
// - names: `localhost` (which must always resolve to loopback, also when it is the database host) and the
//   database host (trusted by name, resolved by the system resolver — never by a custom lookup);
// - Unix sockets (a non-empty `path`).
// Anything else fails with WS_NETWORK_BLOCKED: fetch, http/https, TLS and raw TCP sockets before connecting,
// UDP datagrams before sending (a socket's own `lookup` — dgram.createSocket or new dgram.Socket — must answer
// loopback for localhost and is never used for the database host), DNS queries (dns.lookup,
// dns.lookupService, dns.resolve*, dns.promises, Resolver) before asking. Child processes a test starts are not
// covered. Working adapters are tested with an injected fetch (apps/api/src/platform/adapters/testing.ts).
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";

const INSTALLED = Symbol.for("willowsum.noNetworkGuard");

export class NetworkBlockedError extends Error {
  constructor(host, port) {
    super(
      `Tests may not reach the network (ARC-05): connection to ${host}${port ? `:${port}` : ""} blocked. ` +
        "Use the provider's test implementation or inject a fetch.",
    );
    this.name = "NetworkBlockedError";
    this.code = "WS_NETWORK_BLOCKED";
  }
}

function hostOf(value) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function allowedExtraHosts(env) {
  const hosts = new Set();
  for (const url of [env.DATABASE_URL, env.WS_MIGRATION_DATABASE_URL]) {
    const host = hostOf(url);
    if (host) hosts.add(host);
  }
  for (const host of [env.PGHOST, env.WS_DB_HOST]) if (host) hosts.add(host.toLowerCase());
  return hosts;
}

const LOCAL_IPS = new Set(["::1", "0.0.0.0", "::", "0:0:0:0:0:0:0:1"]);
const strip = (host) => String(host).replace(/^\[|\]$/g, "").toLowerCase();

/** A loopback address (an IP literal, never a name): 127.0.0.0/8, ::1, IPv4-mapped 127.x, unspecified. */
export function isLoopbackAddress(address) {
  const a = strip(address);
  const version = net.isIP(a);
  if (version === 4) return a.startsWith("127.") || a === "0.0.0.0";
  if (version === 6) return LOCAL_IPS.has(a) || /^::ffff:127\./.test(a);
  return false;
}

/**
 * Hosts a test may name. `*.localhost` is not allowed: the system resolver may send such names to DNS.
 * The database host is matched by its exact name.
 */
export function isAllowedHost(host, extra = allowedExtraHosts(process.env)) {
  // No host means the default, localhost.
  if (host === undefined || host === null || host === "") return true;
  const h = strip(host);
  if (extra.has(h)) return true;
  if (net.isIP(h)) return isLoopbackAddress(h);
  return h === "localhost";
}

/** Must the resolved address of this allowed name also be checked? Yes, except for the database host. */
function needsLoopbackLookup(host) {
  if (host === undefined || host === null || host === "") return false;
  const h = strip(host);
  if (net.isIP(h)) return false;
  // `localhost` always: being the database host too (CI: DATABASE_URL on localhost) must not exempt it.
  return h === "localhost" || !allowedExtraHosts(process.env).has(h);
}

/**
 * A local name is allowed by name, but it must also resolve to loopback (a hosts entry or a custom `lookup`
 * could point it anywhere). The database host is trusted by name: it may be a container on another address.
 */
function loopbackOnlyLookup(host, port, inner) {
  return function guardedLookup(hostname, options, callback) {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : (options ?? {});
    (inner ?? dns.lookup)(hostname, opts, (error, address, family) => {
      if (error) return cb(error);
      const list = Array.isArray(address) ? address : [{ address }];
      if (list.some((entry) => !isLoopbackAddress(entry.address))) return cb(new NetworkBlockedError(host, port));
      return cb(null, address, family);
    });
  };
}

/** Target of Socket#connect, from any of its call forms (incl. Node's internal normalized array). */
function targetOf(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first !== null && typeof first === "object") {
    // Node connects over TCP unless `path` is a non-empty string (an empty one means «no path»).
    if (typeof first.path === "string" && first.path !== "") return { local: true };
    return { host: first.host ?? first.hostname, port: first.port };
  }
  if (typeof first === "string" && first !== "" && Number.isNaN(Number(first))) return { local: true }; // IPC
  return { host: typeof args[1] === "string" ? args[1] : undefined, port: first };
}

function guardSockets() {
  const proto = net.Socket.prototype;
  const originalConnect = proto.connect;
  proto.connect = function guardedConnect(...args) {
    const target = targetOf(args);
    if (target.local) return originalConnect.apply(this, args);
    if (!isAllowedHost(target.host)) {
      const error = new NetworkBlockedError(target.host, target.port);
      process.nextTick(() => this.destroy(error));
      return this;
    }
    const custom = (Array.isArray(args[0]) ? args[0][0] : args[0])?.lookup;
    if (needsLoopbackLookup(target.host) || typeof custom === "function") {
      // Rewrite to the options form: a local name gets a lookup that refuses non-loopback answers; the database
      // host (trusted by name) gets the system resolver, never a custom lookup.
      const normalized = Array.isArray(args[0]) ? args[0] : undefined;
      const options = normalized
        ? normalized[0]
        : typeof args[0] === "object"
          ? args[0]
          : { port: args[0], host: args[1] };
      const checked = {
        ...options,
        lookup: needsLoopbackLookup(target.host)
          ? loopbackOnlyLookup(target.host, target.port, options.lookup)
          : undefined,
      };
      if (normalized) {
        normalized[0] = checked;
        return originalConnect.apply(this, args);
      }
      const callback = args.find((a) => typeof a === "function");
      return originalConnect.apply(this, callback ? [checked, callback] : [checked]);
    }
    return originalConnect.apply(this, args);
  };
}

function guardDatagrams() {
  // A socket with its own `lookup` (dgram.createSocket or new dgram.Socket): an allowed name (localhost) must
  // still resolve to loopback, and the database host goes through the system resolver.
  const guardOptions = (options) => {
    if (options === null || typeof options !== "object" || typeof options.lookup !== "function") return options;
    const inner = options.lookup;
    const lookup = function guardedDgramLookup(hostname, family, callback) {
      // An IP literal (e.g. the implicit bind to 0.0.0.0) is its own answer, whatever the lookup says.
      const literal = net.isIP(strip(hostname ?? ""));
      if (literal) return process.nextTick(() => callback(null, strip(hostname), literal));
      if (!needsLoopbackLookup(hostname)) return dns.lookup(hostname, family, callback);
      return loopbackOnlyLookup(hostname, undefined, inner)(hostname, family, callback);
    };
    return { ...options, lookup };
  };
  const originalCreate = dgram.createSocket;
  dgram.createSocket = function guardedCreateSocket(options, ...rest) {
    return originalCreate.call(this, guardOptions(options), ...rest);
  };
  const OriginalSocket = dgram.Socket;
  function GuardedSocket(options, listener) {
    return Reflect.construct(OriginalSocket, [guardOptions(options), listener], new.target ?? GuardedSocket);
  }
  GuardedSocket.prototype = OriginalSocket.prototype;
  Object.setPrototypeOf(GuardedSocket, OriginalSocket);
  dgram.Socket = GuardedSocket;
  const proto = dgram.Socket.prototype;
  const blocked = (socket, host, port, callback) => {
    const error = new NetworkBlockedError(host, port);
    if (typeof callback === "function") process.nextTick(() => callback(error));
    else process.nextTick(() => socket.emit("error", error));
  };
  const originalSend = proto.send;
  proto.send = function guardedSend(...args) {
    // send(msg[, offset, length][, port][, address][, callback]): the address is the only string after msg.
    const address = args.slice(1).find((a) => typeof a === "string");
    const port = args.slice(1).find((a) => typeof a === "number");
    if (address !== undefined && !isAllowedHost(address)) {
      return blocked(this, address, port, args.find((a) => typeof a === "function"));
    }
    return originalSend.apply(this, args);
  };
  const originalConnect = proto.connect;
  proto.connect = function guardedConnect(port, address, callback) {
    if (typeof address === "string" && !isAllowedHost(address)) {
      // Like a real failure: Node calls connect's callback only on success, so the error is emitted.
      return blocked(this, address, port, undefined);
    }
    return originalConnect.apply(this, [port, address, callback].filter((a) => a !== undefined));
  };
}

const RESOLVE_METHODS = [
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
];

/** A DNS question about `name` is allowed only for an allowed host (a loopback literal, localhost, the DB host). */
function guardDns() {
  const wrapCallback = (target, method) => {
    const original = target[method];
    if (typeof original !== "function") return;
    target[method] = function guardedDns(name, ...rest) {
      if (!isAllowedHost(name)) {
        const callback = rest.find((a) => typeof a === "function");
        const error = new NetworkBlockedError(name);
        if (callback) {
          process.nextTick(() => callback(error));
          return undefined;
        }
        throw error;
      }
      return original.call(this, name, ...rest);
    };
  };
  const wrapPromise = (target, method) => {
    const original = target[method];
    if (typeof original !== "function") return;
    target[method] = async function guardedDnsPromise(name, ...rest) {
      if (!isAllowedHost(name)) throw new NetworkBlockedError(name);
      return original.call(this, name, ...rest);
    };
  };
  for (const method of ["lookup", "lookupService", ...RESOLVE_METHODS]) {
    wrapCallback(dns, method);
    wrapPromise(dns.promises, method);
  }
  for (const method of RESOLVE_METHODS) {
    wrapCallback(dns.Resolver.prototype, method);
    wrapPromise(dns.promises.Resolver.prototype, method);
  }
}

export function installNetworkGuard() {
  if (!net.Socket.prototype[INSTALLED]) {
    guardSockets();
    guardDatagrams();
    guardDns();
    // ESM named imports of node:dns (`import { lookup } from "node:dns"`) see the guarded functions too.
    syncBuiltinESMExports();
    net.Socket.prototype[INSTALLED] = true;
  }
  const currentFetch = globalThis.fetch;
  if (typeof currentFetch === "function" && !currentFetch[INSTALLED]) {
    const guardedFetch = async function guardedFetch(input, init) {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      let url;
      try {
        url = new URL(raw);
      } catch {
        return currentFetch(input, init);
      }
      if ((url.protocol === "http:" || url.protocol === "https:") && !isAllowedHost(url.hostname)) {
        throw new NetworkBlockedError(url.hostname, url.port);
      }
      return currentFetch(input, init);
    };
    guardedFetch[INSTALLED] = true;
    globalThis.fetch = guardedFetch;
  }
}

installNetworkGuard();

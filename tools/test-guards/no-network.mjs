// Створено: 2026-11-07 · Оновлено: 2026-11-07
//
// ARC-05 criterion «Тести, що потребують інтернету в CI — 0» (ADR-0005): a Vitest setup file that every
// package's test config loads. A test may reach only this machine (localhost, 127.0.0.0/8, ::1, Unix
// sockets) and the PostgreSQL host of the integration tests (DATABASE_URL, PGHOST, WS_DB_HOST); any other
// connection — through fetch, http/https, a raw socket or TLS — fails with WS_NETWORK_BLOCKED before DNS or
// a packet. Working adapters are tested with an injected fetch (apps/api/src/platform/adapters/testing.ts).
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

const LOCAL = new Set(["localhost", "::1", "0.0.0.0", "::", "0:0:0:0:0:0:0:1"]);

export function isAllowedHost(host, extra = allowedExtraHosts(process.env)) {
  // No host means the default, localhost.
  if (host === undefined || host === null || host === "") return true;
  const h = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  return LOCAL.has(h) || /^127\./.test(h) || /^::ffff:127\./.test(h) || h.endsWith(".localhost") || extra.has(h);
}

/** Target of Socket#connect, from any of its call forms (incl. Node's internal normalized array). */
function targetOf(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first !== null && typeof first === "object") {
    if (typeof first.path === "string") return { local: true };
    return { host: first.host ?? first.hostname, port: first.port };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { local: true }; // IPC path
  return { host: typeof args[1] === "string" ? args[1] : undefined, port: first };
}

export function installNetworkGuard() {
  const proto = net.Socket.prototype;
  if (!proto[INSTALLED]) {
    const originalConnect = proto.connect;
    proto.connect = function guardedConnect(...args) {
      const target = targetOf(args);
      if (!target.local && !isAllowedHost(target.host)) {
        const error = new NetworkBlockedError(target.host, target.port);
        process.nextTick(() => this.destroy(error));
        return this;
      }
      return originalConnect.apply(this, args);
    };
    proto[INSTALLED] = true;
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

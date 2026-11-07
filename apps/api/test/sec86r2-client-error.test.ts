import { connect, type AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { API_SECURITY_HEADERS, HSTS_HEADER, HSTS_VALUE } from "../src/platform/http/security-headers.ts";
import { buildServer } from "../src/platform/process/server.ts";

/**
 * Security review of PR #86, round 2 (NFR-14 FR 1): buildServer's clientErrorHandler answers the requests Node
 * cannot parse — with the security headers, without anything of the request, on a closed connection.
 */
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(hsts: boolean): Promise<FastifyInstance> {
  app = buildServer({ readiness: async () => ({ ready: true }), hsts });
  await app.ready();
  return app;
}

/** A stand-in for the socket Node hands to `clientError`: records what is written and whether it is closed. */
function fakeSocket(options: { bytesWritten?: number; writable?: boolean } = {}) {
  const socket = {
    written: [] as string[],
    destroyed: false,
    destroyedWith: undefined as unknown,
    writable: options.writable ?? true,
    bytesWritten: options.bytesWritten ?? 0,
    write(chunk: string) {
      socket.written.push(chunk);
      return true;
    },
    destroy(error?: unknown) {
      socket.destroyed = true;
      socket.destroyedWith = error;
      return socket;
    },
    // Node may add listeners or end the socket; neither must be needed for the answer.
    on: () => socket,
    once: () => socket,
    end: () => socket,
  };
  return socket;
}

function clientError(server: FastifyInstance, code: string, extra: Record<string, unknown> = {}) {
  const socket = fakeSocket(extra as { bytesWritten?: number; writable?: boolean });
  const error = Object.assign(new Error(`parse failure near zq-request-marker`), {
    code,
    rawPacket: Buffer.from("GET /v1/zq-request-marker?token=zq-secret HTTP/1.1\r\ncookie: zq-cookie\r\n"),
  });
  server.server.emit("clientError", error, socket);
  return socket;
}

describe("NFR-14 FR 1: Node-level client errors (round 2)", () => {
  it.each([
    ["HPE_INVALID_METHOD", 400, "Bad Request"],
    ["HPE_HEADER_OVERFLOW", 431, "Request Header Fields Too Large"],
    ["ERR_HTTP_REQUEST_TIMEOUT", 408, "Request Timeout"],
  ])(
    "%s → %i with every security header, connection: close, then the socket is destroyed",
    async (code, status, reason) => {
      const server = await serve(true);
      const socket = clientError(server, code);
      expect(socket.written).toHaveLength(1);
      const answer = socket.written[0]!;
      expect(answer.startsWith(`HTTP/1.1 ${status} ${reason}\r\n`)).toBe(true);
      const head = answer.slice(0, answer.indexOf("\r\n\r\n")).toLowerCase();
      for (const [name, value] of Object.entries(API_SECURITY_HEADERS))
        expect(head).toContain(`\r\n${name}: ${value.toLowerCase()}`);
      expect(head).toContain(`\r\n${HSTS_HEADER}: ${HSTS_VALUE.toLowerCase()}`);
      expect(head).toContain("\r\nconnection: close");
      const body = answer.slice(answer.indexOf("\r\n\r\n") + 4);
      expect(head).toContain(`\r\ncontent-length: ${Buffer.byteLength(body)}`);
      expect(JSON.parse(body)).toEqual({ status, title: reason });
      expect(socket.destroyed).toBe(true);
    },
  );

  it("nothing of the request (path, query, cookie, parser message) is echoed", async () => {
    const server = await serve(true);
    for (const code of ["HPE_INVALID_METHOD", "HPE_HEADER_OVERFLOW", "ERR_HTTP_REQUEST_TIMEOUT"]) {
      const answer = clientError(server, code).written.join("");
      for (const marker of ["zq-request-marker", "zq-secret", "zq-cookie", "parse failure"])
        expect(answer, code).not.toContain(marker);
    }
  });

  it("locally (HSTS off) the answer carries no HSTS header", async () => {
    const server = await serve(false);
    const answer = clientError(server, "HPE_INVALID_METHOD").written.join("").toLowerCase();
    expect(answer).not.toContain(HSTS_HEADER.toLowerCase());
    for (const name of Object.keys(API_SECURITY_HEADERS)) expect(answer).toContain(`\r\n${name}: `);
  });

  it("after part of a response went out, or on a reset / destroyed socket, nothing is written", async () => {
    const server = await serve(true);
    const midResponse = clientError(server, "ERR_HTTP_REQUEST_TIMEOUT", { bytesWritten: 120 });
    expect(midResponse.written).toEqual([]);
    expect(midResponse.destroyed).toBe(true);
    const notWritable = clientError(server, "HPE_INVALID_METHOD", { writable: false });
    expect(notWritable.written).toEqual([]);
    expect(notWritable.destroyed).toBe(true);
    const reset = clientError(server, "ECONNRESET");
    expect(reset.written).toEqual([]);
  });

  it("on a real connection the server closes the socket itself after a malformed request (no idle half-open socket)", async () => {
    const server = await serve(false);
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    const outcome = await new Promise<{ closedByServer: boolean; out: string }>((resolve) => {
      let out = "";
      const socket = connect(port, "127.0.0.1", () =>
        socket.write("GET /v1/meta HTTP/1.1\r\nhost: x\r\nbad header: y\r\n\r\n"),
      );
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ closedByServer: false, out });
      }, 2_000);
      socket.on("data", (d) => (out += d.toString("latin1")));
      const done = () => {
        clearTimeout(timer);
        resolve({ closedByServer: true, out });
      };
      socket.on("end", done);
      socket.on("close", done);
      socket.on("error", done);
    });
    expect(outcome.out).toMatch(/^HTTP\/1\.1 400 /);
    expect(outcome.closedByServer).toBe(true);
  });
});

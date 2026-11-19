import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ApiProblem } from "./problem.ts";
import { OVER_LIMIT_LINGER_MS, uploadInput } from "./upload.ts";

/**
 * Security review of PR #599: the «lingering close» after 413 is bounded. A client that never stops sending is cut off
 * `OVER_LIMIT_LINGER_MS` after the limit, and nothing past the limit reaches a file.
 */
describe("NFR-15@PoC FR 18: the read after 413 is bounded (security review of PR 599)", () => {
  it(
    "NFR-15@PoC FR 18: a client that keeps sending after the limit gets 413 and its connection ends within the linger time",
    async () => {
      const limit = 64 * 1024;
      let stored = 0;
      const server = createServer((req, res) => {
        void (async () => {
          try {
            for await (const part of uploadInput(req, req.headers, { maxFiles: 5, maxBytes: limit }).files)
              for await (const c of part.stream) stored += c.length;
            res.writeHead(201).end();
          } catch (error) {
            res
              .writeHead(error instanceof ApiProblem && error.code === "PAYLOAD_TOO_LARGE" ? 413 : 500)
              .end();
          }
        })();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const started = Date.now();
        const outcome = await new Promise<{ head: string; closedAfterMs: number }>((resolve) => {
          const socket = connect(port, "127.0.0.1");
          let head = "";
          socket.on("data", (c) => (head += c.toString("latin1")));
          socket.on("error", () => undefined);
          socket.on("close", () => {
            clearInterval(timer);
            resolve({ head, closedAfterMs: Date.now() - started });
          });
          socket.write(
            "POST / HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=b\r\nTransfer-Encoding: chunked\r\n\r\n",
          );
          const part = Buffer.from(
            '--b\r\nContent-Disposition: form-data; name="files"; filename="big.csv"\r\n\r\n',
          );
          socket.write(`${part.length.toString(16)}\r\n`);
          socket.write(part);
          socket.write("\r\n");
          const chunk = Buffer.alloc(16 * 1024, 0x61);
          // Never ends the request: 16 KiB every 20 ms, far past the limit, for as long as the socket lives.
          const timer = setInterval(() => {
            if (socket.destroyed) return;
            socket.write(`${chunk.length.toString(16)}\r\n`);
            socket.write(chunk);
            socket.write("\r\n");
          }, 20);
        });
        expect(outcome.head.startsWith("HTTP/1.1 413")).toBe(true);
        expect(outcome.closedAfterMs).toBeGreaterThanOrEqual(OVER_LIMIT_LINGER_MS - 500);
        expect(outcome.closedAfterMs).toBeLessThan(OVER_LIMIT_LINGER_MS + 2_500);
        expect(stored).toBeLessThanOrEqual(limit);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    OVER_LIMIT_LINGER_MS + 10_000,
  );
});

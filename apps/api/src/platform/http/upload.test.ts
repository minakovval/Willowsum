import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiProblem } from "./problem.ts";
import { defineRoute, DOWNLOAD_RESPONSE } from "./route.ts";
import { uploadInput } from "./upload.ts";

/** ARC-06@PoC FR 4, NFR-15@PoC FR 18: upload routes read multipart files on the stream; downloads are bytes. */
function multipart(parts: readonly { name: string; bytes: Buffer; field?: boolean }[]) {
  const boundary = "ws-boundary";
  const chunks = parts.flatMap((p) => [
    Buffer.from(
      p.field
        ? `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n`
        : `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${p.name}"\r\n\r\n`,
    ),
    p.bytes,
    Buffer.from("\r\n"),
  ]);
  const body = Buffer.concat([...chunks, Buffer.from(`--${boundary}--\r\n`)]);
  const headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length),
  };
  return { raw: Readable.from([body]), headers, length: body.length };
}

async function collect(
  raw: Readable,
  headers: Record<string, string>,
  limits = { maxFiles: 5, maxBytes: 1 << 20 },
) {
  const out: { name: string; text: string }[] = [];
  for await (const part of uploadInput(raw, headers, limits).files) {
    const chunks: Buffer[] = [];
    for await (const c of part.stream) chunks.push(Buffer.from(c));
    out.push({ name: part.fileName, text: Buffer.concat(chunks).toString("utf8") });
  }
  return out;
}

describe("ARC-06@PoC FR 4: the files of an upload request, one by one on the stream", () => {
  it("ARC-06@PoC FR 4: files come in order with their names and bytes; the declared length is passed on", async () => {
    const m = multipart([
      { name: "a.csv", bytes: Buffer.from("x,1") },
      { name: "b.tsv", bytes: Buffer.from("y\t2") },
    ]);
    expect(uploadInput(m.raw, m.headers, { maxFiles: 5, maxBytes: 1 << 20 }).declaredBytes).toBe(m.length);
    const again = multipart([
      { name: "a.csv", bytes: Buffer.from("x,1") },
      { name: "b.tsv", bytes: Buffer.from("y\t2") },
    ]);
    expect(await collect(again.raw, again.headers)).toEqual([
      { name: "a.csv", text: "x,1" },
      { name: "b.tsv", text: "y\t2" },
    ]);
  });

  it("ARC-06@PoC FR 4: a file the reader skips (`destroy`) does not stop the next one", async () => {
    const m = multipart([
      { name: "skip.csv", bytes: Buffer.alloc(200_000, 0x61) },
      { name: "next.csv", bytes: Buffer.from("ok") },
    ]);
    const seen: string[] = [];
    for await (const part of uploadInput(m.raw, m.headers, { maxFiles: 5, maxBytes: 1 << 20 }).files) {
      if (part.fileName === "skip.csv") {
        part.stream.destroy();
        continue;
      }
      const chunks: Buffer[] = [];
      for await (const c of part.stream) chunks.push(Buffer.from(c));
      seen.push(Buffer.concat(chunks).toString());
    }
    expect(seen).toEqual(["ok"]);
  });

  it("NFR-15@PoC FR 18: the request's bytes are counted on the raw stream, skipped files too — over the limit, 413", async () => {
    const m = multipart([
      { name: "big.csv", bytes: Buffer.alloc(300_000, 0x61) },
      { name: "b.csv", bytes: Buffer.from("x") },
    ]);
    const err = await collect(m.raw, m.headers, { maxFiles: 5, maxBytes: 100_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiProblem);
    expect((err as ApiProblem).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("NFR-15@PoC FR 18: over the limit on a real socket the client still gets its 413, not a reset (issue 582)", async () => {
    const limit = 64 * 1024;
    let stored = 0;
    const server = createServer((req, res) => {
      void (async () => {
        try {
          for await (const part of uploadInput(req, req.headers, { maxFiles: 5, maxBytes: limit }).files)
            for await (const c of part.stream) stored += c.length;
          res.writeHead(201).end();
        } catch (error) {
          res.writeHead(error instanceof ApiProblem && error.code === "PAYLOAD_TOO_LARGE" ? 413 : 500).end();
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const boundary = "ws-boundary";
      const outcome = await new Promise<string>((resolve) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: "/",
            headers: {
              "content-type": `multipart/form-data; boundary=${boundary}`,
              "transfer-encoding": "chunked",
            },
          },
          (res) => {
            res.resume();
            resolve(`status ${res.statusCode}`);
          },
        );
        req.on("error", (e: NodeJS.ErrnoException) => resolve(`socket ${e.code}`));
        req.write(
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="big.csv"\r\n\r\n`,
        );
        const chunk = Buffer.alloc(16 * 1024, 0x61);
        let sent = 0;
        const pump = (): void => {
          while (sent < 4 * 1024 * 1024) {
            if (req.destroyed) return;
            sent += chunk.length;
            if (!req.write(chunk)) {
              req.once("drain", pump);
              return;
            }
          }
          req.end(`\r\n--${boundary}--\r\n`);
        };
        pump();
      });
      expect(outcome).toBe("status 413");
      expect(stored).toBeLessThanOrEqual(limit);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("ARC-06@PoC FR 4: a field instead of a file is refused; more files than the route takes is 413", async () => {
    const field = multipart([{ name: "note", bytes: Buffer.from("hi"), field: true }]);
    expect(((await collect(field.raw, field.headers).catch((e: unknown) => e)) as ApiProblem).code).toBe(
      "VALIDATION_FAILED",
    );
    const many = multipart([1, 2, 3].map((i) => ({ name: `${i}.csv`, bytes: Buffer.from("x") })));
    const err = await collect(many.raw, many.headers, { maxFiles: 2, maxBytes: 1 << 20 }).catch(
      (e: unknown) => e,
    );
    expect((err as ApiProblem).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("ARC-06@PoC FR 4: defineRoute keeps uploads to POST with the upload rate limit and downloads to GET", () => {
    const base = {
      module: "import-sessions",
      operationId: "x",
      summary: "x",
      access: { permission: "household.data.read", feature: "data.import" },
      handler: async () => ({}),
    } as const;
    const json = { status: 200 as const, description: "x", schema: z.object({}) };
    const limits = { maxFiles: 1, maxBytes: 1 };
    expect(() =>
      defineRoute({ ...base, method: "GET", path: "/v1/x", response: json, upload: limits }),
    ).toThrow();
    expect(() =>
      defineRoute({ ...base, method: "POST", path: "/v1/x", response: json, upload: limits }),
    ).toThrow(/rate-limit class upload/);
    expect(() =>
      defineRoute({
        ...base,
        method: "POST",
        path: "/v1/x",
        response: json,
        upload: limits,
        rateLimit: "upload",
      }),
    ).not.toThrow();
    const bytes = { status: 200 as const, description: "x", schema: DOWNLOAD_RESPONSE };
    const file = async () => ({ status: 200 as const, headers: {}, body: Buffer.from("x") });
    expect(() =>
      defineRoute({ ...base, method: "POST", path: "/v1/x", response: bytes, download: true, handler: file }),
    ).toThrow();
    expect(() =>
      defineRoute({ ...base, method: "GET", path: "/v1/x", response: json, download: true }),
    ).toThrow();
    expect(() =>
      defineRoute({ ...base, method: "GET", path: "/v1/x", response: bytes, download: true, handler: file }),
    ).not.toThrow();
  });
});

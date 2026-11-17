import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileRejectedError, PARSE_CEILINGS } from "../../domain/index.ts";
import { csv, xlsx } from "../../synthetic-files.ts";
import { isolatedInspector } from "./run.ts";

const fixture = (name: string) =>
  new URL(`../../../../../test/fixtures/file-storage/${name}`, import.meta.url);

let server: Server;
let port: number;

beforeAll(async () => {
  // Stands for the API: it must keep answering while a parse fails.
  server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function ping(): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  return res.text();
}

describe("parsing in a separate worker (ARC-06@PoC FR 4, IMP-01@PoC FR 13)", () => {
  it("ARC-06@PoC FR 4: the limits of the parsing worker are 512 MiB and 60 s", () => {
    expect(PARSE_CEILINGS.memoryMb).toBe(512);
    expect(PARSE_CEILINGS.timeoutMs).toBe(60_000);
  });

  it("ARC-06@PoC FR 4: an accepted file is inspected in the worker", async () => {
    const inspector = isolatedInspector();
    await expect(inspector.inspect(csv())).resolves.toMatchObject({ format: "csv", rows: 3 });
    await expect(inspector.inspect(xlsx())).resolves.toMatchObject({ format: "xlsx" });
    const err = await inspector.inspect(Buffer.from("%PDF-1.4\n")).catch((e: unknown) => e);
    expect((err as FileRejectedError).code).toBe("UNSUPPORTED_FORMAT");
  });

  it("ARC-06@PoC FR 4, criterion «Розбір в окремому процесі»: a parse over the memory limit ends only its worker, the file is rejected and the API answers", async () => {
    const inspector = isolatedInspector({ memoryMb: 64, workerUrl: fixture("hog-worker.ts") });
    const parse = inspector.inspect(csv()).catch((e: unknown) => e);
    expect(await ping()).toBe("ok");
    const err = await parse;
    expect(err).toBeInstanceOf(FileRejectedError);
    expect((err as FileRejectedError).code).toBe("PARSE_MEMORY");
    expect((err as FileRejectedError).rejection.ceiling).toEqual({ name: "parseMemoryMb", limit: 512 });
    expect(await ping()).toBe("ok");
    // The next file is parsed as usual.
    await expect(isolatedInspector().inspect(csv())).resolves.toMatchObject({ format: "csv" });
  }, 60_000);

  it("ARC-06@PoC FR 4, criterion «Розбір в окремому процесі»: a parse over the time limit ends only its worker, the file is rejected and the API answers", async () => {
    const inspector = isolatedInspector({ timeoutMs: 500, workerUrl: fixture("spin-worker.ts") });
    const parse = inspector.inspect(csv()).catch((e: unknown) => e);
    expect(await ping()).toBe("ok");
    const err = await parse;
    expect((err as FileRejectedError).code).toBe("PARSE_TIMEOUT");
    expect((err as FileRejectedError).rejection.message.uk).toBe(
      "Розбір триває занадто довго (понад 60 с). Розділіть файл, наприклад за періодом, і завантажте частини.",
    );
    expect(await ping()).toBe("ok");
  }, 30_000);
});

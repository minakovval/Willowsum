import type { IncomingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";
import { Busboy } from "@fastify/busboy";
import { ApiProblem } from "./problem.ts";
import type { UploadInput, UploadPart } from "./route.ts";

/**
 * The files of an upload route's request (ARC-06 FR 4, NFR-15 FR 18): `multipart/form-data` read by `@fastify/busboy`
 * (MIT, the multipart reader of Fastify and undici, no dependencies) straight from the request stream. Files come one
 * by one, each as a stream the module reads under its own size budget; nothing is buffered here. Fields, more than
 * `maxFiles` files or more than `maxBytes` bytes of the request (counted on the raw stream, skipped files too) end the
 * request: 400 or 413, and the file being read fails with the same problem.
 */
export const MULTIPART_RE = /^multipart\/form-data\s*;/i;

export function uploadInput(
  raw: Readable,
  headers: IncomingHttpHeaders,
  limits: { readonly maxFiles: number; readonly maxBytes: number },
): UploadInput {
  const declared = Number(headers["content-length"]);
  return {
    declaredBytes: Number.isSafeInteger(declared) && declared >= 0 ? declared : undefined,
    files: readFiles(raw, headers, limits),
  };
}

async function* readFiles(
  raw: Readable,
  headers: IncomingHttpHeaders,
  limits: { readonly maxFiles: number; readonly maxBytes: number },
): AsyncGenerator<UploadPart> {
  let parser;
  try {
    parser = Busboy({
      headers: headers as IncomingHttpHeaders & { "content-type": string },
      limits: { files: limits.maxFiles, fields: 0, parts: limits.maxFiles, headerPairs: 20 },
    });
  } catch {
    throw new ApiProblem("MALFORMED_REQUEST");
  }
  const queue: (UploadPart | null)[] = [];
  let failure: ApiProblem | undefined;
  let current: Readable | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const fail = (problem: ApiProblem) => {
    failure ??= problem;
    current?.destroy(failure);
    raw.unpipe(parser);
    raw.resume();
    notify();
  };
  let total = 0;
  const count = (chunk: Buffer) => {
    total += chunk.length;
    if (total > limits.maxBytes) {
      fail(new ApiProblem("PAYLOAD_TOO_LARGE"));
      raw.destroy();
    }
  };
  raw.on("data", count);
  parser.on("file", (_field, stream, fileName) => {
    current = stream;
    // A file's stream fails with the request's problem (`fail`); its reader, if any, gets it from the iterator.
    stream.on("error", () => undefined);
    queue.push({
      fileName,
      stream: {
        // Not destroyed when the reader stops early: the rest of the file is skipped and the next one read.
        [Symbol.asyncIterator]: () => stream.iterator({ destroyOnReturn: false }),
        destroy: () => void stream.resume(),
      },
    });
    notify();
  });
  parser.on("field", () => fail(new ApiProblem("VALIDATION_FAILED")));
  parser.on("fieldsLimit", () => fail(new ApiProblem("VALIDATION_FAILED")));
  parser.on("filesLimit", () => fail(new ApiProblem("PAYLOAD_TOO_LARGE")));
  parser.on("partsLimit", () => fail(new ApiProblem("PAYLOAD_TOO_LARGE")));
  parser.on("error", () => fail(new ApiProblem("MALFORMED_REQUEST")));
  parser.on("finish", () => {
    queue.push(null);
    notify();
  });
  raw.on("aborted", () => fail(new ApiProblem("MALFORMED_REQUEST")));
  raw.pipe(parser);
  let finished = false;
  try {
    for (;;) {
      if (failure) throw failure;
      const next = queue.shift();
      if (next === undefined) {
        await new Promise<void>((resolve) => (wake = resolve));
        continue;
      }
      if (next === null) {
        finished = true;
        return;
      }
      yield next;
      next.stream.destroy();
    }
  } finally {
    if (!finished) {
      // The reader stopped (a problem or its own error): the rest of the request is drained, still counted.
      raw.unpipe(parser);
      current?.resume();
      raw.resume();
    }
  }
}

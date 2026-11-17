import { FILE_LIMITS, reject } from "../domain/index.ts";

/**
 * Sizes on the request stream (ARC-06@PoC FR 4, NFR-15@PoC FR 18): one budget per upload request, shared by its
 * files. The declared length of the request is refused at once when it is over 150 MiB; then each file is read
 * chunk by chunk and the reading stops — the stream is destroyed — as soon as the file passes 25 MiB or the request
 * passes 150 MiB, before the rest is buffered or its type is checked. Every upload path reads files through a budget.
 */
export interface UploadBudget {
  /** The file's bytes, read from the stream under both limits. */
  read(stream: AsyncIterable<Uint8Array> & { destroy?(): void }): Promise<Buffer>;
  /** Bytes of the request read so far. */
  readonly used: number;
}

export function uploadBudget(declaredRequestBytes?: number, limits = FILE_LIMITS): UploadBudget {
  if (declaredRequestBytes !== undefined && declaredRequestBytes > limits.requestBytes)
    reject("REQUEST_TOO_LARGE");
  let used = 0;
  return {
    get used() {
      return used;
    },
    async read(stream) {
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          size += chunk.length;
          used += chunk.length;
          if (size > limits.fileBytes) reject("FILE_TOO_LARGE");
          if (used > limits.requestBytes) reject("REQUEST_TOO_LARGE");
          chunks.push(Buffer.from(chunk));
        }
      } catch (error) {
        stream.destroy?.();
        throw error;
      }
      return Buffer.concat(chunks, size);
    },
  };
}

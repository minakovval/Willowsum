import { Worker } from "node:worker_threads";
import {
  FileRejectedError,
  PARSE_CEILINGS,
  REJECTION_CODES,
  type RejectionCode,
} from "../../domain/index.ts";
import type { Ceilings, Inspection } from "../inspection/inspect.ts";

/**
 * Parsing in a separate worker (ARC-06@PoC FR 4 and row «Розбір в окремому процесі», NFR-15@PoC FR 18, IMP-01@PoC
 * FR 13): every uploaded file is inspected in a fresh worker thread with a heap limit (512 MiB) and a time limit
 * (60 s). A worker that runs out of memory, runs out of time or crashes is ended alone: the file is rejected
 * (PARSE_MEMORY, PARSE_TIMEOUT, CORRUPTED) and the API's own thread keeps answering. The worker gets a copy of the
 * bytes, no environment and no stdout or stderr of its own (nothing of a file reaches the logs).
 */
export interface Inspector {
  /** The inspection of the file, or a `FileRejectedError`. */
  inspect(bytes: Uint8Array): Promise<Inspection>;
}

export interface IsolationOptions {
  readonly memoryMb?: number;
  readonly timeoutMs?: number;
  readonly ceilings?: Ceilings;
  /** The worker script; tests pass one that misbehaves on purpose. */
  readonly workerUrl?: URL;
}

const WORKER_URL = new URL("./worker.ts", import.meta.url);
const CODES: ReadonlySet<string> = new Set(REJECTION_CODES);

export function isolatedInspector(options: IsolationOptions = {}): Inspector {
  const memoryMb = options.memoryMb ?? PARSE_CEILINGS.memoryMb;
  const timeoutMs = options.timeoutMs ?? PARSE_CEILINGS.timeoutMs;
  const ceilings = options.ceilings ?? PARSE_CEILINGS;
  const url = options.workerUrl ?? WORKER_URL;
  return {
    inspect(bytes) {
      const copy = new Uint8Array(bytes);
      return new Promise<Inspection>((resolve, reject) => {
        let settled = false;
        const worker = new Worker(url, {
          workerData: { bytes: copy, ceilings },
          transferList: [copy.buffer],
          resourceLimits: {
            maxOldGenerationSizeMb: memoryMb,
            maxYoungGenerationSizeMb: Math.min(32, memoryMb),
          },
          env: {},
          stdout: true,
          stderr: true,
        });
        // Read and drop the worker's output: it never reaches the API's logs.
        worker.stdout.resume();
        worker.stderr.resume();
        const finish = (work: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          work();
        };
        const refuse = (code: RejectionCode) => finish(() => reject(new FileRejectedError(code)));
        const timer = setTimeout(() => refuse("PARSE_TIMEOUT"), timeoutMs);
        worker.on("message", (message: { inspection?: Inspection; rejected?: string }) => {
          if (message.inspection) finish(() => resolve(message.inspection!));
          else
            refuse(
              message.rejected && CODES.has(message.rejected)
                ? (message.rejected as RejectionCode)
                : "CORRUPTED",
            );
        });
        worker.on("error", (error: Error & { code?: string }) =>
          refuse(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "PARSE_MEMORY" : "CORRUPTED"),
        );
        worker.on("exit", () => refuse("CORRUPTED"));
      });
    },
  };
}

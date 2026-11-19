import { runIsolated } from "../../../../platform/process/isolated.ts";
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
 * (60 s) — the platform's `runIsolated`. A worker that runs out of memory, runs out of time or crashes is ended alone:
 * the file is rejected (PARSE_MEMORY, PARSE_TIMEOUT, CORRUPTED) and the API's own thread keeps answering. The worker
 * gets a copy of the bytes, no environment and no stdout or stderr of its own (nothing of a file reaches the logs).
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
  const limits = {
    memoryMb: options.memoryMb ?? PARSE_CEILINGS.memoryMb,
    timeoutMs: options.timeoutMs ?? PARSE_CEILINGS.timeoutMs,
  };
  const ceilings = options.ceilings ?? PARSE_CEILINGS;
  const url = options.workerUrl ?? WORKER_URL;
  return {
    async inspect(bytes) {
      const copy = new Uint8Array(bytes);
      const outcome = await runIsolated<Inspection>(url, { bytes: copy, ceilings }, [copy.buffer], limits);
      if (outcome.ok) return outcome.value;
      const code: RejectionCode =
        outcome.failure === "memory"
          ? "PARSE_MEMORY"
          : outcome.failure === "timeout"
            ? "PARSE_TIMEOUT"
            : outcome.failure === "refused" && CODES.has(outcome.code)
              ? (outcome.code as RejectionCode)
              : "CORRUPTED";
      throw new FileRejectedError(code);
    },
  };
}

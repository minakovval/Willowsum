import { Worker } from "node:worker_threads";

/**
 * One job in a fresh worker thread with its own heap limit and a time limit (ARC-06@PoC FR 4, NFR-15@PoC FR 18,
 * IMP-01@PoC FR 13): a worker that runs out of memory, runs out of time or crashes is ended alone and the API's own
 * thread keeps answering. The worker gets its data by structured clone (the listed buffers are moved, not copied), no
 * environment and no stdout or stderr of its own: nothing it reads reaches the logs. It answers once with
 * `{ value }` or `{ refused: "<code>" }` (see `answerFromWorker`).
 *
 * Used by file-storage (the type check and ceilings of an upload) and by file-parsers (reading a statement and the
 * recipe's patterns, IMP-06@PoC; #607 item 3).
 */
export type IsolatedOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: "memory" | "timeout" | "crashed" }
  | { readonly ok: false; readonly failure: "refused"; readonly code: string };

export interface IsolatedLimits {
  readonly memoryMb: number;
  readonly timeoutMs: number;
}

export function runIsolated<T>(
  url: URL,
  workerData: unknown,
  transferList: readonly ArrayBuffer[],
  limits: IsolatedLimits,
): Promise<IsolatedOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(url, {
      workerData,
      transferList: [...transferList],
      resourceLimits: {
        maxOldGenerationSizeMb: limits.memoryMb,
        maxYoungGenerationSizeMb: Math.min(32, limits.memoryMb),
      },
      env: {},
      stdout: true,
      stderr: true,
    });
    // Read and drop the worker's output: it never reaches the API's logs.
    worker.stdout.resume();
    worker.stderr.resume();
    const finish = (outcome: IsolatedOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ ok: false, failure: "timeout" }), limits.timeoutMs);
    worker.on("message", (raw: unknown) => {
      // Anything but an object is a crash: `in` on a string would throw in the API's own thread.
      const message =
        typeof raw === "object" && raw !== null ? (raw as { value?: T; refused?: unknown }) : null;
      if (message && "value" in message) finish({ ok: true, value: message.value as T });
      else if (message && typeof message.refused === "string")
        finish({ ok: false, failure: "refused", code: message.refused });
      else finish({ ok: false, failure: "crashed" });
    });
    worker.on("error", (error: Error & { code?: string }) =>
      finish({ ok: false, failure: error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "crashed" }),
    );
    worker.on("exit", () => finish({ ok: false, failure: "crashed" }));
  });
}

/** The worker's side: post the job's value, or the code of a refusal (`refusalOf` maps a thrown error to a code). */
export async function answerFromWorker<T>(
  post: (message: unknown) => void,
  job: () => T | Promise<T>,
  refusalOf: (error: unknown) => string,
): Promise<void> {
  try {
    post({ value: await job() });
  } catch (error) {
    post({ refused: refusalOf(error) });
  }
}

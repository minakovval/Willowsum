// The parsing worker (ARC-06@PoC FR 4, IMP-01@PoC FR 13): runs the type check and the ceiling count of one uploaded
// file in its own thread with its own heap limit, so an exceeded limit or a crash ends only this worker. It gets the
// file's bytes and the ceilings, and answers once: the inspection, or the code of the rejection. It never logs.
import { parentPort, workerData } from "node:worker_threads";
import { answerFromWorker } from "../../../../platform/process/isolated.ts";
import { FileRejectedError } from "../../domain/index.ts";
import { inspectFile, type Ceilings } from "../inspection/inspect.ts";

const { bytes, ceilings } = workerData as { bytes: Uint8Array; ceilings: Ceilings };

await answerFromWorker(
  (message) => parentPort!.postMessage(message),
  () => inspectFile(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length), ceilings),
  (error) => (error instanceof FileRejectedError ? error.code : "CORRUPTED"),
);

// The parse worker of file-parsers (IMP-06@PoC FR 8, ARC-06@PoC FR 4; #607 item 3): reads one statement file and
// analyses its table in its own thread with its own heap and time limits — the only place where the file's bytes are
// read into rows and where a recipe's patterns would run. It answers once: the parse, or the code of the refusal. It
// never logs.
import { parentPort, workerData } from "node:worker_threads";
import { answerFromWorker } from "../../../../platform/process/isolated.ts";
import { FileTooLargeError, parseStatement, type ReadOptions } from "../../application/index.ts";
import { TableLimitError } from "../../domain/index.ts";

const { bytes, options } = workerData as { bytes: Uint8Array; options: ReadOptions };

await answerFromWorker(
  (message) => parentPort!.postMessage(message),
  () => parseStatement(bytes, options),
  (error) =>
    error instanceof FileTooLargeError
      ? "FILE_TOO_LARGE"
      : error instanceof TableLimitError
        ? `TABLE_LIMIT:${error.ceiling}`
        : "CORRUPTED",
);

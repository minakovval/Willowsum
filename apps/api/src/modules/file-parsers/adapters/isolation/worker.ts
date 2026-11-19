// The parse worker of file-parsers (IMP-06@PoC FR 8, ARC-06@PoC FR 4; #607 item 3): reads one statement file and
// analyses its table in its own thread with its own heap and time limits — the only place where the file's bytes are
// read into rows and where a recipe's patterns would run. It answers once: the parse, or the code of the refusal. It
// never logs.
import { parentPort, workerData } from "node:worker_threads";
import { answerFromWorker } from "../../../../platform/process/isolated.ts";
import { openWithFieldOpener, wipeFieldOpener } from "../../../household/index.ts";
import { FileTooLargeError, parseStatement, type ReadOptions } from "../../application/index.ts";
import { TableLimitError, type StatementOptions } from "../../domain/index.ts";
import type { SealedAccountBinding } from "./run.ts";

/**
 * Characters of the parse as JSON: the reading and the analysis 2 MiB, the whole answer with the events 16 MiB (a 25 MiB file of
 * ordinary rows fits); a larger answer is refused as CORRUPTED.
 */
const ANALYSIS_CHARS = 2 * 1024 * 1024;
const RESULT_CHARS = 16 * 1024 * 1024;

const { bytes, options, statement, binding } = workerData as {
  bytes: Uint8Array;
  options: ReadOptions;
  statement: StatementOptions;
  binding?: SealedAccountBinding;
};

class AccountBindingError extends Error {}

/**
 * The recipe's account value, opened with the space's key before the file is read; the key is wiped right after, so
 * it is gone before any byte of the untrusted file is parsed. Any failure is `ACCOUNT_BINDING` (fails closed).
 */
function openBinding(): { by: SealedAccountBinding["by"]; value: string } | undefined {
  if (!binding) return undefined;
  try {
    return { by: binding.by, value: openWithFieldOpener(binding.opener, binding.sealedValue) };
  } catch {
    throw new AccountBindingError();
  } finally {
    wipeFieldOpener(binding.opener);
  }
}

await answerFromWorker(
  (message) => parentPort!.postMessage(message),
  () => {
    const parse = parseStatement(bytes, options, statement, openBinding());
    // The answer is copied into the API process: it stays bounded whatever the file holds.
    if (JSON.stringify({ reading: parse.reading, analysis: parse.analysis }).length > ANALYSIS_CHARS)
      throw new Error("result too large");
    if (JSON.stringify(parse).length > RESULT_CHARS) throw new Error("result too large");
    return parse;
  },
  (error) =>
    error instanceof AccountBindingError
      ? "ACCOUNT_BINDING"
      : error instanceof FileTooLargeError
        ? "FILE_TOO_LARGE"
        : error instanceof TableLimitError
          ? `TABLE_LIMIT:${error.ceiling}`
          : "CORRUPTED",
);

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { erasureLogRecord, type ErasureLog, type ErasureLogRecord } from "./port.ts";

/** Settings of the local log: the folder of `erasure-log.jsonl` (`WS_ERASURE_LOG_DIR`, outside the database). */
export interface LocalErasureLogOptions {
  readonly dir: string;
}

const FILE = "erasure-log.jsonl";
const GENESIS = "0".repeat(64);

interface Line {
  readonly seq: number;
  /** SHA-256 of the previous line as written (the genesis value for the first). */
  readonly prev: string;
  readonly record: ErasureLogRecord;
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Local implementation (ARC-05 FR 2; `WS_PROVIDER_MODE=test`, development and CI): one JSON line per record, each
 * carrying its number and the SHA-256 of the line before, so a changed, removed or reordered line is detected and the
 * log refuses to be read. Written with mode 0600. A file on the same machine as the database is no protection against
 * losing both: the live implementation keeps the log in another region (ADR-0013).
 */
export function localErasureLog(options: LocalErasureLogOptions): ErasureLog {
  const file = path.join(options.dir, FILE);
  const readChain = async (): Promise<{ records: ErasureLogRecord[]; last: string; seq: number }> => {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { records: [], last: GENESIS, seq: 0 };
      throw error;
    }
    const records: ErasureLogRecord[] = [];
    let last = GENESIS;
    let seq = 0;
    for (const raw of text.split("\n")) {
      if (raw === "") continue;
      let line: Line;
      try {
        line = JSON.parse(raw) as Line;
      } catch {
        throw new Error("The erasure log's chain is broken (unreadable line)");
      }
      if (line.seq !== seq + 1 || line.prev !== last)
        throw new Error("The erasure log's chain is broken (a line was changed, removed or reordered)");
      records.push(erasureLogRecord.parse(line.record));
      last = digest(raw);
      seq = line.seq;
    }
    return { records, last, seq };
  };
  return {
    async append(record) {
      const parsed = erasureLogRecord.parse(record);
      const { last, seq } = await readChain();
      await mkdir(options.dir, { recursive: true, mode: 0o700 });
      const line: Line = { seq: seq + 1, prev: last, record: parsed };
      await appendFile(file, `${JSON.stringify(line)}\n`, { encoding: "utf8", mode: 0o600, flag: "a" });
    },
    records: async () => (await readChain()).records,
  };
}

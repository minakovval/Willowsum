import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderError } from "../errors.ts";
import { unwrapWith, wrapWith } from "./aes-wrap.ts";
import type { LocalKeyManagement } from "./local.ts";
import { KMS_PORT } from "./port.ts";

/**
 * The installation's own master key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; ARC-06 FR 1): the local KMS adapter of an
 * instance with real data. On the first start it makes a random 256-bit key (CSPRNG) and keeps it in a file of this
 * computer that only its OS user may read (mode 0600): outside the repository and the source, outside the database
 * (and so outside every `pnpm local:backup` copy of it), never in an environment variable — the configuration gives
 * only the file's path (`WS_KMS_KEY_FILE`). The process refuses to start when the file can be read or written by
 * other users, belongs to another user, is a symbolic link, lies inside a git working tree, or is not a key file.
 *
 * Versions are `inst-N`; `rotate` adds a random version to the file and makes it current, `retire` stops a version
 * from unwrapping (ARC-06 FR 3), both written to the file at once (atomically, mode 0600), so every process of the
 * installation (api, worker, scheduler) sees them: the file is read again whenever it changed. Key bytes are never
 * logged, printed or put in an error; an error names the file's path and the reason only.
 */
export class KmsKeyFileError extends Error {
  constructor(file: string, reason: string) {
    super(`Local KMS key file ${file}: ${reason}`);
    this.name = "KmsKeyFileError";
  }
}

const FORMAT = "willowsum-local-kms";
const FORMAT_VERSION = 1;
const VERSION_RE = /^inst-([1-9][0-9]{0,5})$/;
const KEY_B64_RE = /^[A-Za-z0-9+/]{43}=$/;
const MAX_FILE_BYTES = 64 * 1024;

/** The repository this code runs from (six levels above this file: kms, adapters, platform, src, api, apps). */
const OWN_REPOSITORY = fileURLToPath(new URL("../../../../../../", import.meta.url));

interface KeyFileState {
  readonly current: string;
  readonly keys: ReadonlyMap<string, Buffer>;
  readonly retired: ReadonlySet<string>;
  readonly installation: string;
}

interface Stamp {
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

const stampOf = (s: { ino: number; size: number; mtimeMs: number; ctimeMs: number }): Stamp => ({
  ino: s.ino,
  size: s.size,
  mtimeMs: s.mtimeMs,
  ctimeMs: s.ctimeMs,
});
const sameStamp = (a: Stamp, b: Stamp) =>
  a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The nearest existing directory of `p` (itself or an ancestor), resolved through symbolic links. */
function nearestExisting(p: string): string {
  let dir = p;
  while (!existsSync(dir)) {
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return realpathSync(dir);
}

/** Refuses a key file inside this repository or any git working tree (a checkout, a worktree, a submodule). */
function checkLocation(file: string, repoRoot: string): void {
  if (!path.isAbsolute(file)) throw new KmsKeyFileError(file, "must be an absolute path");
  const dir = nearestExisting(path.dirname(file));
  const repo = existsSync(repoRoot) ? realpathSync(repoRoot) : path.resolve(repoRoot);
  if (isInside(dir, repo))
    throw new KmsKeyFileError(file, "is inside the repository; keep it outside every git working tree");
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, ".git")))
      throw new KmsKeyFileError(file, "is inside a git working tree; keep it outside every git working tree");
    if (path.dirname(d) === d) break;
  }
}

function checkOwnerAndMode(file: string, s: { mode: number; uid: number }): void {
  if ((s.mode & 0o077) !== 0)
    throw new KmsKeyFileError(file, "can be read or written by other users; run `chmod 600` on it");
  if (typeof process.getuid === "function" && s.uid !== process.getuid())
    throw new KmsKeyFileError(file, "belongs to another OS user");
}

function checkDirectory(file: string): void {
  const s = statSync(path.dirname(file));
  if ((s.mode & 0o022) !== 0 && (s.mode & 0o1000) === 0)
    throw new KmsKeyFileError(file, "its directory can be written by other users; run `chmod 700` on it");
}

function parse(file: string, text: string): KeyFileState {
  const invalid = () => new KmsKeyFileError(file, "is not a Willowsum local KMS key file");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalid();
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r !== "object" ||
    r === null ||
    r["format"] !== FORMAT ||
    r["formatVersion"] !== FORMAT_VERSION ||
    typeof r["installation"] !== "string" ||
    typeof r["current"] !== "string" ||
    typeof r["versions"] !== "object" ||
    r["versions"] === null ||
    !Array.isArray(r["retired"])
  )
    throw invalid();
  const keys = new Map<string, Buffer>();
  for (const [version, value] of Object.entries(r["versions"] as Record<string, unknown>)) {
    if (!VERSION_RE.test(version) || typeof value !== "string" || !KEY_B64_RE.test(value)) throw invalid();
    keys.set(version, Buffer.from(value, "base64"));
  }
  const retired = new Set<string>();
  for (const v of r["retired"] as unknown[]) {
    if (typeof v !== "string" || !keys.has(v)) throw invalid();
    retired.add(v);
  }
  const current = r["current"];
  if (!keys.has(current) || retired.has(current)) throw invalid();
  return { current, keys, retired, installation: r["installation"] };
}

function serialize(state: KeyFileState): string {
  const versions = Object.fromEntries([...state.keys].map(([v, k]) => [v, k.toString("base64")]));
  return `${JSON.stringify({
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    installation: state.installation,
    current: state.current,
    versions,
    retired: [...state.retired],
  })}\n`;
}

function read(file: string): { state: KeyFileState; stamp: Stamp } {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EMLINK")
      throw new KmsKeyFileError(file, "is a symbolic link; give the path of the file itself");
    throw new KmsKeyFileError(file, `cannot be opened (${code ?? "error"})`);
  }
  try {
    const s = fstatSync(fd);
    if (!s.isFile()) throw new KmsKeyFileError(file, "is not a regular file");
    checkOwnerAndMode(file, s);
    if (s.size > MAX_FILE_BYTES) throw new KmsKeyFileError(file, "is not a Willowsum local KMS key file");
    return { state: parse(file, readFileSync(fd, "utf8")), stamp: stampOf(s) };
  } finally {
    closeSync(fd);
  }
}

/** Writes `state` to a new file beside `file` (mode 0600) and moves it into place (`create`: only if none is there). */
function write(file: string, state: KeyFileState, create: boolean): boolean {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, serialize(state));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    if (!create) {
      renameSync(tmp, file);
      return true;
    }
    try {
      linkSync(tmp, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}

export interface FileKeyManagementOptions {
  /** Absolute path of the key file (`WS_KMS_KEY_FILE`). */
  readonly file: string;
  /** The repository the key file must stay out of; this code's own checkout unless a test names another. */
  readonly repoRoot?: string;
}

/**
 * Opens the installation's key file, making it (and its directory, mode 0700) on the first start. Throws
 * `KmsKeyFileError` when the file may not be used, so the process does not start.
 */
export function fileKeyManagement(options: FileKeyManagementOptions): LocalKeyManagement {
  const file = options.file;
  checkLocation(file, options.repoRoot ?? OWN_REPOSITORY);
  let exists = true;
  try {
    lstatSync(file);
  } catch {
    exists = false;
  }
  if (!exists) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const first: KeyFileState = {
      current: "inst-1",
      keys: new Map([["inst-1", randomBytes(32)]]),
      retired: new Set(),
      installation: randomUUID(),
    };
    // Two processes starting at once: the second finds the first one's file and uses it.
    write(file, first, true);
  }
  checkDirectory(file);
  let loaded = read(file);

  const unavailable = (op: string, error: unknown) =>
    new ProviderError("unavailable", KMS_PORT.name, op, error instanceof Error ? error.name : undefined);
  /** The file as it is now: read again when it changed (another process rotated, a chmod), checked each time. */
  const state = (op: string): KeyFileState => {
    try {
      const s = lstatSync(file);
      if (!sameStamp(stampOf(s), loaded.stamp)) loaded = read(file);
      return loaded.state;
    } catch (error) {
      throw unavailable(op, error);
    }
  };
  const update = (change: (s: KeyFileState) => KeyFileState): KeyFileState => {
    const next = change(read(file).state);
    write(file, next, false);
    loaded = read(file);
    return next;
  };

  return {
    currentVersion: async () => state("currentVersion").current,
    async wrap(dataKey, context) {
      const s = state("wrap");
      return wrapWith(s.keys.get(s.current)!, s.current, dataKey, context);
    },
    async unwrap(wrapped, context) {
      const s = state("unwrap");
      const v = wrapped.masterKeyVersion;
      return unwrapWith(s.retired.has(v) ? undefined : s.keys.get(v), wrapped, context);
    },
    rotate() {
      return update((s) => {
        const n = Math.max(...[...s.keys.keys()].map((v) => Number(VERSION_RE.exec(v)![1]))) + 1;
        const version = `inst-${n}`;
        return { ...s, current: version, keys: new Map([...s.keys, [version, randomBytes(32)]]) };
      }).current;
    },
    retire(version) {
      update((s) => {
        if (version === s.current) throw new Error("The current master key version cannot be retired");
        if (!s.keys.has(version)) throw new Error("No such master key version");
        return { ...s, retired: new Set([...s.retired, version]) };
      });
    },
  };
}

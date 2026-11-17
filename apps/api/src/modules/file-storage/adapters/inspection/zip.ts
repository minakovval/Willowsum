import { createInflateRaw, crc32 } from "node:zlib";
import { FILE_LIMITS, reject } from "../../domain/index.ts";

/**
 * A ZIP package read for the type check (ARC-06@PoC FR 4, NFR-15@PoC FR 18): the central directory gives the
 * elements; each element is then unpacked as a stream, counting what comes out, so a package is refused while it is
 * being unpacked — more than 1 000 elements, one element compressed over 100:1, or over 200 MiB unpacked in all —
 * before it can fill the memory. Every loop is bounded by the package's own size or element count, and elements may
 * not overlap, so a damaged package cannot loop forever. Nothing is written to disk.
 */
export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_BYTES = 22;
const CENTRAL_BYTES = 46;
const LOCAL_BYTES = 30;
const MAX_COMMENT = 0xffff;

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  );
}

function findEndOfDirectory(buf: Buffer): number {
  const last = buf.length - EOCD_BYTES;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let at = last; at >= first; at--) {
    if (buf.readUInt32LE(at) === EOCD_SIG && at + EOCD_BYTES + buf.readUInt16LE(at + 20) === buf.length)
      return at;
  }
  return reject("CORRUPTED");
}

/** The elements of a package from its central directory; throws a rejection for a damaged or oversized one. */
export function readZipDirectory(buf: Buffer): ZipEntry[] {
  if (buf.length < EOCD_BYTES + LOCAL_BYTES) reject("CORRUPTED");
  const eocd = findEndOfDirectory(buf);
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) reject("UNSUPPORTED_FORMAT");
  const count = buf.readUInt16LE(eocd + 10);
  const size = buf.readUInt32LE(eocd + 12);
  const offset = buf.readUInt32LE(eocd + 16);
  // ZIP64 markers: a statement book of at most 25 MiB never needs them.
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) reject("UNSUPPORTED_FORMAT");
  if (count > FILE_LIMITS.zipEntries) reject("ARCHIVE_LIMIT");
  if (count !== buf.readUInt16LE(eocd + 8) || offset + size > eocd) reject("CORRUPTED");
  const entries: ZipEntry[] = [];
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_BYTES > offset + size || buf.readUInt32LE(at) !== CENTRAL_SIG) reject("CORRUPTED");
    const nameLength = buf.readUInt16LE(at + 28);
    const next = at + CENTRAL_BYTES + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    if (next > offset + size) reject("CORRUPTED");
    entries.push({
      name: buf.toString("utf8", at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameLength),
      flags: buf.readUInt16LE(at + 8),
      method: buf.readUInt16LE(at + 10),
      crc: buf.readUInt32LE(at + 16),
      compressedSize: buf.readUInt32LE(at + 20),
      uncompressedSize: buf.readUInt32LE(at + 24),
      localOffset: buf.readUInt32LE(at + 42),
    });
    at = next;
  }
  // Elements must not overlap (an overlapping «bomb» unpacks the same bytes many times).
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  byOffset.forEach((entry, i) => {
    const end = dataStart(buf, entry, offset) + entry.compressedSize;
    const limit = byOffset[i + 1]?.localOffset ?? offset;
    if (end > limit) reject("CORRUPTED");
  });
  return entries;
}

function dataStart(buf: Buffer, entry: ZipEntry, directoryOffset: number): number {
  const at = entry.localOffset;
  if (at + LOCAL_BYTES > directoryOffset || buf.readUInt32LE(at) !== LOCAL_SIG) return reject("CORRUPTED");
  return at + LOCAL_BYTES + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
}

/** Unpacks one element as a stream under the limits; resolves with its bytes when `keep`, else an empty buffer. */
function unpack(data: Buffer, entry: ZipEntry, cap: number, keep: boolean): Promise<Buffer> {
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) reject("CORRUPTED");
    if (entry.uncompressedSize > cap) reject("ARCHIVE_LIMIT");
    if (crc32(data) !== entry.crc) reject("CORRUPTED");
    return Promise.resolve(keep ? data : Buffer.alloc(0));
  }
  return new Promise((resolve, fail) => {
    const inflater = createInflateRaw({ chunkSize: 64 * 1024 });
    const chunks: Buffer[] = [];
    let total = 0;
    let crc = 0;
    let settled = false;
    const settle = (work: () => void) => {
      if (settled) return;
      settled = true;
      work();
    };
    inflater.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        inflater.destroy();
        settle(() => fail(new FileRejectionSignal("ARCHIVE_LIMIT")));
        return;
      }
      crc = crc32(chunk, crc);
      if (keep) chunks.push(chunk);
    });
    inflater.on("error", () => settle(() => fail(new FileRejectionSignal("CORRUPTED"))));
    inflater.on("end", () =>
      settle(() => {
        if (total !== entry.uncompressedSize || crc !== entry.crc) fail(new FileRejectionSignal("CORRUPTED"));
        else resolve(Buffer.concat(chunks));
      }),
    );
    inflater.end(data);
  });
}

/** Carries a rejection code out of a stream callback; turned into the rejection by `unpackZip`. */
class FileRejectionSignal extends Error {
  readonly code: "ARCHIVE_LIMIT" | "CORRUPTED";
  constructor(code: "ARCHIVE_LIMIT" | "CORRUPTED") {
    super(code);
    this.code = code;
  }
}

/**
 * Unpacks every element in turn under the ZIP limits; returns the elements and the bytes of those `keep` selects.
 * Throws a rejection: ARCHIVE_LIMIT for a limit, CORRUPTED for a damaged package, UNSUPPORTED_FORMAT for ZIP
 * encryption or another compression method.
 */
export async function unpackZip(
  buf: Buffer,
  keep: (name: string) => boolean,
): Promise<{ entries: ZipEntry[]; parts: Map<string, Buffer> }> {
  const entries = readZipDirectory(buf);
  const directoryOffset = buf.readUInt32LE(findEndOfDirectory(buf) + 16);
  const parts = new Map<string, Buffer>();
  let budget = FILE_LIMITS.zipUnpackedBytes;
  for (const entry of entries) {
    if (entry.flags & 0x1) reject("UNSUPPORTED_FORMAT");
    if (entry.method !== 0 && entry.method !== 8) reject("UNSUPPORTED_FORMAT");
    if (entry.uncompressedSize > FILE_LIMITS.zipRatio * entry.compressedSize) reject("ARCHIVE_LIMIT");
    const start = dataStart(buf, entry, directoryOffset);
    const cap = Math.min(FILE_LIMITS.zipRatio * entry.compressedSize, budget);
    let bytes: Buffer;
    try {
      bytes = await unpack(buf.subarray(start, start + entry.compressedSize), entry, cap, keep(entry.name));
    } catch (error) {
      if (error instanceof FileRejectionSignal) reject(error.code);
      throw error;
    }
    budget -= entry.uncompressedSize;
    if (keep(entry.name)) parts.set(entry.name, bytes);
  }
  return { entries, parts };
}

import { reject } from "../../domain/index.ts";

/**
 * A Compound File Binary container (MS-CFB) read for the type check of XLS (ARC-06@PoC FR 4): the directory of its
 * storages and streams, and the bytes of one stream. Every chain walk stops at the container's own sector count and
 * refuses a sector seen twice, so a damaged container cannot loop forever. Anything malformed is CORRUPTED.
 */
export interface CfbEntry {
  /** As stored (UTF-16); compare case-insensitively. */
  readonly name: string;
  /** 1 storage, 2 stream, 5 root. */
  readonly type: number;
  readonly start: number;
  readonly size: number;
}

export interface Cfb {
  readonly entries: readonly CfbEntry[];
  stream(entry: CfbEntry): Buffer;
}

const MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const NO_STREAM = 0xffffffff;
const HEADER_DIFAT = 109;

export function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && MAGIC.equals(Buffer.from(bytes.buffer, bytes.byteOffset, 8));
}

export function readCfb(buf: Buffer): Cfb {
  if (buf.length < 512 || !isCfb(buf)) reject("CORRUPTED");
  const shift = buf.readUInt16LE(30);
  const miniShift = buf.readUInt16LE(32);
  if ((shift !== 9 && shift !== 12) || miniShift !== 6 || buf.readUInt16LE(28) !== 0xfffe)
    reject("CORRUPTED");
  const sectorSize = 1 << shift;
  const sectors = Math.floor((buf.length - sectorSize) / sectorSize);
  if (sectors < 1) reject("CORRUPTED");
  const sectorAt = (n: number): Buffer => {
    if (n >= sectors) reject("CORRUPTED");
    const at = (n + 1) * sectorSize;
    return buf.subarray(at, at + sectorSize);
  };
  const perSector = sectorSize / 4;
  const fatCount = buf.readUInt32LE(44);
  if (fatCount > sectors) reject("CORRUPTED");

  // The FAT's sectors: 109 in the header, the rest along the DIFAT chain.
  const fatSectors: number[] = [];
  for (let i = 0; i < HEADER_DIFAT && fatSectors.length < fatCount; i++)
    fatSectors.push(buf.readUInt32LE(76 + i * 4));
  let difat = buf.readUInt32LE(68);
  const seenDifat = new Set<number>();
  while (fatSectors.length < fatCount) {
    if (difat === END_OF_CHAIN || difat === FREE || seenDifat.has(difat)) reject("CORRUPTED");
    seenDifat.add(difat);
    const s = sectorAt(difat);
    for (let i = 0; i < perSector - 1 && fatSectors.length < fatCount; i++)
      fatSectors.push(s.readUInt32LE(i * 4));
    difat = s.readUInt32LE((perSector - 1) * 4);
  }
  const fat = new Uint32Array(fatCount * perSector);
  fatSectors.forEach((sector, i) => {
    const s = sectorAt(sector);
    for (let j = 0; j < perSector; j++) fat[i * perSector + j] = s.readUInt32LE(j * 4);
  });

  const chain = (start: number, table: Uint32Array, limit: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    let at = start;
    while (at !== END_OF_CHAIN) {
      if (at >= table.length || at >= limit || seen.has(at)) reject("CORRUPTED");
      seen.add(at);
      out.push(at);
      at = table[at]!;
    }
    return out;
  };
  const readChain = (start: number, size?: number): Buffer => {
    const bytes = Buffer.concat(chain(start, fat, sectors).map(sectorAt));
    if (size !== undefined && size > bytes.length) reject("CORRUPTED");
    return size === undefined ? bytes : bytes.subarray(0, size);
  };

  const dir = readChain(buf.readUInt32LE(48));
  const entries: CfbEntry[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const type = dir[at + 66]!;
    if (type === 0) continue;
    const nameBytes = Math.min(dir.readUInt16LE(at + 64), 64);
    const name = dir.toString("utf16le", at, at + Math.max(0, nameBytes - 2));
    // Version 3 containers keep only the low 32 bits of a size.
    const size = shift === 9 ? dir.readUInt32LE(at + 120) : Number(dir.readBigUInt64LE(at + 120));
    entries.push({ name, type, start: dir.readUInt32LE(at + 116), size });
  }
  const root = entries.find((e) => e.type === 5);
  if (!root) return reject("CORRUPTED");
  const cutoff = buf.readUInt32LE(56);

  let mini: { fat: Uint32Array; data: Buffer } | undefined;
  const miniStream = () => {
    if (mini) return mini;
    const miniFatStart = buf.readUInt32LE(60);
    const raw = miniFatStart === END_OF_CHAIN ? Buffer.alloc(0) : readChain(miniFatStart);
    const table = new Uint32Array(raw.length / 4);
    for (let i = 0; i < table.length; i++) table[i] = raw.readUInt32LE(i * 4);
    const data =
      root.start === END_OF_CHAIN || root.start === NO_STREAM
        ? Buffer.alloc(0)
        : readChain(root.start, root.size);
    mini = { fat: table, data };
    return mini;
  };

  return {
    entries,
    stream(entry) {
      if (entry.type !== 2) reject("CORRUPTED");
      if (entry.size === 0) return Buffer.alloc(0);
      if (entry.size >= cutoff) return readChain(entry.start, entry.size);
      const { fat: table, data } = miniStream();
      const count = Math.floor(data.length / 64);
      const bytes = Buffer.concat(
        chain(entry.start, table, count).map((n) => data.subarray(n * 64, n * 64 + 64)),
      );
      if (entry.size > bytes.length) reject("CORRUPTED");
      return bytes.subarray(0, entry.size);
    },
  };
}

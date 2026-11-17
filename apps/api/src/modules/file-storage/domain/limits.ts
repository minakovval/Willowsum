/**
 * Technical limits of stored files (ARC-06@PoC FR 4, NFR-15@PoC FR 18, FR 31, IMP-01@PoC FR 13). They protect the
 * server and are the same for every plan: none of them is a plan limit (402 is never answered for them). Sizes are
 * binary units: «25 МБ» is 25 MiB, «100 ГБ» is 100 GiB (lead's decision, 2026-11-17: the more lenient reading).
 */
const MiB = 1024 * 1024;

export const FILE_LIMITS = Object.freeze({
  /** One file, counted on the request stream before buffering (ARC-06 FR 4, IMP-01 FR 13). */
  fileBytes: 25 * MiB,
  /** One upload request, counted on the request stream (ARC-06 FR 4; IMP-01 FR 13: a batch is up to 150 MB). */
  requestBytes: 150 * MiB,
  /** A ZIP package (XLSX) after unpacking, all elements together (ARC-06 FR 4). */
  zipUnpackedBytes: 200 * MiB,
  /** Compression of one ZIP element, uncompressed : compressed (ARC-06 FR 4). */
  zipRatio: 100,
  /** Elements of one ZIP package (ARC-06 FR 4). */
  zipEntries: 1000,
  /** Every file of a space together (NFR-15 FR 31): 100 GiB. */
  spaceBytes: 100 * 1024 * MiB,
});

/** IMP-01@PoC FR 13: the ceilings of one statement file, checked while it is parsed in its own worker. */
export const PARSE_CEILINGS = Object.freeze({
  /** Records of the file, all sheets together; every non-empty record counts, a header too. */
  rows: 20_000,
  /** Cells of the file, all sheets together. */
  cells: 2_000_000,
  /** Sheets of an XLS book. */
  xlsSheets: 20,
  /** Memory of the parsing worker (heap), MiB. */
  memoryMb: 512,
  /** Time of one parse, ms. */
  timeoutMs: 60_000,
});

/** NFR-01 FR 4: a signed link lives at most 15 minutes. */
export const SIGNED_LINK_MAX_TTL_MS = 15 * 60 * 1000;

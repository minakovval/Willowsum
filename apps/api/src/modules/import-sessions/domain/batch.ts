/**
 * The states of an import batch (IMP-01@PoC FR 10, IMP-19@PoC FR 5): «завантажено» → «в обробці» → «розібрано»,
 * «потребує перегляду» or «не вдалося розібрати» → «застосовано» → «відкочено»; «скасовано» from any state before
 * «застосовано». «Не вдалося розібрати» — every file of the batch was rejected. Re-parsing (FR 21) takes a parsed batch
 * back to «в обробці». Any other step is refused with nothing written.
 */
export const BATCH_STATES = [
  "uploaded",
  "processing",
  "parsed",
  "needs-review",
  "failed",
  "applied",
  "rolled-back",
  "cancelled",
] as const;
export type BatchState = (typeof BATCH_STATES)[number];

const NEXT: { readonly [S in BatchState]: readonly BatchState[] } = {
  uploaded: ["processing", "cancelled"],
  processing: ["parsed", "needs-review", "failed", "cancelled"],
  parsed: ["processing", "applied", "cancelled"],
  "needs-review": ["processing", "applied", "cancelled"],
  failed: ["processing", "cancelled"],
  applied: ["rolled-back"],
  "rolled-back": [],
  cancelled: [],
};

export function canMove(from: BatchState, to: BatchState): boolean {
  return NEXT[from].includes(to);
}

/** The step is not allowed from the batch's state (FR 10); nothing was written. */
export class BatchStateError extends Error {
  readonly from: BatchState;
  readonly to: BatchState;

  constructor(from: BatchState, to: BatchState) {
    super(`Batch state ${from} → ${to} is not allowed`);
    this.name = "BatchStateError";
    this.from = from;
    this.to = to;
  }
}

/** The state after the step `from` → `to`, or BatchStateError. */
export function move(from: BatchState, to: BatchState): BatchState {
  if (!canMove(from, to)) throw new BatchStateError(from, to);
  return to;
}

/** Files are added only while the batch is «завантажено» (lead decision: a parsed or failed batch takes no more). */
export function takesFiles(state: BatchState): boolean {
  return state === "uploaded";
}

/**
 * The daily cleanup (FR 20, IMP-19 FR 6) takes only a batch that was never applied; an applied or rolled-back one is
 * never removed by it. «Видалити» (FR 12) refuses only an applied batch: it is rolled back first, then deleted.
 */
export function isUnapplied(state: BatchState): boolean {
  return state !== "applied" && state !== "rolled-back";
}

/** FR 20, IMP-19 FR 6: an unapplied batch goes with its originals 30 days after its last action. */
export const UNAPPLIED_RETENTION_DAYS = 30;

/** The moment before which a batch's last action makes it stale (FR 20), from the task's own clock. */
export function staleBefore(now: Date): Date {
  return new Date(now.getTime() - UNAPPLIED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** FR 13: a batch holds up to 50 files and 150 MB of accepted originals together (binary units, as file-storage). */
export const BATCH_LIMITS = Object.freeze({ files: 50, bytes: 150 * 1024 * 1024 });

/** The batch's own ceilings (FR 13): the text names the ceiling and advises splitting, never a plan. */
export const BATCH_REJECTIONS = {
  BATCH_TOO_MANY_FILES: {
    status: 413,
    ceiling: { name: "batchFiles", limit: BATCH_LIMITS.files },
    message: {
      uk: "У партії може бути до 50 файлів. Розділіть завантаження на кілька партій.",
      en: "A batch may have up to 50 files. Split the upload into several batches.",
    },
  },
  BATCH_TOO_LARGE: {
    status: 413,
    ceiling: { name: "batchBytes", limit: BATCH_LIMITS.bytes },
    message: {
      uk: "Файли партії разом більші за 150 МБ. Розділіть файли, наприклад за періодом, на кілька партій.",
      en: "The files of a batch are larger than 150 MB together. Split them, for example by period, into several batches.",
    },
  },
} as const;
export type BatchRejectionCode = keyof typeof BATCH_REJECTIONS;

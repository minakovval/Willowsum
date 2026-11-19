import {
  BATCH_LIMITS,
  BATCH_REJECTIONS,
  move,
  takesFiles,
  type BatchRejectionCode,
  type BatchState,
} from "../domain/index.ts";

/**
 * Import batches of a space (IMP-01@PoC FR 1, FR 3, FR 6, FR 7, FR 10, FR 13, FR 19, FR 21; IMP-19@PoC FR 5).
 * Every file of an upload is read under one budget of the request and stored by `file-storage` (type by content,
 * ceilings, encryption with the space's key); a rejected file is reported on its own and does not stop the others. When
 * the batch has no accepted file after an upload, it is «не вдалося розібрати» and the first rejection is the answer.
 * Every change of a batch enqueues its audit hand-off in the same transaction (ADR-0015); the entry never holds a file's
 * name or content (FR 19).
 */
export interface Batch {
  readonly id: string;
  readonly householdId: string;
  readonly name: string | null;
  readonly state: BatchState;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly lastActionAt: Date;
}

export interface BatchFile {
  readonly id: string;
  readonly batchId: string;
  readonly position: number;
  readonly fileName: string;
  /** The original in file-storage; null for a rejected file. */
  readonly fileId: string | null;
  readonly format: string | null;
  readonly sizeBytes: number | null;
  readonly rejectionCode: string | null;
  readonly createdAt: Date;
}

export const BATCH_ENTITY = "import-sessions.batch" as const;
export const HAND_OFF_ACTIONS = ["create", "update"] as const;

/** The audit entry of a batch's change (FR 21), carried by the hand-off job: ids, states and counts only. */
export interface BatchHandOff {
  readonly entityId: string;
  readonly actorAccountId: string;
  readonly action: (typeof HAND_OFF_ACTIONS)[number];
  readonly changeId: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}

export const handOffKey = (h: BatchHandOff): string =>
  `${BATCH_ENTITY}:${h.action}:${h.entityId}:${h.changeId}`;

export interface BatchesTx {
  insertBatch(batch: Batch): Promise<void>;
  /** The batch, locked for the rest of the transaction. */
  lockBatch(batchId: string): Promise<Batch | null>;
  findBatch(batchId: string): Promise<Batch | null>;
  /** The space's batches, newest first, after the cursor's batch. */
  listBatches(limit: number, after?: { readonly createdAt: Date; readonly id: string }): Promise<Batch[]>;
  files(batchId: string): Promise<BatchFile[]>;
  insertFile(file: BatchFile): Promise<void>;
  /** A new state (or the same one), the version + 1 and the last action now. */
  updateBatch(batchId: string, state: BatchState, at: Date): Promise<Batch>;
  enqueueHandOff(handOff: BatchHandOff): Promise<void>;
}

/** A transaction of the module bound to the caller's space. */
export type SpaceTx = <T>(work: (tx: BatchesTx) => Promise<T>) => Promise<T>;

/** What a rejected file's reason is (file-storage's or the batch's own), for the answer and the row. */
export interface FileRejection {
  readonly code: string;
  readonly status: 413 | 422;
  readonly ceiling?: { readonly name: string; readonly limit: number };
  readonly message: { readonly uk: string; readonly en: string };
}

/** The originals in file-storage (kind «виписка»), as this module uses them. */
export interface Originals {
  /** Reads the file under the request's budget and stores it; `RejectedFile` when it is not accepted. */
  store(request: {
    readonly householdId: string;
    readonly actorId: string;
    readonly fileName: string;
    readonly declaredBytes?: number;
    readonly budget: OriginalsBudget;
    readonly body: AsyncIterable<Uint8Array> & { destroy?(): void };
  }): Promise<{
    readonly id: string;
    readonly format: string;
    readonly sizeBytes: number;
    readonly fileName: string;
  }>;
  /** A budget of one upload request: at most `bytes` of files together (the batch's room, ≤ 150 MiB). */
  budget(declaredBytes: number | undefined, bytes: number): OriginalsBudget;
  /** A file name as file-storage keeps it (one line, no path, ≤ 255 characters): a rejected file's too. */
  cleanName(name: string): string;
  /** Removes an original (one stored past the batch's ceilings); an unknown one is no error. */
  remove(householdId: string, fileId: string, actorId: string): Promise<void>;
}

export type OriginalsBudget = object;

/** A file was not accepted (file-storage's reason, or the batch's ceiling); nothing of it was stored. */
export class RejectedFile extends Error {
  readonly rejection: FileRejection;

  constructor(rejection: FileRejection) {
    super(`File rejected: ${rejection.code}`);
    this.name = "RejectedFile";
    this.rejection = rejection;
  }
}

export function batchRejection(code: BatchRejectionCode): FileRejection {
  return { code, ...BATCH_REJECTIONS[code] };
}

export class BatchNotFoundError extends Error {
  constructor() {
    super("Batch not found");
    this.name = "BatchNotFoundError";
  }
}

export interface BatchesDeps {
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface Handed<R> {
  readonly result: R;
  readonly handOffs: readonly BatchHandOff[];
}

async function handOff(
  tx: BatchesTx,
  deps: BatchesDeps,
  h: Omit<BatchHandOff, "changeId">,
): Promise<BatchHandOff> {
  const full = { ...h, changeId: deps.newId() };
  await tx.enqueueHandOff(full);
  return full;
}

const stateChange = (before: BatchState, after: BatchState) => ({ field: "state", before, after });

/** «Створити партію» (FR 1): the Owner's batch, its name optional, in «завантажено». */
export async function createBatch(
  deps: BatchesDeps,
  tx: BatchesTx,
  actorId: string,
  householdId: string,
  name: string | null,
): Promise<Handed<Batch>> {
  const at = deps.now();
  const batch: Batch = {
    id: deps.newId(),
    householdId,
    name,
    state: "uploaded",
    createdBy: actorId,
    version: 1,
    createdAt: at,
    lastActionAt: at,
  };
  await tx.insertBatch(batch);
  const h = await handOff(tx, deps, {
    entityId: batch.id,
    actorAccountId: actorId,
    action: "create",
    // Never the name (the user's free text): the state and whether it has one.
    changes: [
      stateChange("uploaded", "uploaded"),
      { field: "named", before: null, after: String(name !== null) },
    ],
  });
  return { result: batch, handOffs: [h] };
}

export interface UploadedFile {
  readonly fileName: string;
  readonly stream: AsyncIterable<Uint8Array> & { destroy(): void };
}

export interface FileOutcome {
  readonly file: BatchFile;
  readonly rejection: FileRejection | null;
}

export interface UploadResult {
  readonly batch: Batch;
  readonly files: readonly FileOutcome[];
  /** Every file of this upload was rejected: the first one's reason is the answer (FR 6). */
  readonly firstRejection: FileRejection | null;
}

/**
 * «Додати файли» (FR 3, FR 6, FR 7, FR 13): each file of the upload in turn. A file is checked against the batch's
 * ceilings (50 files, 150 MB) before it is read and again under the batch's lock after file-storage stored it (a
 * parallel upload cannot pass them); an original stored past them is removed again.
 */
export async function addFiles(
  deps: BatchesDeps,
  run: SpaceTx,
  originals: Originals,
  caller: { readonly actorId: string; readonly householdId: string },
  batchId: string,
  upload: { readonly declaredBytes: number | undefined; readonly files: AsyncIterable<UploadedFile> },
): Promise<Handed<UploadResult>> {
  const room = await run(async (tx) => {
    const batch = await tx.findBatch(batchId);
    if (!batch) throw new BatchNotFoundError();
    if (!takesFiles(batch.state)) throw new BatchStateErrorFor(batch.state);
    return BATCH_LIMITS.bytes - used(await tx.files(batchId)).bytes;
  });
  const budget = originals.budget(upload.declaredBytes, Math.max(room, 0));
  const outcomes: FileOutcome[] = [];
  const handOffs: BatchHandOff[] = [];
  for await (const part of upload.files) {
    let stored: Awaited<ReturnType<Originals["store"]>> | null = null;
    let rejection: FileRejection | null = null;
    try {
      const count = await run(async (tx) => used(await tx.files(batchId)).count);
      if (count >= BATCH_LIMITS.files) throw new RejectedFile(batchRejection("BATCH_TOO_MANY_FILES"));
      stored = await originals.store({
        householdId: caller.householdId,
        actorId: caller.actorId,
        fileName: part.fileName,
        ...(upload.declaredBytes !== undefined ? { declaredBytes: upload.declaredBytes } : {}),
        budget,
        body: part.stream,
      });
    } catch (error) {
      if (!(error instanceof RejectedFile)) throw error;
      rejection =
        room < BATCH_LIMITS.bytes && error.rejection.code === "REQUEST_TOO_LARGE"
          ? batchRejection("BATCH_TOO_LARGE")
          : error.rejection;
      part.stream.destroy();
    }
    const kept = stored;
    const outcome = await run(async (tx): Promise<FileOutcome | BatchState | null> => {
      const batch = await tx.lockBatch(batchId);
      if (!batch) return null;
      if (!takesFiles(batch.state)) return batch.state;
      const now = used(await tx.files(batchId));
      if (kept && now.count >= BATCH_LIMITS.files) rejection = batchRejection("BATCH_TOO_MANY_FILES");
      else if (kept && now.bytes + kept.sizeBytes > BATCH_LIMITS.bytes)
        rejection = batchRejection("BATCH_TOO_LARGE");
      const accepted = rejection ? null : kept;
      const file: BatchFile = {
        id: deps.newId(),
        batchId,
        position: now.position + 1,
        fileName: kept?.fileName ?? originals.cleanName(part.fileName),
        fileId: accepted?.id ?? null,
        format: accepted?.format ?? null,
        sizeBytes: accepted?.sizeBytes ?? null,
        rejectionCode: rejection?.code ?? null,
        createdAt: deps.now(),
      };
      await tx.insertFile(file);
      await tx.updateBatch(batchId, batch.state, deps.now());
      handOffs.push(
        await handOff(tx, deps, {
          entityId: batchId,
          actorAccountId: caller.actorId,
          action: "update",
          changes: [
            { field: "files.position", before: null, after: String(file.position) },
            {
              field: rejection ? "files.rejected" : "files.accepted",
              before: null,
              after: rejection?.code ?? file.format,
            },
          ],
        }),
      );
      return { file, rejection };
    });
    // Past the batch's ceilings under its lock, or the batch left «завантажено» meanwhile: the original goes.
    if (kept && (rejection || outcome === null || typeof outcome === "string"))
      await originals.remove(caller.householdId, kept.id, caller.actorId);
    if (outcome === null) throw new BatchNotFoundError();
    if (typeof outcome === "string") throw new BatchStateErrorFor(outcome);
    outcomes.push(outcome);
  }
  const final = await run(async (tx) => {
    const batch = await tx.lockBatch(batchId);
    if (!batch) throw new BatchNotFoundError();
    const accepted = (await tx.files(batchId)).filter((f) => f.fileId !== null).length;
    // FR 6: every file of the batch rejected → «в обробці» → «не вдалося розібрати».
    if (outcomes.length > 0 && accepted === 0 && batch.state === "uploaded") {
      const failed = await tx.updateBatch(
        batchId,
        move(move(batch.state, "processing"), "failed"),
        deps.now(),
      );
      handOffs.push(
        await handOff(tx, deps, {
          entityId: batchId,
          actorAccountId: caller.actorId,
          action: "update",
          changes: [stateChange(batch.state, failed.state)],
        }),
      );
      return failed;
    }
    return batch;
  });
  const allRejected = outcomes.length > 0 && outcomes.every((o) => o.rejection !== null);
  return {
    result: { batch: final, files: outcomes, firstRejection: allRejected ? outcomes[0]!.rejection : null },
    handOffs,
  };
}

/** The batch's state does not allow the step (FR 10). */
export class BatchStateErrorFor extends Error {
  readonly state: BatchState;

  constructor(state: BatchState) {
    super(`Batch in state ${state}`);
    this.name = "BatchStateErrorFor";
    this.state = state;
  }
}

function used(files: readonly BatchFile[]): { count: number; bytes: number; position: number } {
  let bytes = 0;
  let position = 0;
  for (const f of files) {
    bytes += f.sizeBytes ?? 0;
    position = Math.max(position, f.position);
  }
  return { count: files.length, bytes, position };
}

export interface BatchView {
  readonly batch: Batch;
  readonly files: readonly BatchFile[];
}

export async function viewBatch(tx: BatchesTx, batchId: string): Promise<BatchView> {
  const batch = await tx.findBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  return { batch, files: await tx.files(batchId) };
}

/** An accepted file of the batch (FR 7: its original opens through a short signed link). */
export async function originalOf(tx: BatchesTx, batchId: string, batchFileId: string): Promise<string> {
  const { files } = await viewBatch(tx, batchId);
  const file = files.find((f) => f.id === batchFileId);
  if (!file?.fileId) throw new BatchNotFoundError();
  return file.fileId;
}

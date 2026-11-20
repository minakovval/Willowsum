import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthApi, type Outcome } from "../auth/api.ts";
import {
  cancelBatch,
  confirmAccount,
  createBatch,
  loadActiveAccounts,
  loadBatch,
  loadParse,
  loadReadiness,
  MAX_FILE_BYTES,
  problemRejection,
  startParse,
  uploadFiles,
  type AccountItem,
  type AccountRefusal,
  type BatchDetail,
  type FileParse,
} from "./api.ts";
import { rowsOf, type FileRow, type Local } from "./model.ts";

/** How often the parse is read while a file is pending; tests set it low. */
export const POLLING = { ms: 1000 };

export type Failure = Exclude<Outcome<unknown>, { ok: true }>;

export type AccountsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly accounts: readonly AccountItem[] }
  | { readonly kind: "error"; readonly supportId: string | undefined };

export type BatchState =
  | { readonly kind: "none" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly supportId: string | undefined };

const supportOf = (o: Failure): string | undefined => (o.kind === "problem" ? o.supportId : undefined);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * IMP-08@PoC a) (wave 2, row 136): the state machine of the step «Рахунок і файли». The first file creates the batch
 * (`POST /v1/import/batches`) and the address becomes `/import/<batch>` (FR 1: a reload returns here); the files go up as
 * one multipart request and each answer is kept apart (IMP-01 FR 6); every accepted file is parsed in the background
 * (`POST …/parse`) and the parse is read until no file is pending; then the readiness says which files still need an
 * account (IMP-05 FR 4). A file's account is chosen by the user through a new parse of that one file.
 */
export function useImportStep(batchIdProp: string | null, openBatch: (batchId: string) => void) {
  const api = useAuthApi();
  const [accounts, setAccounts] = useState<AccountsState>({ kind: "loading" });
  const [accountsRound, setAccountsRound] = useState(0);
  const [batch, setBatch] = useState<BatchState>(batchIdProp ? { kind: "loading" } : { kind: "none" });
  const [files, setFiles] = useState<BatchDetail["fileList"]>([]);
  const [parse, setParse] = useState<ReadonlyMap<string, FileParse>>(new Map());
  const [refusals, setRefusals] = useState<ReadonlyMap<string, AccountRefusal>>(new Map());
  const [locals, setLocals] = useState<readonly Local[]>([]);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState<string | null>(null);

  const batchId = useRef<string | null>(null);
  const alive = useRef(true);
  const polling = useRef(0);
  const keys = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const o = await loadActiveAccounts(api);
      if (!live) return;
      setAccounts(o.ok ? { kind: "ready", accounts: o.data } : { kind: "error", supportId: supportOf(o) });
    })();
    return () => {
      live = false;
    };
  }, [api, accountsRound]);

  const reloadAccounts = useCallback(() => {
    setAccounts({ kind: "loading" });
    setAccountsRound((n) => n + 1);
  }, []);

  /** Reads the parse until no file is pending, then the readiness (the files that still need an account). */
  const poll = useCallback(
    async (id: string) => {
      const mine = ++polling.current;
      const current = () => alive.current && polling.current === mine && batchId.current === id;
      for (;;) {
        const p = await loadParse(api, id);
        if (!current()) return;
        if (!p.ok) {
          setRefreshFailed(true);
          return;
        }
        setRefreshFailed(false);
        setParse(new Map(p.data.files.map((f) => [f.fileId, f])));
        if (p.data.progress.pending === 0) break;
        await sleep(POLLING.ms);
        if (!current()) return;
      }
      const r = await loadReadiness(api, id);
      if (!current()) return;
      const left = r.ok ? r.data.refusals.flatMap((x) => (x.code === "confirm-account" ? x.files : [])) : [];
      setRefusals(new Map(left.map((f) => [f.fileId, f])));
    },
    [api],
  );

  /** A batch opened by its address (or a retry): its files, then the parse — started when nobody started it. */
  const resume = useCallback(
    async (id: string) => {
      const b = await loadBatch(api, id);
      if (!alive.current || batchId.current !== id) return;
      if (!b.ok) {
        const missing = b.kind === "problem" && b.problem.code === "NOT_FOUND";
        setBatch(missing ? { kind: "missing" } : { kind: "error", supportId: supportOf(b) });
        return;
      }
      setFiles(b.data.fileList);
      setBatch({ kind: "ready" });
      const accepted = b.data.fileList.filter((f) => f.status === "accepted");
      if (accepted.length === 0) return;
      if (b.data.state === "uploaded") {
        const s = await startParse(
          api,
          id,
          accepted.map((f) => ({ fileId: f.id })),
        );
        if (!alive.current || batchId.current !== id) return;
        if (!s.ok) {
          setRefreshFailed(true);
          return;
        }
      }
      await poll(id);
    },
    [api, poll],
  );

  useEffect(() => {
    if (!batchIdProp || batchIdProp === batchId.current) return;
    batchId.current = batchIdProp;
    setBatch({ kind: "loading" });
    void resume(batchIdProp);
  }, [batchIdProp, resume]);

  const retryResume = useCallback(() => {
    const id = batchId.current;
    if (!id) return;
    setRefreshFailed(false);
    void resume(id);
  }, [resume]);

  const send = useCallback(
    async (sending: readonly Local[]) => {
      const sent = new Set(sending.map((l) => l.key));
      const mark = (phase: "network" | "rejected", code: string | null) =>
        setLocals((all) => all.map((l) => (sent.has(l.key) ? { ...l, phase, code, message: null } : l)));
      setLocals((all) => all.map((l) => (sent.has(l.key) ? { ...l, phase: "uploading", code: null } : l)));
      let id = batchId.current;
      if (!id) {
        const c = await createBatch(api);
        if (!alive.current) return;
        if (!c.ok) {
          mark(
            c.kind === "network" ? "network" : "rejected",
            c.kind === "problem" ? (c.problem.code ?? null) : null,
          );
          return;
        }
        id = c.data.id;
        batchId.current = id;
        setBatch({ kind: "ready" });
        openBatch(id);
      }
      const up = await uploadFiles(
        api,
        id,
        sending.flatMap((l) => (l.file ? [l.file] : [])),
      );
      if (!alive.current || batchId.current !== id) return;
      if (!up.ok) {
        // Every file was refused: the first reason comes as a problem with the rejection's code (IMP-01 FR 6).
        mark(
          up.kind === "network" ? "network" : "rejected",
          problemRejection(up)?.code ?? (up.kind === "problem" ? (up.problem.code ?? null) : null),
        );
        return;
      }
      const refused: Local[] = up.data.refused.map((r) => ({
        key: `l${++keys.current}`,
        name: r.fileName,
        size: null,
        file: null,
        phase: "rejected",
        code: r.rejection.code,
        message: r.rejection.message,
      }));
      setLocals((all) => [...all.filter((l) => !sent.has(l.key)), ...refused]);
      const b = await loadBatch(api, id);
      if (!alive.current || batchId.current !== id) return;
      if (b.ok) setFiles(b.data.fileList);
      const accepted = up.data.files.filter((f) => f.status === "accepted");
      if (accepted.length === 0) return;
      const s = await startParse(
        api,
        id,
        accepted.map((f) => ({ fileId: f.id })),
      );
      if (!alive.current || batchId.current !== id) return;
      if (!s.ok) {
        setRefreshFailed(true);
        return;
      }
      setParse((old) => new Map([...old, ...accepted.map((f) => [f.id, pendingOf(f.id)] as const)]));
      await poll(id);
    },
    [api, openBatch, poll],
  );

  /** The files the user picked or dropped: too large ones are refused here (FR 13), the rest go up together. */
  const addFiles = useCallback(
    (picked: readonly File[]) => {
      const added: Local[] = picked.map((file) => {
        const big = file.size > MAX_FILE_BYTES;
        return {
          key: `l${++keys.current}`,
          name: file.name,
          size: file.size,
          file,
          phase: big ? "rejected" : "uploading",
          code: big ? "FILE_TOO_LARGE" : null,
          message: null,
        };
      });
      setLocals((all) => [...all, ...added]);
      const sending = added.filter((l) => l.phase === "uploading");
      if (sending.length > 0) void send(sending);
    },
    [send],
  );

  const retryUpload = useCallback(
    (key: string) => {
      const l = locals.find((x) => x.key === key);
      if (l?.file) void send([l]);
    },
    [locals, send],
  );

  const dismiss = useCallback((key: string) => setLocals((all) => all.filter((l) => l.key !== key)), []);

  /** A file whose parse failed is parsed again (the same file, the same batch). */
  const retryParse = useCallback(
    async (fileId: string) => {
      const id = batchId.current;
      if (!id) return;
      setParse((old) => new Map([...old, [fileId, pendingOf(fileId)]]));
      const s = await startParse(api, id, [{ fileId }]);
      if (!alive.current || batchId.current !== id) return;
      if (!s.ok) {
        setRefreshFailed(true);
        return;
      }
      await poll(id);
    },
    [api, poll],
  );

  /** FR 2: the file's account. The same account the file shows evidence against is confirmed; another is parsed for. */
  const choose = useCallback(
    async (fileId: string, accountId: string) => {
      const id = batchId.current;
      if (!id) return;
      setSaveFailed(null);
      const own = parse.get(fileId);
      if (own?.accountId === accountId && refusals.has(fileId)) {
        const o = await confirmAccount(api, id, fileId);
        if (!alive.current) return;
        if (!o.ok) {
          setSaveFailed(fileId);
          return;
        }
        await poll(id);
        return;
      }
      setParse((old) => new Map([...old, [fileId, pendingOf(fileId)]]));
      const s = await startParse(api, id, [{ fileId, accountId }]);
      if (!alive.current || batchId.current !== id) return;
      if (!s.ok) {
        setSaveFailed(fileId);
        await poll(id);
        return;
      }
      await poll(id);
    },
    [api, parse, poll, refusals],
  );

  /** «Скасувати»: the open batch closes without writing anything; a failure does not keep the user here. */
  const cancel = useCallback(async () => {
    const id = batchId.current;
    if (id) await cancelBatch(api, id);
  }, [api]);

  const rows: FileRow[] = useMemo(
    () => rowsOf({ files, parse, refusals, locals }),
    [files, parse, refusals, locals],
  );

  return {
    accounts,
    reloadAccounts,
    batch,
    rows,
    refreshFailed,
    retryResume,
    saveFailed,
    addFiles,
    retryUpload,
    dismiss,
    retryParse,
    choose,
    cancel,
  };
}

function pendingOf(fileId: string): FileParse {
  return {
    fileId,
    position: 0,
    state: "pending",
    refusal: null,
    recipe: null,
    accountId: null,
    engineVersion: "",
    rowCount: null,
    checks: null,
    history: null,
    previousFileId: null,
  };
}

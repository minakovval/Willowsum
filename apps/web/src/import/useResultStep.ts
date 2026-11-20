import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthApi, type Outcome } from "../auth/api.ts";
import { armApply, takeApplyIntent } from "./applyIntent.ts";
import { loadBatch, type BatchDetail } from "./api.ts";
import {
  applyBatch,
  loadResult,
  rollbackBatch,
  type BatchResult,
  type RolledBack,
  type RollbackMode,
} from "./resultApi.ts";
import { refusedRows, type RefusedRow } from "./resultModel.ts";
import { failureOf, type Failure } from "./useReviewStep.ts";

type Api = ReturnType<typeof useAuthApi>;
type Failed = Exclude<Outcome<unknown>, { ok: true }>;

/** What the step shows. «applying» is the apply in progress; «refused» the apply that could not write rows (all or nothing). */
export type ResultView =
  | { readonly kind: "loading" }
  | { readonly kind: "applying" }
  /** A reviewed batch, not applied yet, opened without a click on «Застосувати»: nothing is written until the button is pressed. */
  | { readonly kind: "ready" }
  | { readonly kind: "missing" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "not-parsed" }
  | { readonly kind: "error"; readonly where: "batch" | "apply" | "result"; readonly failure: Failure }
  | {
      readonly kind: "refused";
      readonly failure: Failure;
      readonly rows: readonly RefusedRow[];
      readonly names: ReadonlyMap<string, string>;
    }
  | {
      readonly kind: "done";
      readonly result: BatchResult;
      /** The batch was applied before this visit (opened again, or the apply returned the stored result). */
      readonly already: boolean;
    };

const problemOf = (o: Failed) => (o.kind === "problem" ? o.problem : null);

/**
 * One run per batch at a time: React strict mode runs an effect twice, and a second call of the apply would only join
 * the first (IMP-04 FR 7) — but one request is enough.
 */
const running = new Map<string, Promise<ResultView>>();

async function run(
  api: Api,
  batchId: string,
  intent: boolean,
  setView: (v: ResultView) => void,
): Promise<ResultView> {
  const b = await loadBatch(api, batchId);
  if (!b.ok) {
    const p = problemOf(b);
    return p?.code === "NOT_FOUND"
      ? { kind: "missing" }
      : { kind: "error", where: "batch", failure: failureOf(b) };
  }
  const state = b.data.state;
  if (state === "cancelled") return { kind: "cancelled" };
  const finished = state === "applied" || state === "rolled-back";
  if (!finished && state !== "parsed" && state !== "needs-review") return { kind: "not-parsed" };
  let already = finished;
  if (finished && b.data.applying) {
    // Applied but still reported as applying: the idempotent apply (IMP-04 FR 7) settles it and returns the stored result.
    const a = await applyBatch(api, batchId);
    if (!a.ok) return refusal(a, b.data);
  }
  if (!finished) {
    if (!intent) return { kind: "ready" };
    setView({ kind: "applying" });
    const a = await applyBatch(api, batchId);
    if (!a.ok) return refusal(a, b.data);
    already = !a.data.first;
  }
  const r = await loadResult(api, batchId);
  if (!r.ok) return { kind: "error", where: "result", failure: failureOf(r) };
  return { kind: "done", result: r.data, already };
}

function refusal(o: Failed, batch: BatchDetail): ResultView {
  const failure = failureOf(o);
  const p = problemOf(o);
  if (p?.code === "IMPORT_ROWS_REFUSED")
    return {
      kind: "refused",
      failure,
      rows: refusedRows(p.errors),
      names: new Map(batch.fileList.map((f) => [f.id, f.fileName])),
    };
  if (p?.code === "NOT_FOUND") return { kind: "missing" };
  return { kind: "error", where: "apply", failure };
}

/**
 * IMP-08@PoC c) (wave 2, row 138): the state of the step «Результат». The apply runs only after a click of «Застосувати»
 * (the review step arms a one-shot intent, or the step shows the button itself for a batch opened by address): the batch is
 * read; a batch not applied yet and with an intent is applied (all
 * rows or none, IMP-05 FR 11; the call is idempotent, IMP-04 FR 7, so a retry or a reload never writes twice); a batch applied
 * before is not applied again. Then the result is read — the stored counts and what is left to do after the apply (#673).
 * «Відкотити» sends the rollback and reads the result again.
 */
export function useResultStep(batchId: string) {
  const api = useAuthApi();
  const [view, setView] = useState<ResultView>({ kind: "loading" });
  const [round, setRound] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [rollbackFailure, setRollbackFailure] = useState<Failure | null>(null);
  const [rolledBack, setRolledBack] = useState<RolledBack["rollback"] | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    // One run per batch, whatever the round: a new round joins the run in flight instead of starting a second apply.
    const key = batchId;
    // The intent is spent by every visit, also one that joins a run in flight, so none is left for a later visit by address.
    const intent = takeApplyIntent(batchId);
    let p = running.get(key);
    if (!p) {
      p = run(api, batchId, intent, (v) => {
        if (alive.current) setView(v);
      }).finally(() => running.delete(key));
      running.set(key, p);
    }
    let live = true;
    void p.then((v) => {
      if (live) setView(v);
    });
    return () => {
      live = false;
    };
  }, [api, batchId, round]);

  const retry = useCallback(() => {
    // «Спробувати ще раз» after a failed or refused apply is a new click on the apply; after a failed read it only reads.
    if (view.kind === "refused" || (view.kind === "error" && view.where === "apply")) armApply(batchId);
    setView({ kind: "loading" });
    setRound((n) => n + 1);
  }, [batchId, view]);

  /** «Застосувати» on this step: the click is the intent. */
  const apply = useCallback(() => {
    if (running.has(batchId)) return;
    armApply(batchId);
    setView({ kind: "applying" });
    setRound((n) => n + 1);
  }, [batchId]);

  const rollback = useCallback(
    async (mode: RollbackMode): Promise<boolean> => {
      setRolling(true);
      setRollbackFailure(null);
      const o = await rollbackBatch(api, batchId, mode);
      if (!alive.current) return false;
      if (!o.ok) {
        setRollbackFailure(failureOf(o));
        setRolling(false);
        return false;
      }
      setRolledBack(o.data.rollback);
      const r = await loadResult(api, batchId);
      if (!alive.current) return true;
      if (r.ok) setView({ kind: "done", result: r.data, already: true });
      else setView({ kind: "error", where: "result", failure: failureOf(r) });
      setRolling(false);
      return true;
    },
    [api, batchId],
  );

  const clearRollbackFailure = useCallback(() => setRollbackFailure(null), []);

  return { view, retry, apply, rollback, clearRollbackFailure, rolling, rollbackFailure, rolledBack };
}

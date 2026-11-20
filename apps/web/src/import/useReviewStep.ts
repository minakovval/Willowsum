import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthApi, type Outcome } from "../auth/api.ts";
import {
  loadBatch,
  loadParse,
  loadReadiness,
  type BatchDetail,
  type FileParse,
  type Readiness,
} from "./api.ts";
import {
  decide,
  loadDuplicates,
  loadFileRows,
  loadReview,
  loadReviewRows,
  PAGE,
  type DecisionInput,
  type Duplicate,
  type FileReview,
  type FileRow,
  type ReviewFilter,
  type ReviewRow,
} from "./reviewApi.ts";
import { QUESTION_FILTERS, reviewFiles, type ReviewFile, type Tab } from "./reviewModel.ts";
import { POLLING } from "./useImportStep.ts";

/** What went wrong, as the screen shows it: the API's code and the support id (ARC-09 FR 3), or a lost connection. */
export interface Failure {
  readonly code: string | null;
  readonly supportId: string | undefined;
  readonly network: boolean;
}

export const failureOf = (o: Exclude<Outcome<unknown>, { ok: true }>): Failure =>
  o.kind === "problem"
    ? { code: o.problem.code ?? null, supportId: o.supportId, network: false }
    : { code: null, supportId: undefined, network: true };

export type Base =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly failure: Failure }
  | { readonly kind: "closed"; readonly state: BatchDetail["state"] }
  | {
      readonly kind: "ready";
      readonly files: readonly ReviewFile[];
      readonly readiness: Readiness;
    };

export type Part<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly failure: Failure }
  | { readonly kind: "ready"; readonly data: T };

export interface Listing {
  readonly status: "loading" | "ready" | "error";
  readonly items: readonly ReviewRow[];
  readonly more: boolean;
  readonly failure: Failure | null;
  readonly loadingMore: boolean;
  /** The file, tab and filter the rows belong to: rows of another list are never shown as this one's. */
  readonly key: string;
}

const EMPTY: Listing = {
  status: "loading",
  items: [],
  more: false,
  failure: null,
  loadingMore: false,
  key: "",
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * IMP-08@PoC b) (wave 2, row 137): the state of the step «Перевірка розпізнавання». The batch, its parse and its readiness
 * (the banners, what still blocks «Застосувати») are read first; then, for the chosen file, its review (counts, sign group),
 * the duplicates the apply would skip and the rows — a page of 50 at a time under the filter or the question tab. The values of
 * a row (date, text, amount) are the file's rows, read in order as far as the listed rows need. Every answer of the person is
 * one `POST …/decisions`; afterwards the readiness, the review, the duplicates and the loaded rows are read again.
 */
export function useReviewStep(batchId: string) {
  const api = useAuthApi();
  const [base, setBase] = useState<Base>({ kind: "loading" });
  const [fileId, setFileId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("questions");
  const [filter, setFilter] = useState<ReviewFilter | "all">("all");
  const [review, setReview] = useState<Part<FileReview>>({ kind: "loading" });
  const [duplicates, setDuplicates] = useState<
    Part<{ items: readonly Duplicate[]; afterEarlierFile: boolean }>
  >({ kind: "loading" });
  const [listing, setListing] = useState<Listing>(EMPTY);
  const [values, setValues] = useState<ReadonlyMap<number, FileRow>>(new Map());
  const [deciding, setDeciding] = useState(false);
  const [decisionFailure, setDecisionFailure] = useState<Failure | null>(null);
  const [round, setRound] = useState(0);
  const [baseRound, setBaseRound] = useState(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 1. The batch, its parse and its readiness (the parse is read until no file is pending).
  useEffect(() => {
    let live = true;
    void (async () => {
      for (;;) {
        const b = await loadBatch(api, batchId);
        if (!live) return;
        if (!b.ok) {
          setBase(
            b.kind === "problem" && b.problem.code === "NOT_FOUND"
              ? { kind: "missing" }
              : { kind: "error", failure: failureOf(b) },
          );
          return;
        }
        if (["applied", "rolled-back", "cancelled"].includes(b.data.state)) {
          setBase({ kind: "closed", state: b.data.state });
          return;
        }
        const p = await loadParse(api, batchId);
        if (!live) return;
        if (!p.ok) {
          setBase({ kind: "error", failure: failureOf(p) });
          return;
        }
        if (p.data.progress.pending > 0) {
          await sleep(POLLING.ms);
          if (!live) return;
          continue;
        }
        const r = await loadReadiness(api, batchId);
        if (!live) return;
        if (!r.ok) {
          setBase({ kind: "error", failure: failureOf(r) });
          return;
        }
        const files = reviewFiles(b.data, new Map(p.data.files.map((f) => [f.fileId, f as FileParse])));
        setBase({ kind: "ready", files, readiness: r.data });
        setFileId((now) => (now && files.some((f) => f.fileId === now) ? now : (files[0]?.fileId ?? null)));
        return;
      }
    })();
    return () => {
      live = false;
    };
  }, [api, batchId, baseRound]);

  // 2. The review and the duplicates of the chosen file.
  useEffect(() => {
    if (!fileId || base.kind !== "ready") return;
    let live = true;
    void (async () => {
      const [r, d] = await Promise.all([
        loadReview(api, batchId, fileId),
        loadDuplicates(api, batchId, fileId),
      ]);
      if (!live) return;
      setReview(r.ok ? { kind: "ready", data: r.data } : { kind: "error", failure: failureOf(r) });
      setDuplicates(d.ok ? { kind: "ready", data: d.data } : { kind: "error", failure: failureOf(d) });
    })();
    return () => {
      live = false;
    };
    // `base` changes with each readiness read; the review follows the decisions through `round`.
  }, [api, batchId, fileId, round, base.kind]);

  // 3. The rows: one stream of pages (the questions tab chains three filters), kept as far as the person has loaded.
  const stream = useRef({ gen: 0, index: 0, cursor: null as string | null, done: false });
  const cache = useRef({
    rows: new Map<number, FileRow>(),
    cursor: null as string | null,
    done: false,
    max: 0,
    key: "",
  });
  const roundRef = useRef(0);
  roundRef.current = round;
  const loaded = useRef(PAGE);
  const filters = useMemo<readonly (ReviewFilter | undefined)[]>(
    () => (tab === "questions" ? QUESTION_FILTERS : [filter === "all" ? undefined : filter]),
    [tab, filter],
  );
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const listKey = `${fileId ?? ""}|${tab}|${filter}`;
  const keyRef = useRef(listKey);
  keyRef.current = listKey;

  const fill = useCallback(
    async (gen: number, target: number, from: readonly ReviewRow[]) => {
      if (!fileId) return;
      const items = [...from];
      const listId = keyRef.current;
      const key = `${batchId}/${fileId}/${roundRef.current}`;
      if (cache.current.key !== key)
        cache.current = { rows: new Map(), cursor: null, done: false, max: 0, key };
      const s = stream.current;
      const current = () => alive.current && s.gen === gen;
      while (items.length < target && !s.done) {
        const page = await loadReviewRows(api, batchId, fileId, filtersRef.current[s.index], s.cursor);
        if (!current()) return;
        if (!page.ok) {
          setListing({
            status: "error",
            items,
            more: false,
            failure: failureOf(page),
            loadingMore: false,
            key: listId,
          });
          return;
        }
        items.push(...page.data.items);
        s.cursor = page.data.nextCursor;
        if (s.cursor === null) {
          s.index += 1;
          if (s.index >= filtersRef.current.length) s.done = true;
        }
        // The values of the listed rows: the file's rows are read in order up to the last listed row.
        const last = items.at(-1)?.row ?? 0;
        while (!cache.current.done && cache.current.max < last) {
          const v = await loadFileRows(api, batchId, fileId, cache.current.cursor);
          if (!current()) return;
          if (!v.ok) {
            setListing({
              status: "error",
              items,
              more: false,
              failure: failureOf(v),
              loadingMore: false,
              key: listId,
            });
            return;
          }
          for (const r of v.data.items) {
            cache.current.rows.set(r.row, r);
            cache.current.max = Math.max(cache.current.max, r.row);
          }
          cache.current.cursor = v.data.nextCursor;
          if (cache.current.cursor === null) cache.current.done = true;
        }
      }
      setValues(new Map(cache.current.rows));
      setListing({ status: "ready", items, more: !s.done, failure: null, loadingMore: false, key: listId });
    },
    [api, batchId, fileId],
  );

  useEffect(() => {
    if (!fileId || base.kind !== "ready") return;
    stream.current = { gen: stream.current.gen + 1, index: 0, cursor: null, done: false };
    loaded.current = PAGE;
    void fill(stream.current.gen, PAGE, []);
  }, [fileId, filters, base.kind, fill]);

  const more = useCallback(() => {
    loaded.current += PAGE;
    setListing((l) => ({ ...l, loadingMore: true }));
    void fill(stream.current.gen, loaded.current, listing.items);
  }, [fill, listing.items]);

  const retryList = useCallback(() => {
    stream.current = { gen: stream.current.gen + 1, index: 0, cursor: null, done: false };
    setListing(EMPTY);
    void fill(stream.current.gen, loaded.current, []);
  }, [fill]);

  const retryBase = useCallback(() => {
    setBase({ kind: "loading" });
    setBaseRound((n) => n + 1);
  }, []);

  const retryReview = useCallback(() => {
    setReview({ kind: "loading" });
    setDuplicates({ kind: "loading" });
    setRound((n) => n + 1);
  }, []);

  /** An answer of the person; afterwards everything that depends on it is read again. */
  const answer = useCallback(
    async (decisions: readonly DecisionInput[]) => {
      setDeciding(true);
      setDecisionFailure(null);
      const o = await decide(api, batchId, decisions);
      if (!alive.current) return;
      if (!o.ok) {
        setDecisionFailure(failureOf(o));
        setDeciding(false);
        return;
      }
      const r = await loadReadiness(api, batchId);
      if (!alive.current) return;
      if (r.ok) setBase((b) => (b.kind === "ready" ? { ...b, readiness: r.data } : b));
      stream.current = { gen: stream.current.gen + 1, index: 0, cursor: null, done: false };
      setRound((n) => n + 1);
      setDeciding(false);
    },
    [api, batchId],
  );

  // A new round (after a decision) reads the rows again, as many as were loaded.
  const lastRound = useRef(0);
  useEffect(() => {
    if (round === lastRound.current) return;
    lastRound.current = round;
    if (!fileId || base.kind !== "ready") return;
    stream.current = { gen: stream.current.gen + 1, index: 0, cursor: null, done: false };
    void fill(stream.current.gen, loaded.current, []);
  }, [round, fileId, base.kind, fill]);

  const selectFile = useCallback((id: string) => {
    setFileId(id);
    setReview({ kind: "loading" });
    setDuplicates({ kind: "loading" });
  }, []);

  return {
    base,
    retryBase,
    fileId,
    selectFile,
    tab,
    setTab,
    filter,
    setFilter,
    review,
    duplicates,
    retryReview,
    // Rows of another file, tab or filter are not this list's: it is loading until its own page arrives.
    listing: listing.key === listKey ? listing : EMPTY,
    values,
    more,
    retryList,
    answer,
    deciding,
    decisionFailure,
  };
}

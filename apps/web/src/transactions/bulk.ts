import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ApiClient, operations } from "@willowsum/api-contract";
import { Decimal } from "@willowsum/domain-kernel";
import { formatLocaleOf, type Locale, type MessageKey, type Translate } from "@willowsum/i18n";
import type { SelectionSum } from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import type { ListSummary } from "./list.ts";

/**
 * DAT-03@PoC b) (wave 2, row 118): the selection of «Транзакції» (FR 1), its sum (CMP-73, BUD-13 FR 9), and the bulk
 * actions of S-036 on the merged server part (`/v1/bulk-actions`, row 17; actions of rows 20, 21, 24).
 */
type Json<T, S extends number = 200> = T extends {
  responses: { [K in S]: { content: { "application/json": infer B } } };
}
  ? B
  : never;
export type BulkPreview = Json<operations["previewBulkAction"]>;
export type BulkReport = Json<operations["startBulkAction"], 201>;
export type BulkSelection = NonNullable<
  operations["startBulkAction"]["requestBody"]
>["content"]["application/json"]["selection"];
type SelectionSummary = Json<operations["summarizeTransactionSelection"]>;
export type SkipReason = keyof BulkReport["skipped"];

/** The three actions of the panel of «Транзакції» (DAT-03 FR 2, AC12), in the order of the menu. */
export const BULK_ACTIONS = ["setCategory", "addTags", "confirmCategory"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const ACTION_NAME: Readonly<Record<BulkAction, string>> = {
  setCategory: "transactions.set-category",
  addTags: "transactions.add-tags",
  confirmCategory: "transactions.confirm-category",
};
export function actionOf(name: string): BulkAction | null {
  return BULK_ACTIONS.find((a) => ACTION_NAME[a] === name) ?? null;
}

/** DAT-03 FR 7, NFR-15 FR 17: the most records of one action. */
export const BULK_MAX = 500;
/** BUD-13 FR 2 (DAT-03 FR 2): a tag is 1–60 characters; a transaction holds up to 20. */
export const TAG_MAX = 60;
export const TAGS_MAX = 20;

/** The selection of the list: ticked rows (id → the row's name, for the examples), or «усі за фільтром» less some. */
export type Selection =
  | { readonly kind: "ids"; readonly ids: ReadonlyMap<string, string> }
  | { readonly kind: "filter"; readonly excluded: ReadonlySet<string> };

/** FR 1: «усі за фільтром» sends the filter's conditions and the rows unticked by hand, not a list of ids. */
export function selectionBody(selection: Selection, filter: readonly string[]): BulkSelection {
  return selection.kind === "ids"
    ? { kind: "ids", ids: [...selection.ids.keys()] }
    : { kind: "filter", filter: [...filter], excluded: [...selection.excluded] };
}

/** «Теги» of «Додати теги»: names separated by commas, trimmed, without repeats (case aside); null when not valid. */
export function parseTags(text: string): string[] | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const name = part.trim();
    if (name === "") continue;
    if ([...name].length > TAG_MAX) return null;
    const key = name.toLocaleLowerCase("uk");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.length === 0 || out.length > TAGS_MAX ? null : out;
}

const FORMS = ["one", "few", "many", "other"] as const;
type Plural = "bulk.tx" | "bulk.converted" | "tx.summary.nearest";
/** A counted phrase in the interface language: «10 транзакцій», «2 транзакції конвертовано». */
export function plural(t: Translate, locale: Locale, base: Plural, count: number): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count });
}

const REASON_KEY: Readonly<Record<SkipReason, MessageKey>> = {
  unavailable: "bulk.reason.unavailable",
  unchanged: "bulk.reason.unchanged",
  conflict: "bulk.reason.conflict",
  invalid: "bulk.reason.invalid",
};
export const reasonText = (t: Translate, reason: SkipReason) => t(REASON_KEY[reason]);

/** «без змін» alone, or «без змін — 4, конфлікт — 2» (DAT-03 FR 3, FR 8). */
export function reasonsText(t: Translate, skipped: Readonly<Record<SkipReason, number>>): string {
  const present = (Object.keys(REASON_KEY) as SkipReason[]).filter((r) => skipped[r] > 0);
  if (present.length === 1) return reasonText(t, present[0]!);
  return present
    .map((r) => t("bulk.reason.count", { reason: reasonText(t, r), count: skipped[r] }))
    .join(", ");
}
export const skippedCount = (s: Readonly<Record<SkipReason, number>>) =>
  s.unavailable + s.unchanged + s.conflict + s.invalid;

/** FR 4 «невалідний (з поясненням)»: the record's own validation, by the server's issue code. */
const ISSUE_KEY: Readonly<Record<string, MessageKey>> = {
  "transaction.merged": "bulk.issue.merged",
  "transaction.in_transfer": "bulk.issue.transfer",
  "transaction.split": "bulk.issue.split",
  "category.not_found": "bulk.issue.category",
  "category.invalid": "bulk.issue.category",
  "account.closed": "bulk.issue.closed",
  "tags.too_many": "bulk.issue.tooManyTags",
  "tags.invalid": "bulk.issue.tags",
  "transaction.not_in_review": "bulk.issue.review",
  "review.invalid": "bulk.issue.review",
  audit_size: "bulk.issue.size",
};
export const issueText = (t: Translate, issue: string | null) =>
  t(issue === null ? "bulk.issue.other" : (ISSUE_KEY[issue] ?? "bulk.issue.other"));

/** What a failed bulk request shows: the limit (AC10), another action running (AC7), or «Дію не виконано» with a code. */
export type BulkFailure =
  | { readonly kind: "limit"; readonly limit: number }
  | { readonly kind: "running" }
  | { readonly kind: "failed"; readonly code?: string | undefined };
export function bulkFailure(o: Exclude<Outcome<unknown>, { ok: true }>): BulkFailure {
  if (o.kind === "problem") {
    if (o.problem.code === "LIMIT_REACHED") {
      const limit = (o.problem as { limit?: unknown }).limit;
      return { kind: "limit", limit: typeof limit === "number" ? limit : BULK_MAX };
    }
    if (o.problem.code === "BULK_ACTION_RUNNING") return { kind: "running" };
    return { kind: "failed", code: o.supportId };
  }
  return { kind: "failed" };
}

export const previewBulk = (api: ApiClient, body: BulkBody) =>
  outcome(api.POST("/v1/bulk-actions/preview", { body }));
export const startBulk = (api: ApiClient, body: BulkBody, key: string) =>
  outcome(api.POST("/v1/bulk-actions", { params: { header: { "Idempotency-Key": key } }, body }));
export type BulkBody = NonNullable<
  operations["previewBulkAction"]["requestBody"]
>["content"]["application/json"];

/**
 * The action this session follows (FR 6, AC2): kept outside the screen so the progress goes on while the user is
 * elsewhere, and in the tab's session storage so a reload finds it. `label` — the category name of «Змінити категорію».
 */
export interface Tracked {
  readonly id: string;
  readonly label?: string | undefined;
  readonly report: BulkReport | null;
}
const STORAGE_KEY = "ws.bulkAction";
let tracked: Tracked | null = readStored();
const listeners = new Set<() => void>();

function readStored(): Tracked | null {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: unknown; label?: unknown };
    return typeof v.id === "string"
      ? { id: v.id, label: typeof v.label === "string" ? v.label : undefined, report: null }
      : null;
  } catch {
    return null;
  }
}

export function setTracked(next: Tracked | null): void {
  const kept =
    tracked && next && tracked.id === next.id && next.label === undefined ? tracked.label : undefined;
  tracked = next && kept !== undefined ? { ...next, label: kept } : next;
  try {
    if (tracked)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: tracked.id, label: tracked.label }));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the action is followed while the page lives.
  }
  for (const l of listeners) l();
}

/** For tests: forget the followed action. */
export function resetTracked(): void {
  tracked = readStored();
}

export function useTracked(): Tracked | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tracked,
  );
}

/** «Оброблено X з N» refreshes every second while the action runs (DAT-03 FR 6; lead decision 2026-11-15 item 10). */
export const POLL_MS = 1000;

/**
 * Follows the tracked action: reads its report when the screen opens and every second while it runs. `failed` — the
 * last read failed (the banner offers «Спробувати ще раз»).
 */
export function useBulkProgress(onFinished: () => void): {
  tracked: Tracked | null;
  failed: { code?: string | undefined } | null;
  reload: () => void;
} {
  const api = useAuthApi();
  const current = useTracked();
  const [failed, setFailed] = useState<{ code?: string | undefined } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = current?.id ?? null;
  const status = current?.report?.status ?? null;
  useEffect(() => {
    if (id === null || (status !== null && status !== "running")) return;
    let live = true;
    const read = () =>
      void outcome(api.GET("/v1/bulk-actions/{actionId}", { params: { path: { actionId: id } } })).then(
        (o) => {
          if (!live) return;
          if (o.ok) {
            setFailed(null);
            const was = tracked?.report?.status;
            setTracked({ id, report: o.data });
            if (o.data.status !== "running" && was === "running") onFinished();
          } else if (o.kind === "problem" && o.problem.code === "NOT_FOUND") setTracked(null);
          else setFailed({ code: o.kind === "problem" ? o.supportId : undefined });
        },
      );
    const timer = status === "running" ? window.setInterval(read, POLL_MS) : undefined;
    if (status === null) read();
    return () => {
      live = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [api, id, status, attempt, onFinished]);
  const reload = useCallback(() => {
    setFailed(null);
    setAttempt((n) => n + 1);
    if (tracked) setTracked({ id: tracked.id, report: null });
  }, []);
  return { tracked: current, failed, reload };
}

/**
 * «Вибрано N · Сума ±X €» (CMP-73, BUD-13 FR 9): ticked rows — `POST /v1/transactions/selection-summary`; «усі за
 * фільтром» — the list's «Різниця» less the unticked rows (lead decision 2026-11-16, BUD-13). While a new sum is on its
 * way the previous one stays, muted («Оновлюється…»).
 */
export function useSelectionSum(
  selection: Selection | null,
  summary: ListSummary | null,
  t: Translate,
  locale: Locale,
): SelectionSum | undefined {
  const api = useAuthApi();
  const ids =
    selection === null ? [] : selection.kind === "ids" ? [...selection.ids.keys()] : [...selection.excluded];
  const key = selection === null ? "" : `${selection.kind}:${ids.join(",")}`;
  const [answer, setAnswer] = useState<{ key: string; sum: SelectionSummary | null; failed: boolean }>({
    key: "",
    sum: null,
    failed: false,
  });
  useEffect(() => {
    if (key === "" || ids.length === 0) return;
    let live = true;
    void outcome(api.POST("/v1/transactions/selection-summary", { body: { ids } })).then((o) => {
      if (live) setAnswer({ key, sum: o.ok ? o.data : null, failed: !o.ok });
    });
    return () => {
      live = false;
    };
    // `key` carries the ids.
  }, [api, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (selection === null) return undefined;
  const updating = ids.length > 0 && answer.key !== key;
  const part = answer.sum;
  if (selection.kind === "ids") {
    if (part === null || answer.failed) return updating ? { amount: null, updating } : undefined;
    return {
      amount: part.sum ? { value: part.sum.amount, currency: part.sum.currency } : null,
      approximate: part.approximate,
      hint: hintOf(t, locale, part.nearestRateCount, part.convertedCount),
      updating,
    };
  }
  const all = summary?.difference;
  if (!all?.total) return undefined;
  let value = new Decimal(all.total.amount);
  let nearest = all.nearestRateCount;
  let approximate = all.approximate;
  if (selection.excluded.size > 0) {
    if (part === null || answer.failed || part.sum === null) return { amount: null, updating };
    value = value.minus(new Decimal(part.sum.amount));
    nearest = Math.max(0, nearest - part.nearestRateCount);
    approximate = approximate || part.approximate;
  }
  return {
    amount: { value: value.toFixed(), currency: all.total.currency },
    approximate,
    hint: hintOf(t, locale, nearest, 0),
    updating,
  };
}

function hintOf(t: Translate, locale: Locale, nearest: number, converted: number): string | undefined {
  const parts = [
    ...(nearest > 0 ? [plural(t, locale, "tx.summary.nearest", nearest)] : []),
    ...(converted > 0 ? [plural(t, locale, "bulk.converted", converted)] : []),
  ];
  return parts.length ? parts.join(" · ") : undefined;
}

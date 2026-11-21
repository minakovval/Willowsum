import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, operations } from "@willowsum/api-contract";
import { maskNumber } from "@willowsum/i18n";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";

/**
 * BUD-07@PoC c) (wave 2, row 130): what the «Регулярні платежі» screen (S-141) reads. The payments and the
 * proposals come from the recurring API (#309, #324); the account and category names from their own lists. Those
 * two are only labels: when either fails, the screen still shows the payments, without the names.
 */
type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

export type Payment = Json<operations["listRecurringPayments"]>["items"][number];
export type Proposal = Json<operations["listRecurringProposals"]>["items"][number];
export type Status = Json<operations["listRecurringStatuses"]>["items"][number];
export type Charge = Json<operations["listRecurringCharges"]>["items"][number];
export type Frequency = Payment["frequency"];
type AccountItem = Json<operations["listAccounts"]>["items"][number];
type CategoryGroups = Json<operations["listCategories"]>["groups"];

export const FREQUENCIES: readonly Frequency[] = ["week", "two-weeks", "month", "quarter", "year"];

/** An account as a payment shows it: «Кредитна ··9021» (DS-04 FR 13). */
export interface AccountLabel {
  readonly id: string;
  readonly label: string;
  /** «··5562» (BUD-05 goal card: «додайте переказ на рахунок ··5562»), or `null` without a number. */
  readonly mask: string | null;
  /** Loans and closed accounts are not offered for a new payment (the API refuses them: `loan`, `closed`). */
  readonly selectable: boolean;
  readonly currency: string | undefined;
}

export interface CategoryLabel {
  readonly id: string;
  readonly name: string;
  readonly kind: "expense" | "income" | "service";
  readonly hidden: boolean;
}

export interface RecurringData {
  readonly payments: readonly Payment[];
  readonly proposals: readonly Proposal[];
  /** The analysis window held more transactions than were read (the oldest were not). */
  readonly more: boolean;
  readonly accounts: ReadonlyMap<string, AccountLabel>;
  readonly categories: ReadonlyMap<string, CategoryLabel>;
  /** FR 8–12: the status of each payment by its id; empty when the statuses failed (the list still shows). */
  readonly statuses: ReadonlyMap<string, Status>;
  /** The charges of each payment through the next one (FR 7, the calendar); a payment whose read failed is absent. */
  readonly charges: ReadonlyMap<string, readonly Charge[]>;
}

export type Load<T> =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly failure: Exclude<Outcome<unknown>, { ok: true }> }
  | { readonly state: "ready"; readonly data: T };

/**
 * DS-04 FR 13 masks the last 4 characters («··4417», «··AB12»); a number that is not alphanumeric is named
 * without a mask, and a label never throws (a throw here would leave the screen in «loading»).
 */
function maskedOrNothing(last4: string): string | null {
  try {
    return maskNumber(last4);
  } catch {
    return null;
  }
}

function accountLabel(a: AccountItem): AccountLabel {
  const mask = a.number ? maskedOrNothing(a.number.last4) : null;
  return {
    id: a.id,
    label: mask ? `${a.name} ${mask}` : a.name,
    mask,
    selectable: a.kind !== "loan" && a.status === "active",
    currency: a.currencies[0]?.currency,
  };
}

function categoryLabels(groups: CategoryGroups): Map<string, CategoryLabel> {
  const out = new Map<string, CategoryLabel>();
  for (const g of groups)
    for (const c of g.categories) out.set(c.id, { id: c.id, name: c.name, kind: c.kind, hidden: c.hidden });
  return out;
}

/** Accounts of every page (the list is paged by cursor); a failure leaves the labels out. */
export async function loadAccounts(api: ApiClient): Promise<Map<string, AccountLabel>> {
  const out = new Map<string, AccountLabel>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const o = await outcome(
      api.GET("/v1/accounts", {
        params: { query: { includeClosed: "true", ...(cursor ? { cursor } : {}) } },
      }),
    );
    if (!o.ok) return out;
    for (const a of o.data.items) out.set(a.id, accountLabel(a));
    if (!o.data.nextCursor) return out;
    cursor = o.data.nextCursor;
  }
  return out;
}

async function loadCategories(api: ApiClient): Promise<Map<string, CategoryLabel>> {
  const o = await outcome(api.GET("/v1/categories"));
  return o.ok ? categoryLabels(o.data.groups) : new Map();
}

async function loadStatuses(api: ApiClient): Promise<Map<string, Status>> {
  const o = await outcome(api.GET("/v1/recurring/statuses"));
  return new Map(o.ok ? o.data.items.map((s): [string, Status] => [s.paymentId, s]) : []);
}

async function loadCharges(api: ApiClient, ids: readonly string[]): Promise<Map<string, readonly Charge[]>> {
  const out = new Map<string, readonly Charge[]>();
  await Promise.all(
    ids.map(async (paymentId) => {
      const o = await outcome(
        api.GET("/v1/recurring/payments/{paymentId}/charges", { params: { path: { paymentId } } }),
      );
      if (o.ok) out.set(paymentId, o.data.items);
    }),
  );
  return out;
}

export async function loadRecurring(api: ApiClient): Promise<Load<RecurringData>> {
  const [payments, proposals, accounts, categories, statuses] = await Promise.all([
    outcome(api.GET("/v1/recurring/payments")),
    outcome(api.GET("/v1/recurring/proposals")),
    loadAccounts(api),
    loadCategories(api),
    loadStatuses(api),
  ]);
  if (!payments.ok) return { state: "error", failure: payments };
  if (!proposals.ok) return { state: "error", failure: proposals };
  const charges = await loadCharges(
    api,
    payments.data.items.map((p) => p.id),
  );
  return {
    state: "ready",
    data: {
      payments: payments.data.items,
      proposals: proposals.data.items,
      more: proposals.data.more,
      accounts,
      categories,
      statuses,
      charges,
    },
  };
}

/**
 * Reads on mount and on `reload()`; the last answer wins, an older one is dropped.
 *
 * A `load` that is a stable function (module level, or `useCallback`) reads again when its identity changes. An inline
 * arrow is a new function on every render, so it would read again after every answer, endlessly (FLW-38 «Підсумок
 * періоду»): such a caller passes `key` — the values `load` depends on, as a string — and the read repeats only when the
 * key changes, with the latest `load` kept in a ref.
 */
export function useLoad<T>(
  load: (api: ApiClient) => Promise<Load<T>>,
  key?: string,
): {
  readonly result: Load<T>;
  readonly reload: () => void;
} {
  const api = useAuthApi();
  const [result, setResult] = useState<Load<T>>({ state: "loading" });
  const [round, setRound] = useState(0);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const dependsOn = key === undefined ? load : key;
  useEffect(() => {
    let live = true;
    // Any rejection or throw is the error state (DS-04 FR 13, «Стани інтерфейсу»), never an endless «loading».
    const failed: Load<T> = { state: "error", failure: { ok: false, kind: "network" } };
    void (async () => (key === undefined ? load : latest.current)(api))().then(
      (r) => {
        if (live) setResult(r);
      },
      () => {
        if (live) setResult(failed);
      },
    );
    return () => {
      live = false;
    };
    // `load` and `key` are read through `dependsOn`: with a key only the key re-runs the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, dependsOn, round]);
  const reload = useCallback(() => {
    setResult({ state: "loading" });
    setRound((n) => n + 1);
  }, []);
  return { result, reload };
}

/** «Сьогодні» of the space: the date in Kyiv (the API counts the schedule by it too). */
export function kyivToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export interface FormChoices {
  readonly accounts: ReadonlyMap<string, AccountLabel>;
  readonly categories: ReadonlyMap<string, CategoryLabel>;
}

/** The choices of «Додати вручну»; without them the form still works (no category, no account). */
export async function loadFormChoices(api: ApiClient): Promise<Load<FormChoices>> {
  const [accounts, categories] = await Promise.all([loadAccounts(api), loadCategories(api)]);
  return { state: "ready", data: { accounts, categories } };
}

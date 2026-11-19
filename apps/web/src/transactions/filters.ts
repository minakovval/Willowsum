import { formatDate, formatNumber, type Locale, type MessageKey, type Translate } from "@willowsum/i18n";
import type { FilterChipItem } from "@willowsum/ui";
import { TRANSACTIONS } from "../routing/routes.ts";

/**
 * FIN-03@PoC FR 22, FR 33, DAT-01@PoC FR 4 — the filters of S-046 «Транзакції» as the list keeps them and as the
 * server's whitelist takes them (`GET /v1/transactions?filter=<field>.<operator>:<value>`, repeatable, joined by AND).
 * «Категорії» and «Стан: можливий дубль» have no server filter yet: they are not shown (PR body, «Follow-ups»).
 */
export type TxType = "in" | "out";
export const TX_STATES = ["pending", "split", "transfer", "hidden"] as const;
export type TxState = (typeof TX_STATES)[number];

export interface TxFilters {
  /** «Період»: `YYYY-MM-DD`, either end may be open. */
  readonly dateFrom: string;
  readonly dateTo: string;
  /** «Рахунки»: account ids. */
  readonly accounts: readonly string[];
  /** «Тип»: списання (`out`) або надходження (`in`); `null` — both. */
  readonly type: TxType | null;
  /** «Сума» від / до: the amount without its sign, a decimal string with a dot. */
  readonly amountFrom: string;
  readonly amountTo: string;
  /** «Стан»: one state (the server joins filters by AND, so several states cannot be «any of»). */
  readonly state: TxState | null;
  /** «Теги»: any of these tags. */
  readonly tags: readonly string[];
  /** «Мерчант»: the counterparty contains this text. */
  readonly merchant: string;
}

export const NO_FILTERS: TxFilters = {
  dateFrom: "",
  dateTo: "",
  accounts: [],
  type: null,
  amountFrom: "",
  amountTo: "",
  state: null,
  tags: [],
  merchant: "",
};

/** The filter fields, in the order of the panel rows and of the chips. */
export const FILTER_FIELDS = ["period", "accounts", "type", "amount", "state", "tags", "merchant"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The amount the server accepts (`numeric`): no sign, no leading zeros, a dot, at most 2 decimals here. */
const AMOUNT = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;
/** The longest merchant text the server accepts (`counterparty.has`, 200 characters). */
export const MERCHANT_MAX_LENGTH = 200;
/** Server limit of filters per request (`filtersPerRequest`, 50); with the search at most 49 ids per `in`. */
export const MAX_CHOSEN = 40;

/** «25,50» or «25.50» → «25.50»; `null` when it is not an amount the filter takes. Empty stays empty. */
export function normalizeAmount(text: string): string | null {
  const v = text.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (v === "") return "";
  return AMOUNT.test(v) ? v : null;
}

function isDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  return y >= 1 && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** A stored filter set as the list can send it (DAT-01@PoC FR 7); anything else is not used. */
export function isTxFilters(value: unknown): value is TxFilters {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const ids = (x: unknown) =>
    Array.isArray(x) && x.length <= MAX_CHOSEN && x.every((id) => typeof id === "string" && UUID.test(id));
  const dateOrEmpty = (x: unknown) => typeof x === "string" && (x === "" || isDate(x));
  const amountOrEmpty = (x: unknown) => typeof x === "string" && normalizeAmount(x) === x;
  return (
    dateOrEmpty(v.dateFrom) &&
    dateOrEmpty(v.dateTo) &&
    ids(v.accounts) &&
    (v.type === null || v.type === "in" || v.type === "out") &&
    amountOrEmpty(v.amountFrom) &&
    amountOrEmpty(v.amountTo) &&
    (v.state === null || (TX_STATES as readonly unknown[]).includes(v.state)) &&
    ids(v.tags) &&
    typeof v.merchant === "string" &&
    v.merchant.length <= MERCHANT_MAX_LENGTH
  );
}

/** Whether a field is set. */
export function isSet(f: TxFilters, field: FilterField): boolean {
  switch (field) {
    case "period":
      return f.dateFrom !== "" || f.dateTo !== "";
    case "accounts":
      return f.accounts.length > 0;
    case "type":
      return f.type !== null;
    case "amount":
      return f.amountFrom !== "" || f.amountTo !== "";
    case "state":
      return f.state !== null;
    case "tags":
      return f.tags.length > 0;
    case "merchant":
      return f.merchant.trim() !== "";
  }
}

/** N of «Фільтри · N»: the number of set fields (a range counts once). */
export function activeCount(f: TxFilters): number {
  return FILTER_FIELDS.filter((field) => isSet(f, field)).length;
}

/** The same filters without `field`. */
export function without(f: TxFilters, field: FilterField): TxFilters {
  switch (field) {
    case "period":
      return { ...f, dateFrom: "", dateTo: "" };
    case "accounts":
      return { ...f, accounts: [] };
    case "type":
      return { ...f, type: null };
    case "amount":
      return { ...f, amountFrom: "", amountTo: "" };
    case "state":
      return { ...f, state: null };
    case "tags":
      return { ...f, tags: [] };
    case "merchant":
      return { ...f, merchant: "" };
  }
}

const STATE_FILTER: Record<TxState, string> = {
  pending: "status.eq:pending",
  split: "split.eq:true",
  transfer: "transfer.eq:true",
  hidden: "hidden.eq:true",
};

/** The `filter` values of the list request for these filters (without the search). */
export function filterParams(f: TxFilters): string[] {
  const out: string[] = [];
  if (isDate(f.dateFrom)) out.push(`date.gte:${f.dateFrom}`);
  if (isDate(f.dateTo)) out.push(`date.lte:${f.dateTo}`);
  if (f.accounts.length === 1) out.push(`accountId.eq:${f.accounts[0]}`);
  else if (f.accounts.length > 1) out.push(`accountId.in:${f.accounts.join(",")}`);
  if (f.type) out.push(`type.eq:${f.type}`);
  if (f.amountFrom) out.push(`amount.gte:${f.amountFrom}`);
  if (f.amountTo) out.push(`amount.lte:${f.amountTo}`);
  if (f.state) out.push(STATE_FILTER[f.state]);
  if (f.tags.length === 1) out.push(`tag.eq:${f.tags[0]}`);
  else if (f.tags.length > 1) out.push(`tag.in:${f.tags.join(",")}`);
  const merchant = f.merchant.trim();
  if (merchant) out.push(`counterparty.has:${merchant}`);
  return out;
}

export const ROW_LABEL: Record<FilterField, MessageKey> = {
  period: "tx.filter.period",
  accounts: "tx.filter.accounts",
  type: "tx.filter.type",
  amount: "tx.filter.amount",
  state: "tx.filter.state",
  tags: "tx.filter.tags",
  merchant: "tx.filter.merchant",
};

export const ANY_LABEL: Record<FilterField, MessageKey> = {
  period: "tx.filter.any.period",
  accounts: "tx.filter.any.accounts",
  type: "tx.filter.any.type",
  amount: "tx.filter.any.amount",
  state: "tx.filter.any.state",
  tags: "tx.filter.any.tags",
  merchant: "tx.filter.any.merchant",
};

export const STATE_LABEL: Record<TxState, MessageKey> = {
  pending: "tx.filter.state.pending",
  split: "tx.filter.state.split",
  transfer: "tx.filter.state.transfer",
  hidden: "tx.filter.state.hidden",
};
const STATE_CHIP: Record<TxState, MessageKey> = {
  pending: "tx.filter.state.pendingChip",
  split: "tx.filter.state.splitChip",
  transfer: "tx.filter.state.transferChip",
  hidden: "tx.filter.state.hiddenChip",
};

/** «1 лист. 2026 р. – 30 лист. 2026 р.», «від 25», «до 100» — a range with either end open. */
export function rangeText(t: Translate, from: string, to: string, show: (v: string) => string): string {
  if (from && to) return t("tx.filter.range.both", { from: show(from), to: show(to) });
  if (from) return t("tx.filter.range.from", { from: show(from) });
  return t("tx.filter.range.to", { to: show(to) });
}

/** The names the chips and the rows show for the chosen ids. */
export interface FilterNames {
  readonly accounts: ReadonlyMap<string, string>;
  readonly tags: ReadonlyMap<string, string>;
}

/** What a set field shows in its panel row: the chosen names through a comma, or the range. */
export function rowSummary(
  t: Translate,
  locale: Locale,
  f: TxFilters,
  field: FilterField,
  names: FilterNames,
): string {
  if (!isSet(f, field)) return t(ANY_LABEL[field]);
  const date = (v: string) => (isDate(v) ? formatDate(locale, v) : v);
  const amount = (v: string) => formatNumber(locale, v);
  switch (field) {
    case "period":
      return rangeText(t, f.dateFrom, f.dateTo, date);
    case "accounts":
      return f.accounts.map((id) => names.accounts.get(id) ?? "—").join(", ");
    case "type":
      return t(f.type === "in" ? "tx.filter.type.in" : "tx.filter.type.out");
    case "amount":
      return rangeText(t, f.amountFrom, f.amountTo, amount);
    case "state":
      return t(STATE_LABEL[f.state!]);
    case "tags":
      return f.tags.map((id) => names.tags.get(id) ?? "—").join(", ");
    case "merchant":
      return f.merchant.trim();
  }
}

/** The chips of the set fields (FIN-03@PoC FR 22, FR 33; CMP-32 «Клавіатура і екранний читач»). */
export function chipsOf(t: Translate, locale: Locale, f: TxFilters, names: FilterNames): FilterChipItem[] {
  const chips: FilterChipItem[] = [];
  for (const field of FILTER_FIELDS) {
    if (!isSet(f, field)) continue;
    const label = t(ROW_LABEL[field]);
    const summary = rowSummary(t, locale, f, field, names);
    let value = summary;
    let text = summary;
    if (field === "accounts") {
      // The «×» names the chosen accounts even when the chip shows their number (CMP-32 AC2).
      text =
        f.accounts.length === 1
          ? t("tx.filter.chip.account", { name: summary })
          : t("tx.filter.chip.accounts", { count: f.accounts.length });
    } else if (field === "tags") {
      // As for «Рахунки»: the «×» names the chosen tags.
      text =
        f.tags.length === 1
          ? t("tx.filter.chip.tag", { name: summary })
          : t("tx.filter.chip.tags", { count: f.tags.length });
    } else if (field === "type") {
      value = t(f.type === "in" ? "tx.filter.type.inChip" : "tx.filter.type.outChip");
      text = t("tx.filter.chip.type", { value });
    } else if (field === "state") {
      value = t(STATE_CHIP[f.state!]);
      text = t("tx.filter.chip.state", { value });
    } else if (field === "amount") {
      text = t("tx.filter.chip.amount", { range: summary });
    } else if (field === "merchant") {
      text = t("tx.filter.chip.merchant", { name: summary });
    }
    chips.push({ id: field, field: label, value, text });
  }
  return chips;
}

/**
 * FIN-03@PoC FR 33: «Усі N транзакцій рахунку» (account card) and «Схожі транзакції» (S-047) open S-046 with one
 * active filter — `#/money/transactions?account=<id>` or `?merchant=<name>`; the list reads it once and drops it.
 */
export function filteredTransactionsPath(filter: { account: string } | { merchant: string }): string {
  const q = new URLSearchParams(
    "account" in filter ? { account: filter.account } : { merchant: filter.merchant },
  );
  return `${TRANSACTIONS.path}?${q.toString()}`;
}

/** The filters a link of FR 33 carries in the hash (`?account=`, `?merchant=` or `?from=&to=`), or `null`. */
export function filtersFromHash(hash: string): TxFilters | null {
  const at = hash.indexOf("?");
  if (at < 0) return null;
  const q = new URLSearchParams(hash.slice(at + 1));
  const account = q.get("account");
  if (account !== null && UUID.test(account)) return { ...NO_FILTERS, accounts: [account] };
  const merchant = q.get("merchant")?.trim();
  if (merchant) return { ...NO_FILTERS, merchant: merchant.slice(0, MERCHANT_MAX_LENGTH) };
  // BUD-16@PoC b): a column of «Тренд» opens the list of its month (`?from=` and `?to=`, both days of one period).
  const from = q.get("from");
  const to = q.get("to");
  if (from !== null && to !== null && isDate(from) && isDate(to) && from <= to)
    return { ...NO_FILTERS, dateFrom: from, dateTo: to };
  return null;
}

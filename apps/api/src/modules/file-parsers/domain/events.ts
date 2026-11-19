import { currencyInfo, Decimal, isCurrencyCode } from "@willowsum/domain-kernel";
import { IN_VALUES, OUT_VALUES, type Role, type StatementAnalysis } from "./analysis.ts";
import {
  amountMark,
  headerUnknownCurrency,
  ibanCountry,
  recognizeCurrency,
  type CurrencyHints,
} from "./currency.ts";
import { dateCell, numberCell, readDate, readNumber, type DecimalSeparator } from "./values.ts";

/**
 * A statement's rows read into events with legs (IMP-02@PoC FR 3–5, FR 8–12; wave 2 row 41 part 2), under the
 * engine's decisions on the table (`analyzeTable`). Each row is one event: its main leg (the signed amount in the
 * row's currency — the account's wallet, FR 2) and a separate fee leg (the fee charged, positive; ledger's `legs`
 * event), the original amount and currency, the bank's rate, the value date and the bank's description as printed
 * (FR 4). What the engine is unsure of is flagged for the user, never guessed: an ambiguous or unknown currency, a
 * currency the account does not hold, a precision the currency does not have, a rate that does not match. Amounts
 * are decimal text, never a float (FR 6); the engine never converts an amount (FR 10). Pure and deterministic.
 */
export const EVENT_LIMITS = {
  /** Characters of the description, the counterparty and the reference carried out of the worker. */
  textChars: 2000,
  /** The rate check's relative tolerance (FR 12): 0.5 %. */
  rateTolerance: "0.005",
} as const;

export type EventFlag =
  /** FR 3, AC4: a single-currency account and a row in another currency. */
  | "currency-not-in-account"
  /** FR 9, AC12, EC1: a symbol several currencies print, with no recipe symbol and no IBAN country. */
  | "currency-ambiguous"
  /** FR 9, FR 10, AC8: a local name or a code that is not a current ISO code. */
  | "currency-unknown"
  /** No currency in the row, the column, the header or the account. */
  | "currency-missing"
  /** FR 11, AC9: more decimals than the fiat currency has. */
  | "precision-exceeds-currency"
  /** FR 12, AC6: original amount × rate is not the settled amount. */
  | "rate-mismatch"
  /** FR 12: the rate is the other way round (settled × rate = original). */
  | "rate-inverted"
  /** IMP-06 FR 8: the row's sign is not told — an indicator the engine does not know, a minus where the sign comes from elsewhere. */
  | "sign-unclear"
  | "amount-unreadable"
  | "date-unreadable"
  /** A text over `EVENT_LIMITS.textChars` came out cut. */
  | "text-cut";

/** A leg (FR 5): a signed quantity of a currency or an asset. The fee leg's amount is the fee charged (positive). */
export interface EventLeg {
  readonly amount: string;
  /** Null — the currency is not settled (a flag says why). */
  readonly currency: string | null;
}

export interface StatementEvent {
  /** The row of the file, from 1. */
  readonly row: number;
  readonly date: string | null;
  readonly valueDate: string | null;
  /** The account's wallet: the currency the row is settled in (FR 2). */
  readonly currency: string | null;
  /** The main legs: one per row in a statement (FR 5). */
  readonly legs: readonly EventLeg[];
  readonly fee: EventLeg | null;
  /** The balance after the row as printed (IMP-05@PoC FR 1 «ланцюжок залишків»), decimal text; null — no balance. */
  readonly balance: string | null;
  /** The original amount and currency (FR 4), before the bank's rate; null — the row has none. */
  readonly original: EventLeg | null;
  /** The bank's rate (FR 4, FR 12). */
  readonly rate: string | null;
  /** The bank's description as printed (FR 4); the merchant comes from it. */
  readonly description: string | null;
  readonly counterparty: string | null;
  readonly reference: string | null;
  /** What the user decides on an ambiguous or unknown currency: the mark as printed and the candidates. */
  readonly currencyMark: { readonly text: string; readonly candidates: readonly string[] } | null;
  readonly flags: readonly EventFlag[];
}

export interface StatementOptions {
  /** The account the statement is for (FR 2, FR 3): its currencies; a single-currency account takes only its own. */
  readonly account?: {
    readonly currencies: readonly string[];
    readonly multiCurrency: boolean;
    /** The account's kind (accounts' `ACCOUNT_KINDS`): a «credit-card» is a card feature of IMP-05@PoC FR 5, FR 6. */
    readonly kind?: string;
  };
  /** The recipe's symbol dictionary (IMP-06 FR 1 `numbers.currencySymbols`). */
  readonly currencySymbols?: Readonly<Record<string, string>>;
  /** The country of the account's IBAN, when the caller knows it; else the IBAN in the file's preamble. */
  readonly country?: string;
}

export interface StatementEvents {
  readonly events: readonly StatementEvent[];
  /** The currencies of the settled rows, sorted: the wallets the batch fills (FR 1, FR 2). */
  readonly currencies: readonly string[];
  /** The country an ambiguous symbol was read by, and where it came from. Never the IBAN itself. */
  readonly country: { readonly code: string; readonly from: "options" | "file" } | null;
}

const filled = (row: readonly string[]): number => row.filter((c) => c.trim() !== "").length;

interface Amount {
  readonly value: Decimal;
  /** Decimals as printed. */
  readonly scale: number;
}

const scaleOf = (text: string): number => (text.includes(".") ? text.length - text.indexOf(".") - 1 : 0);

/** A plain decimal text with the printed scale; a zero carries no sign. */
const text = (a: Amount): string => (a.value.isZero() ? new Decimal("0") : a.value).toFixed(a.scale);

export function readEvents(
  rows: readonly (readonly string[])[],
  headerRow: number | null,
  firstRow: number,
  analysis: StatementAnalysis,
  options: StatementOptions = {},
  /** 0-based rows that are not operations: the statement's own figures («Разом», «Кінцевий залишок»; IMP-05 FR 1). */
  exclude: ReadonlySet<number> = new Set(),
): StatementEvents {
  const column = (role: Role): number =>
    analysis.columns.find((c) => c.role.chosen.value === role)?.column ?? 0;
  const at = (row: readonly string[], role: Role): string => {
    const c = column(role);
    return c > 0 ? (row[c - 1] ?? "") : "";
  };
  const decimal: DecimalSeparator = analysis.numbers?.chosen.value.decimalSeparator ?? ",";
  const order = analysis.dates?.chosen.value.order ?? null;
  const sign = analysis.sign?.chosen.value ?? "as-printed";
  const indicator = analysis.sign?.evidence.find((e) => e.code === "indicator-column")?.column ?? 0;
  const from = headerRow === null ? firstRow : headerRow + 1;
  const preamble = rows.slice(firstRow, headerRow ?? firstRow);
  const fileCountry = ibanCountry(preamble);
  const country = options.country
    ? { code: options.country.toUpperCase(), from: "options" as const }
    : fileCountry
      ? { code: fileCountry, from: "file" as const }
      : null;
  const hints: CurrencyHints = {
    ...(options.currencySymbols ? { symbols: options.currencySymbols } : {}),
    country: country?.code ?? null,
  };
  const data = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i >= from && filled(r) >= 2 && !exclude.has(i));

  const amountOf = (cell: string): Amount | null => {
    if (cell.trim() === "") return null;
    const n = numberCell(cell);
    const read = n ? readNumber(n, decimal) : null;
    return read ? { value: new Decimal(read.value), scale: scaleOf(read.value) } : null;
  };
  const dateOf = (cell: string): string | null => {
    const d = cell.trim() === "" || order === null ? null : dateCell(cell);
    return d && order ? readDate(d, order) : null;
  };
  // EC3: a currency column with one currency fills its empty cells with it, the confidence unchanged.
  const currencyColumn = column("currency");
  // Only a column that holds nothing else: beside an unknown or ambiguous mark, or a second code, an empty cell is
  // not settled (FR 10: never guessed).
  const columnCodes = new Set<string>();
  let columnOther = false;
  if (currencyColumn > 0)
    for (const { r } of data) {
      const rec = recognizeCurrency(r[currencyColumn - 1] ?? "", hints);
      if (rec?.status === "code") columnCodes.add(rec.code);
      else if (rec) columnOther = true;
    }
  const columnCode = columnCodes.size === 1 && !columnOther ? [...columnCodes][0]! : null;
  const columnMixed = columnCodes.size > 1 || columnOther;
  const fileCode = analysis.currency.mode === "file" ? analysis.currency.code : null;
  // FR 10: an amount header that names a code the engine does not hold («Сума (BGN)») is «невідома валюта» for its
  // rows — the account's currency is never lent to them.
  const headerCells = headerRow === null ? [] : (rows[headerRow] ?? []);
  const headerMark =
    fileCode !== null
      ? null
      : ((["amount", "debit", "credit", "balance"] as const)
          .map((role) => headerUnknownCurrency((headerCells[column(role) - 1] ?? "").trim()))
          .find((m) => m !== null) ?? null);
  const account = options.account;
  // The caller's account currency is checked like a file's: a code the kernel does not hold is no currency.
  const accountCode =
    account &&
    !account.multiCurrency &&
    account.currencies.length === 1 &&
    isCurrencyCode(account.currencies[0]!)
      ? account.currencies[0]!
      : null;

  const events = data.map(({ r, i }): StatementEvent => {
    const flags = new Set<EventFlag>();
    const cut = (cell: string, trim = true): string | null => {
      const t = trim ? cell.trim() : cell;
      if (t.trim() === "") return null;
      if (t.length <= EVENT_LIMITS.textChars) return t;
      flags.add("text-cut");
      // Never half a surrogate pair: a cut that would end on a high surrogate drops it.
      const end = /[\uD800-\uDBFF]/.test(t.charAt(EVENT_LIMITS.textChars - 1))
        ? EVENT_LIMITS.textChars - 1
        : EVENT_LIMITS.textChars;
      return t.slice(0, end);
    };

    // The amount and its sign (IMP-06 FR 1 «знак»).
    let main: Amount | null;
    if (sign === "debit-credit") {
      const debit = amountOf(at(r, "debit"));
      const credit = amountOf(at(r, "credit"));
      if (debit?.value.isNegative() || credit?.value.isNegative()) flags.add("sign-unclear");
      main =
        debit || credit
          ? {
              value: (credit?.value ?? new Decimal("0"))
                .abs()
                .minus((debit?.value ?? new Decimal("0")).abs()),
              scale: Math.max(debit?.scale ?? 0, credit?.scale ?? 0),
            }
          : null;
    } else {
      const amount = amountOf(at(r, "amount"));
      const word = indicator > 0 ? (r[indicator - 1] ?? "").trim().toLowerCase() : "";
      const out = OUT_VALUES.has(word);
      if (sign === "indicator" && amount && ((!out && !IN_VALUES.has(word)) || amount.value.isNegative()))
        flags.add("sign-unclear");
      main = amount && {
        value:
          sign === "invert"
            ? amount.value.negated()
            : sign === "indicator"
              ? out
                ? amount.value.abs().negated()
                : amount.value.abs()
              : amount.value,
        scale: amount.scale,
      };
    }
    if (!main) flags.add("amount-unreadable");

    // The row's currency (FR 9): the column, the amount's own mark, the header, the account.
    let currency: string | null = null;
    let currencyMark: StatementEvent["currencyMark"] = null;
    const cell = currencyColumn > 0 ? (r[currencyColumn - 1] ?? "") : "";
    const mark = amountMark(
      at(r, sign === "debit-credit" ? (amountOf(at(r, "debit")) ? "debit" : "credit") : "amount"),
    );
    const recognized =
      recognizeCurrency(cell, hints) ??
      (columnCode !== null ? { status: "code" as const, code: columnCode, via: "iso" as const } : null) ??
      (mark ? recognizeCurrency(mark, hints) : null) ??
      (headerMark !== null ? { status: "unknown" as const, mark: headerMark } : null);
    if (recognized?.status === "code") currency = recognized.code;
    else if (recognized?.status === "ambiguous") {
      flags.add("currency-ambiguous");
      currencyMark = { text: recognized.mark, candidates: recognized.candidates };
    } else if (recognized?.status === "unknown") {
      flags.add("currency-unknown");
      currencyMark = { text: recognized.mark, candidates: [] };
    } else currency = columnMixed ? null : (fileCode ?? accountCode);
    if (!recognized && currency === null) flags.add("currency-missing");
    if (currency !== null && account && !account.multiCurrency && !account.currencies.includes(currency))
      flags.add("currency-not-in-account");

    // FR 11: a fiat amount with more decimals than its currency has.
    const precise = (a: Amount | null, code: string | null) => {
      if (!a || code === null) return;
      const info = currencyInfo(code);
      if (info.kind !== "crypto" && a.scale > info.minorUnits) flags.add("precision-exceeds-currency");
    };
    precise(main, currency);

    const feeAmount = amountOf(at(r, "fee"));
    precise(feeAmount, currency);
    const fee =
      feeAmount && !feeAmount.value.isZero()
        ? { amount: text({ value: feeAmount.value.abs(), scale: feeAmount.scale }), currency }
        : null;

    const originalAmount = amountOf(at(r, "original-amount"));
    // The original currency: its column, else the mark printed with the original amount («1 000,00 UAH»).
    const originalMark = amountMark(at(r, "original-amount"));
    const originalCurrency =
      recognizeCurrency(at(r, "original-currency"), hints) ??
      (originalMark ? recognizeCurrency(originalMark, hints) : null);
    const originalCode = originalCurrency?.status === "code" ? originalCurrency.code : null;
    if (originalCurrency && originalCurrency.status !== "code") {
      flags.add(originalCurrency.status === "ambiguous" ? "currency-ambiguous" : "currency-unknown");
      currencyMark ??= {
        text: originalCurrency.mark,
        candidates: originalCurrency.status === "ambiguous" ? originalCurrency.candidates : [],
      };
    }
    precise(originalAmount, originalCode);
    const rate = amountOf(at(r, "exchange-rate"));

    // FR 12: original × rate against the settled amount, 0.5 % or one minor unit of the settled currency.
    if (
      main &&
      originalAmount &&
      rate &&
      currency !== null &&
      originalCode !== null &&
      originalCode !== currency
    ) {
      const settled = main.value.abs();
      const unit = new Decimal("10").pow(-currencyInfo(currency).minorUnits);
      const tolerance = Decimal.max(settled.times(EVENT_LIMITS.rateTolerance), unit);
      const within = (expected: Decimal) => expected.minus(settled).abs().lte(tolerance);
      const r0 = rate.value.abs();
      if (!within(originalAmount.value.abs().times(r0)))
        flags.add(
          !r0.isZero() && within(originalAmount.value.abs().div(r0)) ? "rate-inverted" : "rate-mismatch",
        );
    }

    const date = dateOf(at(r, "date"));
    if (date === null) flags.add("date-unreadable");
    const balance = amountOf(at(r, "balance"));
    return {
      row: i + 1,
      date,
      valueDate: dateOf(at(r, "value-date")),
      currency,
      legs: main ? [{ amount: text(main), currency }] : [],
      fee,
      balance: balance ? text(balance) : null,
      original: originalAmount ? { amount: text(originalAmount), currency: originalCode } : null,
      rate: rate ? text({ value: rate.value.abs(), scale: rate.scale }) : null,
      // As printed (FR 4): the cell untouched, cut only past the bound.
      description: cut(at(r, "description"), false),
      counterparty: cut(at(r, "counterparty")),
      reference: cut(at(r, "reference")),
      currencyMark,
      flags: [...flags].sort(),
    };
  });
  return {
    events,
    currencies: [...new Set(events.flatMap((e) => (e.currency === null ? [] : [e.currency])))].sort(),
    country,
  };
}

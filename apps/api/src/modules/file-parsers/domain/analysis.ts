import { headerCurrency, isCodeLike, isCurrencyCell, recognizeCurrency } from "./currency.ts";
import { normalizeHeaderCell } from "./format.ts";
import {
  dateCell,
  dateFormatLabel,
  isAmbiguousInteger,
  numberCell,
  numberFormatLabel,
  readDate,
  readNumber,
  type DateCell,
  type DateOrder,
  type DecimalSeparator,
  type NumberCell,
  type ThousandsSeparator,
} from "./values.ts";

/**
 * The engine's decisions on a statement table, each with its alternatives and its evidence (IMP-06@PoC FR 8, AC8):
 * the role of every column, the date format, the number format and the sign — the top hypotheses with a score (0–1, two
 * decimals), a label in the recipe's terms and live examples read from the file — and «why so» for each decision,
 * the currency and the table too. Evidence is a code with its numbers, never a sentence: the client words it in uk or
 * en. Rows and columns are numbered from 1, as in the recipe. Pure and deterministic (FR 9): ties go to a fixed order.
 */
export const ANALYSIS_LIMITS = {
  /** Data rows the decisions look at (the first ones). */
  sampleRows: 1000,
  /** Alternatives kept besides the chosen hypothesis. */
  alternatives: 3,
  /** Live examples per hypothesis. */
  examples: 3,
  /** Characters of a cell in an example. */
  exampleChars: 40,
  /** Characters of a column's header in the result. */
  headerChars: 120,
} as const;

/** Column roles, as the recipe names them (import-recipes' `COLUMN_ROLES`). */
export const ROLES = [
  "date",
  "value-date",
  "amount",
  "debit",
  "credit",
  "balance",
  "currency",
  "description",
  "counterparty",
  "reference",
  "status",
  "fee",
  "original-amount",
  "original-currency",
  "exchange-rate",
  "ignore",
] as const;
export type Role = (typeof ROLES)[number];

export type SignMode = "as-printed" | "invert" | "indicator" | "debit-credit";

export interface DateFormat {
  readonly order: DateOrder;
  /** The recipe's `dates.format`, e.g. «DD.MM.YYYY». */
  readonly format: string;
}

export interface NumberFormat {
  readonly decimalSeparator: DecimalSeparator;
  readonly thousandsSeparator: ThousandsSeparator;
}

/** A live example: a cell of the file and what it reads as under the hypothesis (null — it cannot be read so). */
export interface Example {
  readonly cell: string;
  readonly reads: string | null;
}

export interface Hypothesis<V> {
  readonly value: V;
  readonly label: string;
  readonly score: number;
  readonly examples: readonly Example[];
}

export type EvidenceCode =
  | "header-row"
  | "no-header-row"
  | "rows-before-header"
  | "data-rows"
  | "header-word"
  | "content"
  | "role-taken"
  | "day-first"
  | "month-first"
  | "year-first"
  | "no-day-over-12"
  | "conflicting-days"
  | "decimal-separator"
  | "thousands-separator"
  | "ambiguous-integers"
  | "mixed-separators"
  | "no-decimal-evidence"
  | "debit-credit-columns"
  | "negative-amounts"
  | "no-negative-amounts"
  | "indicator-column"
  | "currency-column"
  | "currency-in-header"
  | "no-currency"
  /** BUD-21 FR 4: a history file's column of transfer marks (count of marked cells of the sample). */
  | "transfer-values"
  /** BUD-21 FR 6: the user chose this on the review step. */
  | "user-choice";

/** One piece of «why so»: a code and the numbers or words it speaks of (a column, a row, a count of cells, an example). */
export interface Evidence {
  readonly code: EvidenceCode;
  readonly column?: number;
  readonly row?: number;
  readonly count?: number;
  readonly of?: number;
  readonly word?: string;
  readonly example?: string;
}

/** Flags of an uncertain decision: FR 12 «порядок дати припущено», FR 11 «неоднозначне ціле». */
export type DecisionFlag = "date-order-assumed" | "ambiguous-integer" | "decimal-assumed" | "all-positive";

export interface Decision<V> {
  readonly chosen: Hypothesis<V>;
  readonly alternatives: readonly Hypothesis<V>[];
  readonly evidence: readonly Evidence[];
  readonly flags: readonly DecisionFlag[];
}

export interface ColumnAnalysis {
  readonly column: number;
  readonly header: string | null;
  readonly role: Decision<Role>;
}

export interface TableAnalysis {
  /** 1-based; null — no header row was found. */
  readonly headerRow: number | null;
  readonly dataRows: number;
  readonly evidence: readonly Evidence[];
}

export interface CurrencyAnalysis {
  readonly mode: "column" | "file" | "unknown";
  readonly code: string | null;
  readonly evidence: readonly Evidence[];
}

export interface StatementAnalysis {
  readonly table: TableAnalysis;
  readonly columns: readonly ColumnAnalysis[];
  readonly dates: Decision<DateFormat> | null;
  readonly numbers: Decision<NumberFormat> | null;
  readonly sign: Decision<SignMode> | null;
  readonly currency: CurrencyAnalysis;
}

const round2 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
const clip = (cell: string): string => {
  const t = cell.trim();
  return t.length > ANALYSIS_LIMITS.exampleChars ? `${t.slice(0, ANALYSIS_LIMITS.exampleChars - 1)}…` : t;
};
const filled = (row: readonly string[]): number => row.filter((c) => c.trim() !== "").length;

function decide<V>(
  hypotheses: readonly Hypothesis<V>[],
  evidence: readonly Evidence[],
  flags: readonly DecisionFlag[] = [],
): Decision<V> {
  // Stable: equal scores keep the order given (the fixed order of the hypotheses).
  const sorted = [...hypotheses].sort((a, b) => b.score - a.score);
  return {
    chosen: sorted[0]!,
    alternatives: sorted.slice(1, 1 + ANALYSIS_LIMITS.alternatives),
    evidence,
    flags,
  };
}

// ——— Dates (FR 8, FR 12) ———

interface DateSample {
  readonly text: string;
  readonly cell: DateCell;
}

function decideDates(samples: readonly DateSample[]): Decision<DateFormat> | null {
  if (samples.length === 0) return null;
  const cells = samples.map((s) => s.cell);
  const valid = (order: DateOrder) => samples.filter((s) => readDate(s.cell, order) !== null);
  const share = (order: DateOrder) => valid(order).length / samples.length;
  const firstOver12 = samples.filter((s) => s.cell.parts[0].length <= 2 && Number(s.cell.parts[0]) > 12);
  const secondOver12 = samples.filter((s) => s.cell.parts[0].length <= 2 && Number(s.cell.parts[1]) > 12);
  const evidence: Evidence[] = [];
  const flags: DecisionFlag[] = [];
  const score: Record<DateOrder, number> = { dmy: share("dmy"), mdy: share("mdy"), ymd: share("ymd") };
  const yearFirst = samples.filter((s) => s.cell.parts[0].length === 4);
  if (yearFirst.length > 0)
    evidence.push({
      code: "year-first",
      count: yearFirst.length,
      of: samples.length,
      example: yearFirst[0]!.text,
    });
  else if (firstOver12.length > 0 && secondOver12.length === 0)
    evidence.push({
      code: "day-first",
      count: firstOver12.length,
      of: samples.length,
      example: firstOver12[0]!.text,
    });
  else if (secondOver12.length > 0 && firstOver12.length === 0)
    evidence.push({
      code: "month-first",
      count: secondOver12.length,
      of: samples.length,
      example: secondOver12[0]!.text,
    });
  else if (firstOver12.length > 0 && secondOver12.length > 0)
    evidence.push({
      code: "conflicting-days",
      count: firstOver12.length + secondOver12.length,
      of: samples.length,
      example: firstOver12[0]!.text,
    });
  else if (score.dmy === score.mdy && score.dmy > 0) {
    // FR 12: no day over 12 and no other evidence — day-month with 0.55 and the flag «порядок дати припущено»,
    // also when some cells (a «00.00.0000» placeholder) read under neither order.
    evidence.push({ code: "no-day-over-12", count: samples.length });
    flags.push("date-order-assumed");
    score.dmy = 0.55;
    score.mdy = 0.45;
  }
  // Examples that tell the orders apart come first.
  const telling = [...firstOver12, ...secondOver12, ...yearFirst];
  const shown = [...new Set([...telling, ...samples].map((s) => s.text))].slice(0, ANALYSIS_LIMITS.examples);
  const hypotheses = (["dmy", "mdy", "ymd"] as const)
    .filter((order) => score[order] > 0 || order !== "ymd")
    .map((order): Hypothesis<DateFormat> => ({
      value: { order, format: dateFormatLabel(cells, order) },
      label: dateFormatLabel(cells, order),
      score: round2(score[order]),
      examples: shown.map((text) => ({ cell: clip(text), reads: readDate(dateCell(text)!, order) })),
    }));
  return decide(hypotheses, evidence, flags);
}

// ——— Numbers (FR 8, FR 11) ———

interface NumberSample {
  readonly text: string;
  readonly cell: NumberCell;
}

function decideNumbers(samples: readonly NumberSample[]): Decision<NumberFormat> | null {
  if (samples.length === 0) return null;
  const evidence: Evidence[] = [];
  const flags: DecisionFlag[] = [];
  const reads = (decimal: DecimalSeparator) =>
    samples.map((s) => readNumber(s.cell, decimal)).filter((r) => r !== null);
  const score: Record<DecimalSeparator, number> = {
    ",": reads(",").length / samples.length,
    ".": reads(".").length / samples.length,
  };
  for (const decimal of [",", "."] as const) {
    const only = samples.filter(
      (s) =>
        readNumber(s.cell, decimal)?.integer === false &&
        readNumber(s.cell, decimal === "," ? "." : ",") === null,
    );
    if (only.length > 0)
      evidence.push({
        code: "decimal-separator",
        word: decimal,
        count: only.length,
        of: samples.length,
        example: only[0]!.text,
      });
  }
  const ambiguous = samples.filter((s) => isAmbiguousInteger(s.cell));
  if (score[","] === score["."]) {
    if (ambiguous.length > 0)
      evidence.push({ code: "ambiguous-integers", count: ambiguous.length, of: samples.length });
    else evidence.push({ code: "no-decimal-evidence", count: samples.length });
    // FR 11: 4+ «d,ddd» values, at least 75 % ending in «00», are thousands; otherwise the comma decimal is assumed.
    // Both separators among them («1,200» and «2.500», #624): no one reading makes both thousands, so the rule does
    // not apply and the comma decimal is assumed, flagged as ambiguous integers too.
    const separators = new Set(ambiguous.map((s) => s.cell.body.match(/[.,]/)![0] as DecimalSeparator));
    const separator = separators.size === 1 ? [...separators][0] : undefined;
    const hundreds = ambiguous.filter((s) => s.cell.body.endsWith("00"));
    if (separators.size > 1) {
      evidence.push({ code: "mixed-separators", count: ambiguous.length, of: samples.length });
      flags.push("ambiguous-integer", "decimal-assumed");
      score[","] = 0.55;
      score["."] = 0.45;
    } else if (separator && ambiguous.length >= 4 && hundreds.length * 4 >= ambiguous.length * 3) {
      flags.push("ambiguous-integer");
      const decimal: DecimalSeparator = separator === "," ? "." : ",";
      score[decimal] = 0.55;
      score[separator] = 0.45;
    } else {
      flags.push("decimal-assumed");
      score[","] = 0.55;
      score["."] = 0.45;
    }
  }
  const hypotheses = ["," as const, "." as const].map((decimal): Hypothesis<NumberFormat> => {
    const counts = new Map<ThousandsSeparator, number>();
    for (const r of reads(decimal))
      if (r.thousands !== "none") counts.set(r.thousands, (counts.get(r.thousands) ?? 0) + 1);
    let thousands: ThousandsSeparator = "none";
    for (const [sep, n] of counts) if (n > (counts.get(thousands) ?? 0)) thousands = sep;
    return {
      value: { decimalSeparator: decimal, thousandsSeparator: thousands },
      label: numberFormatLabel(decimal, thousands),
      score: round2(score[decimal]),
      examples: telling(samples).map((s) => ({
        cell: clip(s.text),
        reads: readNumber(s.cell, decimal)?.value ?? null,
      })),
    };
  });
  const chosen = decide(hypotheses, evidence, flags).chosen;
  if (chosen.value.thousandsSeparator !== "none") {
    const withIt = samples.filter(
      (s) => readNumber(s.cell, chosen.value.decimalSeparator)?.thousands === chosen.value.thousandsSeparator,
    );
    evidence.push({
      code: "thousands-separator",
      word: chosen.value.thousandsSeparator,
      count: withIt.length,
      of: samples.length,
      example: withIt[0]!.text,
    });
  }
  return decide(hypotheses, evidence, flags);
}

/** Examples of numbers that tell the formats apart first: a separator, then the rest. */
function telling(samples: readonly NumberSample[]): NumberSample[] {
  const seen = new Set<string>();
  const ordered = [...samples.filter((s) => /[.,]/.test(s.cell.body)), ...samples].filter((s) => {
    if (seen.has(s.text)) return false;
    seen.add(s.text);
    return true;
  });
  return ordered.slice(0, ANALYSIS_LIMITS.examples);
}

// ——— Columns (FR 8) ———

type Kind = "date" | "number" | "currency" | "text" | "empty";

/** Header words of each role (normalised as `normalizeHeaderCell` does: lower case, no digits, codes or diacritics). */
const HEADER_WORDS: Readonly<Record<Exclude<Role, "ignore">, readonly string[]>> = {
  date: [
    "дата",
    "дата операции",
    "дата операції",
    "date",
    "transaction date",
    "booking date",
    "posting date",
    // IMP-02 FR 4 (S-047): a Spanish export («Fecha», BBVA-like).
    "fecha",
    "fecha operacion",
  ],
  "value-date": [
    "дата валютування",
    "дата проведення",
    "value date",
    "дата обробки",
    "f valor",
    "fecha valor",
  ],
  amount: ["сума", "сума операції", "amount", "transaction amount", "сумма", "importe"],
  debit: ["дебет", "списання", "витрата", "debit", "withdrawal", "money out"],
  credit: ["кредит", "зарахування", "надходження", "credit", "deposit", "money in"],
  balance: [
    "залишок",
    "баланс",
    "balance",
    "залишок після операції",
    "running balance",
    "saldo",
    "disponible",
  ],
  currency: ["валюта", "currency", "валюта рахунку", "ccy", "divisa"],
  description: [
    "опис",
    "призначення",
    "призначення платежу",
    "деталі операції",
    "description",
    "details",
    "narrative",
    // IMP-02 FR 4 (S-047): the bank's other text columns and its free-text notes are a part of its description.
    "concepto",
    "movimiento",
    "observaciones",
    "примітка",
    "примітки",
    "коментар",
    "notes",
    "remarks",
    "memo",
  ],
  counterparty: [
    "контрагент",
    "отримувач",
    "платник",
    "кореспондент",
    "counterparty",
    "payee",
    "payer",
    "merchant",
  ],
  reference: ["референс", "номер документа", "документ", "reference", "ref", "id операції", "transaction id"],
  status: ["статус", "status", "state"],
  fee: ["комісія", "комісія банку", "fee", "commission", "charges"],
  "original-amount": [
    "сума в валюті операції",
    "сума у валюті операції",
    "original amount",
    "сума операції у валюті картки",
  ],
  "original-currency": ["валюта операції", "original currency", "transaction currency"],
  "exchange-rate": ["курс", "курс валюти", "exchange rate", "rate"],
};

/**
 * Header words besides the dictionary above, kept apart so the dictionary's lines stay as they are (#694). The amount
 * posted to a card names the card's currency («Сума в валюті картки (UAH)»): its own phrase, so it scores above the
 * other «Сума …» columns (the commission, the cashback, the operation's amount). The commission is «Сума комісій».
 */
const MORE_HEADER_WORDS: Readonly<Partial<Record<Exclude<Role, "ignore">, readonly string[]>>> = {
  amount: ["сума в валюті картки", "сума у валюті картки"],
  fee: ["сума комісій", "комісій"],
  // IMP-02 FR 4 (S-047, #696): a Spanish export's reference («Referencia»), never a figure.
  reference: ["referencia"],
};

/**
 * Columns that are never an amount and are ignored by their header (IMP-02@PoC FR 4). Рішення ведучого (2026-11-21;
 * власник не схвалював; IMP-02): the cashback is not a part of the operation's amount (FR 4 lists no cashback, and the
 * bank posts it to the account as an operation of its own), so «Сума кешбеку» is ignored for the amount, not a note.
 */
const IGNORE_WORDS: readonly string[] = ["сума кешбеку", "кешбек", "кешбеку", "cashback"];

/** Words of a header that names a code (MCC, «код»): such a column of four-digit integers is never an amount (#694). */
const CODE_WORDS: readonly string[] = ["mcc", "код", "codigo"];

/** The roles that read a number as money or a rate: never a code column's (#694). */
const MONEY_ROLES: ReadonlySet<Role> = new Set([
  "amount",
  "debit",
  "credit",
  "balance",
  "fee",
  "original-amount",
  "exchange-rate",
]);

/** «—» and «–» print «nothing» in a number column (monobank's «Курс», «Сума комісій»): an empty cell (#694). */
const PLACEHOLDERS: ReadonlySet<string> = new Set(["—", "–"]);
const blankPlaceholder = (cell: string): string => (PLACEHOLDERS.has(cell.trim()) ? "" : cell);

const EXPECTS: Readonly<Record<Role, readonly Kind[]>> = {
  date: ["date"],
  "value-date": ["date"],
  amount: ["number"],
  debit: ["number"],
  credit: ["number"],
  balance: ["number"],
  fee: ["number"],
  "original-amount": ["number"],
  "exchange-rate": ["number"],
  currency: ["currency"],
  "original-currency": ["currency"],
  description: ["text"],
  counterparty: ["text"],
  reference: ["text", "number"],
  status: ["text"],
  ignore: ["date", "number", "currency", "text", "empty"],
};

/** The score a role gets from content alone (no header word). */
const CONTENT_ONLY: Readonly<Partial<Record<Kind, Partial<Record<Role, number>>>>> = {
  date: { date: 0.5, "value-date": 0.3 },
  number: { amount: 0.4, balance: 0.25, debit: 0.2, credit: 0.2, fee: 0.1, "exchange-rate": 0.1 },
  currency: { currency: 0.6, "original-currency": 0.3 },
  text: { description: 0.4, counterparty: 0.25, reference: 0.15, status: 0.1 },
};

/** Roles at most one column takes; several columns may be description, counterparty or ignored. */
const SINGLE: ReadonlySet<Role> = new Set(
  ROLES.filter((r) => !["description", "counterparty", "ignore"].includes(r)),
);

export function headerMatch(
  header: string,
  phrases: readonly string[],
): { score: number; word: string } | null {
  const words = normalizeHeaderCell(header);
  if (!words) return null;
  let best: { score: number; word: string } | null = null;
  for (const phrase of phrases) {
    // The dictionary is normalised as the header is («операції» → «операціі»), or a word with «ї» never matches.
    const normal = normalizeHeaderCell(phrase);
    const score =
      words === normal
        ? 0.7
        : ` ${words} `.includes(` ${normal} `)
          ? 0.35 + 0.05 * Math.min(3, phrase.split(" ").length)
          : 0;
    if (score > 0 && (!best || score > best.score)) best = { score, word: phrase };
  }
  return best;
}

/** The code a currency cell reads as (ISO, numeric or an unambiguous symbol), or null. */
const currencyOf = (cell: string): string | null => {
  const r = recognizeCurrency(cell);
  return r?.status === "code" ? r.code : null;
};

function kindOf(cells: readonly string[]): { kind: Kind; count: number; of: number } {
  const values = cells.map((c) => c.trim()).filter((c) => c !== "");
  if (values.length === 0) return { kind: "empty", count: 0, of: 0 };
  const share = (test: (c: string) => boolean) => values.filter(test).length;
  for (const [kind, test] of [
    ["date", (c: string) => dateCell(c) !== null],
    ["currency", isCurrencyCell],
    ["number", (c: string) => numberCell(c) !== null],
  ] as const) {
    const n = share(test);
    if (n * 5 >= values.length * 4) return { kind, count: n, of: values.length };
  }
  return { kind: "text", count: values.length, of: values.length };
}

interface ColumnFacts {
  readonly column: number;
  readonly header: string | null;
  readonly cells: readonly string[];
  readonly kind: { kind: Kind; count: number; of: number };
  /** Every filled cell is a three-letter upper-case code, known or not (RUR): a currency column with its header. */
  readonly codeLike: boolean;
}

/**
 * #694: a column of integers 0000–9999 whose header names a code (MCC, «код») is a merchant category or another code,
 * never money: four-digit integers read as numbers, so without the guard the MCC took a free amount role (the debit,
 * beside the commission as the credit) and the amounts were imported from the codes. Returns the header's code word.
 */
function codeColumn(facts: ColumnFacts): string | null {
  const words = facts.header ? normalizeHeaderCell(facts.header).split(" ") : [];
  const word = CODE_WORDS.find((w) => words.includes(w));
  if (!word) return null;
  const values = facts.cells.map((c) => c.trim()).filter((c) => c !== "");
  // A numeric currency code (980, 840) is a currency, not a code to ignore (IMP-02@PoC FR 9, AC7).
  if (values.length === 0 || values.every((c) => currencyOf(c) !== null)) return null;
  return values.every((c) => /^\d{1,4}$/.test(c)) ? word : null;
}

function roleScores(facts: ColumnFacts): Map<Role, { score: number; word?: string }> {
  const scores = new Map<Role, { score: number; word?: string }>();
  const code = codeColumn(facts);
  for (const role of ROLES) {
    const fits =
      EXPECTS[role].includes(facts.kind.kind) ||
      ((role === "currency" || role === "original-currency") && facts.codeLike);
    if (role === "ignore") {
      const ignored = facts.header ? headerMatch(facts.header, IGNORE_WORDS) : null;
      if (ignored) scores.set(role, { score: ignored.score + 0.3, word: ignored.word });
      else if (code) scores.set(role, { score: 0.9, word: code });
      else scores.set(role, { score: facts.kind.kind === "empty" ? 0.9 : 0.05 });
      continue;
    }
    if (code && MONEY_ROLES.has(role)) continue;
    const header = facts.header
      ? headerMatch(facts.header, [...HEADER_WORDS[role], ...(MORE_HEADER_WORDS[role] ?? [])])
      : null;
    const score = header
      ? fits
        ? header.score + 0.3
        : header.score * 0.5
      : (CONTENT_ONLY[facts.kind.kind]?.[role] ?? 0);
    if (score > 0) scores.set(role, header ? { score, word: header.word } : { score });
  }
  return scores;
}

/**
 * IMP-02@PoC FR 4: a card statement names the currency posted to the account in the amount column's header («Сума в
 * валюті картки (UAH)») and prints the original operation's amount and currency beside it («Сума в валюті операції»,
 * «Валюта» — USD for a purchase abroad). There the bare currency column is the original currency, never each row's:
 * the rows are in the header's currency, so a purchase abroad does not make the file another currency's (IMP-05 EC3).
 * Only when the original amount has no currency column of its own; without a currency in the amount's header the
 * column stays the row's currency (FR 3).
 */
function postedCurrency(
  facts: readonly ColumnFacts[],
  assigned: ReadonlyMap<number, Role>,
  taken: ReadonlyMap<Role, number>,
): { column: number; from: number; code: string } | null {
  const column = taken.get("currency");
  if (column === undefined || !taken.has("original-amount") || taken.has("original-currency")) return null;
  for (const [i, f] of facts.entries()) {
    const role = assigned.get(i);
    const code = f.header ? headerCurrency(f.header) : null;
    if (code && (role === "amount" || role === "debit" || role === "credit"))
      return { column, from: i, code };
  }
  return null;
}

function decideColumns(
  facts: readonly ColumnFacts[],
  readCell: (role: Role, cell: string) => string | null,
): ColumnAnalysis[] {
  const scored = facts.map((f) => roleScores(f));
  // Greedy: the strongest (column, role) pairs first; a single role goes to one column only.
  const pairs = scored.flatMap((scores, i) => [...scores].map(([role, s]) => ({ i, role, score: s.score })));
  pairs.sort((a, b) => b.score - a.score || a.i - b.i || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  const assigned = new Map<number, Role>();
  const taken = new Map<Role, number>();
  for (const { i, role } of pairs) {
    if (assigned.has(i) || (SINGLE.has(role) && taken.has(role))) continue;
    // #694: a file has an amount column or a debit and a credit column. Once the amount is taken, a number column
    // without a debit or credit header word is not a debit or credit by its content alone: two such columns (a zero
    // commission and cashback) would switch the sign to «debit-credit» and import the amounts from them.
    if ((role === "debit" || role === "credit") && taken.has("amount") && !scored[i]!.get(role)?.word)
      continue;
    assigned.set(i, role);
    if (SINGLE.has(role)) taken.set(role, i);
  }
  const posted = postedCurrency(facts, assigned, taken);
  if (posted) {
    // The bare currency column is the original operation's: its score is the one it had as the row's currency.
    const scores = scored[posted.column]!;
    scores.set("original-currency", { score: scores.get("currency")!.score });
    assigned.set(posted.column, "original-currency");
    taken.delete("currency");
    taken.set("original-currency", posted.column);
  }
  return facts.map((f, i) => {
    const scores = scored[i]!;
    const chosenRole = assigned.get(i) ?? "ignore";
    const examples = f.cells.filter((c) => c.trim() !== "").slice(0, ANALYSIS_LIMITS.examples);
    const hypothesis = (role: Role): Hypothesis<Role> => ({
      value: role,
      label: role,
      score: round2(scores.get(role)?.score ?? 0),
      examples: examples.map((c) => ({ cell: clip(c), reads: readCell(role, c) })),
    });
    const evidence: Evidence[] = [];
    const word = scores.get(chosenRole)?.word;
    if (word) evidence.push({ code: "header-word", column: f.column, word });
    evidence.push({
      code: "content",
      column: f.column,
      word: f.kind.kind,
      count: f.kind.count,
      of: f.kind.of,
    });
    if (posted?.column === i)
      evidence.push({ code: "currency-in-header", column: facts[posted.from]!.column, word: posted.code });
    const ranked = [...scores].sort((a, b) => b[1].score - a[1].score);
    const better = ranked.find(
      ([role]) => role !== chosenRole && SINGLE.has(role) && taken.has(role) && taken.get(role) !== i,
    );
    if (better && better[1].score > (scores.get(chosenRole)?.score ?? 0))
      evidence.push({ code: "role-taken", word: better[0], column: facts[taken.get(better[0])!]!.column });
    const alternatives = ranked
      .map(([role]) => role)
      .filter((role) => role !== chosenRole)
      .slice(0, ANALYSIS_LIMITS.alternatives)
      .map(hypothesis);
    return {
      column: f.column,
      header: f.header,
      role: { chosen: hypothesis(chosenRole), alternatives, evidence, flags: [] },
    };
  });
}

// ——— Sign (FR 8) ———

export const OUT_VALUES: ReadonlySet<string> = new Set([
  "дт",
  "дебет",
  "d",
  "dr",
  "debit",
  "списання",
  "витрата",
  "-",
  "out",
]);
export const IN_VALUES: ReadonlySet<string> = new Set([
  "кт",
  "кредит",
  "c",
  "cr",
  "credit",
  "зарахування",
  "надходження",
  "+",
  "in",
]);

function decideSign(
  columns: readonly ColumnAnalysis[],
  facts: readonly ColumnFacts[],
  read: (cell: string) => NumberCell | null,
  render: (cell: NumberCell, negate: boolean) => string | null,
): Decision<SignMode> | null {
  const byRole = (role: Role) => columns.findIndex((c) => c.role.chosen.value === role);
  const debit = byRole("debit");
  const credit = byRole("credit");
  const amount = byRole("amount");
  const hypothesis = (value: SignMode, score: number, examples: Example[]): Hypothesis<SignMode> => ({
    value,
    label: value,
    score: round2(score),
    examples,
  });
  if (debit >= 0 && credit >= 0) {
    const cells = facts[debit]!.cells.filter((c) => read(c)).slice(0, ANALYSIS_LIMITS.examples);
    const show = (negate: boolean) => cells.map((c) => ({ cell: clip(c), reads: render(read(c)!, negate) }));
    return decide(
      [hypothesis("debit-credit", 0.9, show(true)), hypothesis("as-printed", 0.1, show(false))],
      [{ code: "debit-credit-columns", column: facts[debit]!.column, word: String(facts[credit]!.column) }],
    );
  }
  if (amount < 0) return null;
  const values = facts[amount]!.cells.filter((c) => read(c));
  const negatives = values.filter((c) => read(c)!.negative);
  const shown = [...negatives.slice(0, 1), ...values].filter((c, i, all) => all.indexOf(c) === i);
  const show = (negate: boolean) =>
    shown.slice(0, ANALYSIS_LIMITS.examples).map((c) => ({ cell: clip(c), reads: render(read(c)!, negate) }));
  if (negatives.length > 0)
    return decide(
      [hypothesis("as-printed", 0.9, show(false)), hypothesis("invert", 0.1, show(true))],
      [
        {
          code: "negative-amounts",
          column: facts[amount]!.column,
          count: negatives.length,
          of: values.length,
          example: negatives[0]!.trim(),
        },
      ],
    );
  const indicator = facts.find((f, i) => {
    if (i === amount || f.kind.kind !== "text") return false;
    const seen = new Set(f.cells.map((c) => c.trim().toLowerCase()).filter((c) => c !== ""));
    return (
      seen.size === 2 && [...seen].some((v) => OUT_VALUES.has(v)) && [...seen].some((v) => IN_VALUES.has(v))
    );
  });
  if (indicator) {
    const rowsOf = facts[amount]!.cells;
    const examples = rowsOf
      .map((c, row) => ({ c, mark: indicator.cells[row]!.trim() }))
      .filter(({ c }) => read(c))
      .slice(0, ANALYSIS_LIMITS.examples)
      .map(({ c, mark }) => ({
        cell: clip(`${mark} ${c}`),
        reads: render(read(c)!, OUT_VALUES.has(mark.toLowerCase())),
      }));
    return decide(
      [hypothesis("indicator", 0.8, examples), hypothesis("as-printed", 0.2, show(false))],
      [{ code: "indicator-column", column: indicator.column }],
    );
  }
  return decide(
    [hypothesis("as-printed", 0.5, show(false)), hypothesis("invert", 0.4, show(true))],
    [{ code: "no-negative-amounts", column: facts[amount]!.column, count: values.length }],
    ["all-positive"],
  );
}

// ——— Currency (FR 8: evidence only) ———

function decideCurrency(columns: readonly ColumnAnalysis[], facts: readonly ColumnFacts[]): CurrencyAnalysis {
  const column = columns.findIndex((c) => c.role.chosen.value === "currency");
  if (column >= 0) {
    const counts = new Map<string, number>();
    for (const c of facts[column]!.cells) {
      const code = currencyOf(c);
      if (code !== null) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const codes = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      mode: "column",
      code: codes.length === 1 ? codes[0]![0] : null,
      evidence: codes.map(([code, count]) => ({
        code: "currency-column" as const,
        column: facts[column]!.column,
        word: code,
        count,
      })),
    };
  }
  for (const f of facts) {
    const code = f.header ? headerCurrency(f.header) : null;
    if (
      code &&
      ["amount", "balance", "debit", "credit"].includes(columns[facts.indexOf(f)]!.role.chosen.value)
    )
      return { mode: "file", code, evidence: [{ code: "currency-in-header", column: f.column, word: code }] };
  }
  return { mode: "unknown", code: null, evidence: [{ code: "no-currency" }] };
}

// ——— The table ———

/**
 * The analysis of a read table. `headerRow` and `firstRow` are 0-based (as `readDelimitedFile` gives them); the
 * result is 1-based.
 */
export function analyzeTable(
  rows: readonly (readonly string[])[],
  headerRow: number | null,
  firstRow = 0,
): StatementAnalysis {
  const from = headerRow === null ? firstRow : headerRow + 1;
  const data = rows.slice(from).filter((r) => filled(r) >= 2);
  const sample = data.slice(0, ANALYSIS_LIMITS.sampleRows);
  const header = headerRow === null ? null : rows[headerRow]!;
  const width = Math.max(header?.length ?? 0, ...sample.map((r) => r.length), 0);
  const tableEvidence: Evidence[] =
    headerRow === null
      ? [{ code: "no-header-row" }]
      : [{ code: "header-row", row: headerRow + 1, count: filled(header!) }];
  if (headerRow !== null && headerRow > firstRow)
    tableEvidence.push({ code: "rows-before-header", count: headerRow - firstRow });
  tableEvidence.push({ code: "data-rows", count: data.length });
  const facts: ColumnFacts[] = Array.from({ length: width }, (_, i) => {
    const cells = sample.map((r) => blankPlaceholder(r[i] ?? ""));
    const h = header?.[i]?.trim();
    // Header words are matched on the first characters only: a longer header is not a bank's column name.
    return {
      column: i + 1,
      header: h ? h.slice(0, ANALYSIS_LIMITS.headerChars) : null,
      cells,
      kind: kindOf(cells),
      codeLike: cells.some((c) => c.trim() !== "") && cells.every((c) => c.trim() === "" || isCodeLike(c)),
    };
  });
  const dateSamples = facts
    .filter((f) => f.kind.kind === "date")
    .flatMap((f) =>
      f.cells.flatMap((text) => (dateCell(text) ? [{ text: text.trim(), cell: dateCell(text)! }] : [])),
    );
  const dates = decideDates(dateSamples);
  const numberSamples = facts
    .filter((f) => f.kind.kind === "number")
    .flatMap((f) =>
      f.cells.flatMap((text) => (numberCell(text) ? [{ text: text.trim(), cell: numberCell(text)! }] : [])),
    );
  const numbers = decideNumbers(numberSamples);
  const decimal = numbers?.chosen.value.decimalSeparator ?? ",";
  const readCell = (role: Role, cell: string): string | null => {
    const kinds = EXPECTS[role];
    if (role !== "ignore" && kinds.includes("date") && dates) {
      const d = dateCell(cell);
      return d ? readDate(d, dates.chosen.value.order) : null;
    }
    if (role !== "ignore" && kinds[0] === "number") {
      const n = numberCell(cell);
      return n ? (readNumber(n, decimal)?.value ?? null) : null;
    }
    if (role === "currency" || role === "original-currency") return currencyOf(cell);
    return clip(cell);
  };
  const columns = decideColumns(facts, readCell);
  const render = (cell: NumberCell, negate: boolean): string | null => {
    const value = readNumber({ ...cell, negative: false }, decimal)?.value;
    if (value === undefined) return null;
    const negative = cell.negative !== negate;
    return negative && !/^0(?:\.0*)?$/.test(value) ? `-${value}` : value;
  };
  const sign = decideSign(columns, facts, numberCell, render);
  return {
    table: {
      headerRow: headerRow === null ? null : headerRow + 1,
      dataRows: data.length,
      evidence: tableEvidence,
    },
    columns,
    dates,
    numbers,
    sign,
    currency: decideCurrency(columns, facts),
  };
}

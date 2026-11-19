import { isCurrencyCode } from "@willowsum/domain-kernel";

/**
 * The format's signature (IMP-06@PoC FR 7): the normalised header, the number of columns and the labels of the
 * preamble (the lines before the table). Case, diacritics, digits and currency codes in a header are ignored —
 * «Залишок (EUR)» and «Залишок (UAH)» are one format. Of the preamble only a label's key counts — the text before «:»
 * of a line's first cell, without digits and month names, and never one with «@». A line without «:» (a title, a
 * client's name beside an account number, an e-mail) gives no label, and values after «:» never count, so account
 * numbers, periods, names and e-mails stay out of the signature. The fingerprint is the hash of
 * `signatureText` (application layer); `signatureSimilarity` hints «формат змінився».
 */
export interface FormatSignature {
  readonly version: 1;
  /** Columns of the header row (up to its last non-empty cell). */
  readonly columns: number;
  /** The normalised header cells. */
  readonly header: readonly string[];
  /** The normalised labels of the preamble, unique, sorted. */
  readonly labels: readonly string[];
}

/** Rows searched for the header after the skipped ones. */
const HEADER_SEARCH_ROWS = 50;
/** Rows whose widths give the table's usual width. */
const WIDTH_SAMPLE_ROWS = 200;
/** Currency words a header writes that are not ISO codes. */
const CURRENCY_WORDS = new Set(["грн", "руб", "zł", "zl", "kr"]);

/** Month names (Ukrainian nominative and genitive, English), normalised: a label drops them (FR 7, periods). */
const MONTHS = new Set(
  [
    "січень січня лютий лютого березень березня квітень квітня травень травня червень червня",
    "липень липня серпень серпня вересень вересня жовтень жовтня листопад листопада грудень грудня",
    "january february march april may june july august september october november december",
    "jan feb mar apr jun jul aug sep sept oct nov dec",
  ]
    .join(" ")
    .split(" ")
    .map((m) => normalizeHeaderCell(m)),
);

/** A header cell (or a label) as the signature compares it. */
export function normalizeHeaderCell(cell: string): string {
  return cell
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}]+/u)
    .filter((token) => token && !(/^[A-Za-z]{3}$/.test(token) && isCurrencyCode(token.toUpperCase())))
    .map((token) => token.toLowerCase())
    .filter((token) => !CURRENCY_WORDS.has(token))
    .join(" ");
}

const VALUE = /^[-+]?[\d\s.,'’]+$|^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|^[A-Z]{2}\d{2}[A-Z0-9 ]{10,}$/i;

const width = (row: readonly string[]): number => {
  let w = row.length;
  while (w > 0 && row[w - 1]!.trim() === "") w--;
  return w;
};

const filled = (row: readonly string[]): string[] => row.map((c) => c.trim()).filter((c) => c !== "");

/** The table's header row at or after `from` (0-based), or null: a wide row of words, no values and no «key:». */
export function findHeaderRow(rows: readonly (readonly string[])[], from: number): number | null {
  const widths = new Map<number, number>();
  for (const row of rows.slice(from, from + WIDTH_SAMPLE_ROWS)) {
    const w = filled(row).length;
    if (w >= 2) widths.set(w, (widths.get(w) ?? 0) + 1);
  }
  let usual = 2;
  let seen = 0;
  for (const [w, n] of widths) if (n > seen || (n === seen && w > usual)) [usual, seen] = [w, n];
  const needed = Math.max(2, Math.ceil(usual * 0.6));
  for (let i = from; i < Math.min(rows.length, from + HEADER_SEARCH_ROWS); i++) {
    const cells = filled(rows[i]!);
    if (cells.length < needed) continue;
    if (cells.some((c) => VALUE.test(c) || c.endsWith(":"))) continue;
    if (cells.filter((c) => /\p{L}/u.test(c)).length * 3 >= cells.length * 2) return i;
  }
  return null;
}

function labelOf(row: readonly string[]): string | null {
  const first = filled(row)[0];
  if (first === undefined) return null;
  // Only a «key:» is a label: the first cell of a line without one may be a client's name beside the account number.
  const colon = first.indexOf(":");
  if (colon < 0) return null;
  const key = first.slice(0, colon);
  if (key.includes("@")) return null;
  // FR 7: a period in the key («Виписка за березень 2026:») does not change the format.
  return normalizeHeaderCell(key)
    .split(" ")
    .filter((token) => !MONTHS.has(token))
    .join(" ");
}

/**
 * The signature of a table (rows as read): the header is the recipe's `headerRow` (0-based) or the one found after
 * `skipRows`; the preamble is the rows between them. Null when there is no header.
 */
export function formatSignature(
  rows: readonly (readonly string[])[],
  options: { readonly skipRows?: number; readonly headerRow?: number | null } = {},
): FormatSignature | null {
  const skip = options.skipRows ?? 0;
  const at = options.headerRow ?? findHeaderRow(rows, skip);
  if (at === null || at < 0 || at >= rows.length) return null;
  const headerCells = rows[at]!.slice(0, width(rows[at]!));
  const labels = new Set<string>();
  for (const row of rows.slice(Math.min(skip, at), at)) {
    const label = labelOf(row);
    const normal = label === null ? "" : normalizeHeaderCell(label);
    if (normal) labels.add(normal);
  }
  return {
    version: 1,
    columns: headerCells.length,
    header: headerCells.map(normalizeHeaderCell),
    labels: [...labels].sort(),
  };
}

/** The canonical text of a signature: what the fingerprint hashes. */
export function signatureText(signature: FormatSignature): string {
  return JSON.stringify(["fp", signature.version, signature.columns, signature.header, signature.labels]);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * How alike two formats are, 0–1 (two decimals): 0.6 × the header cells equal at the same place, 0.2 × the ratio of the
 * column counts, 0.2 × the labels in common (Jaccard; none on both sides is alike).
 */
export function signatureSimilarity(a: FormatSignature, b: FormatSignature): number {
  const longest = Math.max(a.header.length, b.header.length, 1);
  let same = 0;
  for (let i = 0; i < Math.min(a.header.length, b.header.length); i++)
    if (a.header[i] === b.header[i]) same++;
  const columns = Math.min(a.columns, b.columns) / Math.max(a.columns, b.columns, 1);
  const union = new Set([...a.labels, ...b.labels]);
  const shared = a.labels.filter((l) => b.labels.includes(l)).length;
  const labels = union.size === 0 ? 1 : shared / union.size;
  return round2(0.6 * (same / longest) + 0.2 * columns + 0.2 * labels);
}

export type FormatMatch =
  | { readonly status: "match"; readonly similarity: 1 }
  | { readonly status: "changed"; readonly similarity: number }
  | { readonly status: "unknown"; readonly similarity: null };

/** FR 6: «збіг», «змінився» or «невідомо» (either side has no signature). */
export function compareSignatures(
  expected: FormatSignature | null,
  actual: FormatSignature | null,
): FormatMatch {
  if (!expected || !actual) return { status: "unknown", similarity: null };
  if (signatureText(expected) === signatureText(actual)) return { status: "match", similarity: 1 };
  return { status: "changed", similarity: signatureSimilarity(expected, actual) };
}

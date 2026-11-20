/**
 * The binding of a statement to its account (IMP-06@PoC FR 1 «прив'язка до рахунку»; wave 2 row 41 part 3): the
 * recipe's account value — an IBAN, an account number or a card mask, opened only in the parse worker — is looked for
 * in the rows before the table (the preamble; rows the recipe skips are not read, EC3). Only the outcome leaves the
 * worker, never the value or what the file holds:
 * - `match` — the file names the recipe's account;
 * - `mismatch` — the file names an account of the same kind, and it is another one;
 * - `not-found` — the file names no account of that kind.
 * Bindings by a header pattern or a column come with applying a recipe's rules (IMP-06 FR 4).
 */
export const ACCOUNT_BINDINGS = ["iban", "account-number", "mask"] as const;
export type AccountBindingKind = (typeof ACCOUNT_BINDINGS)[number];

export interface AccountMatch {
  readonly by: AccountBindingKind;
  readonly status: "match" | "mismatch" | "not-found";
}

/**
 * An IBAN-shaped value in a cell's own text (upper-cased, not compacted, so a label before it — «IBAN UA…», «Account
 * UA…» — is not glued to it): two letters, two digits, then 11–30 letters or digits, each after an optional space or
 * hyphen (groups of any size). One character per step, so the search backtracks at most 30 steps per start (the file is
 * untrusted).
 */
const IBAN = /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}(?![A-Z0-9])/g;
const ibans = (cell: string): string[] =>
  (cell.normalize("NFKC").toUpperCase().match(IBAN) ?? [])
    // A word printed after the IBAN («UA… 4821 EUR») is not part of it: a final group of letters only is dropped.
    .map((m) => m.replace(/[ -][A-Z]+$/, "").replace(/[ -]/g, ""))
    .filter((m) => m.length >= 15 && m.length <= 34);
/** Digits grouped by spaces or hyphens, as account numbers are printed. */
const NUMBER = /\d[\d -]*\d/g;
/** A run of digits and mask marks; a masked card is cut from it by `maskedIn` (one pass: the file is untrusted). */
const MASK_RUN = /[\d*xX•]+/g;
const MASK_MARK = /[*xX•]/;

/**
 * Masked cards of a cell: in each run, the longest start with at least one mark and four digits at its end. The scan
 * is linear in the cell's length (a single pattern with three unbounded parts took cubic time on a run of marks).
 */
function maskedIn(cell: string): string[] {
  const found: string[] = [];
  for (const run of cell.match(MASK_RUN) ?? []) {
    const mark = run.search(MASK_MARK);
    if (mark < 0) continue;
    // The last place where four digits in a row end, with the first mark before them.
    let digitsInRow = 0;
    let end = -1;
    for (let i = 0; i < run.length; i++) {
      const c = run.charCodeAt(i);
      digitsInRow = c >= 48 && c <= 57 ? digitsInRow + 1 : 0;
      if (digitsInRow >= 4 && i - 3 > mark) end = i + 1;
    }
    if (end > 0) found.push(run.slice(0, end));
  }
  return found;
}

const compact = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(/[\s-]+/g, "")
    .toUpperCase();
const digits = (text: string): string => text.replace(/\D/g, "");

/** The visible digits of two masks agree wherever both show one, aligned at the end; the last four are digits. */
function sameMask(a: string, b: string): boolean {
  if (!/\d{4}$/.test(a) || !/\d{4}$/.test(b)) return false;
  for (let i = 1; i <= Math.min(a.length, b.length); i++) {
    const x = a[a.length - i]!;
    const y = b[b.length - i]!;
    if (/\d/.test(x) && /\d/.test(y) && x !== y) return false;
  }
  return true;
}

function status(matched: boolean, other: boolean): AccountMatch["status"] {
  return matched ? "match" : other ? "mismatch" : "not-found";
}

export function matchAccount(
  preamble: readonly (readonly string[])[],
  by: AccountBindingKind,
  value: string,
): AccountMatch {
  const cells = preamble.flat().map(compact);
  const want = compact(value);
  if (by === "iban") {
    // An IBAN is printed in groups of four: the cell is compared without its spaces. Another IBAN-shaped value in the
    // preamble is another account.
    const matched = want.length >= 15 && cells.some((c) => c.includes(want));
    return {
      by,
      status: status(
        matched,
        preamble.flat().some((c) => ibans(c).length > 0),
      ),
    };
  }
  if (by === "account-number") {
    // Numbers of an account cannot be told from other long numbers of a preamble (a tax code, a contract): only `match`
    // or `not-found`. A Ukrainian IBAN holds the account number at its end, so an IBAN ending with it matches too.
    const number = digits(value);
    const matched =
      number.length >= 6 &&
      preamble.flat().some((cell) => {
        if (ibans(cell).some((iban) => digits(iban).endsWith(number))) return true;
        // A run of groups may hold more than the number («2600 1234 5678 980»): any whole groups in a row that spell
        // it. Each start stops once its groups are longer than the number, so the scan stays linear in the cell.
        return (cell.normalize("NFKC").match(NUMBER) ?? []).some((run) => {
          const groups = run.split(/[ -]+/);
          for (let i = 0; i < groups.length; i++) {
            let spelled = "";
            for (let j = i; j < groups.length && spelled.length < number.length; j++) spelled += groups[j];
            if (spelled === number) return true;
          }
          return false;
        });
      });
    return { by, status: status(matched, false) };
  }
  const masks = cells.flatMap(maskedIn);
  return {
    by,
    status: status(
      masks.some((m) => sameMask(m, want)),
      masks.length > 0,
    ),
  };
}

/** The last 4 characters behind an ellipsis: the only form of an IBAN or a card number that leaves the worker. */
export const maskLast4 = (value: string): string => `…${value.slice(-4)}`;

/**
 * The masked reason of a `mismatch` (IMP-05@PoC FR 4: «IBAN …4821 у файлі, …1190 у рахунку»): the last 4 characters
 * of the file's value and of the account's, never more (the business rule of IMP-05: masked, the last 4). Null when
 * the outcome is not a mismatch. `matchAccount` itself still holds the outcome only.
 */
export function maskedMismatch(
  preamble: readonly (readonly string[])[],
  by: AccountBindingKind,
  value: string,
): { readonly file: string; readonly account: string } | null {
  if (matchAccount(preamble, by, value).status !== "mismatch") return null;
  const want = compact(value);
  const found =
    by === "iban" ? preamble.flat().flatMap(ibans) : preamble.flat().map(compact).flatMap(maskedIn);
  const other = found.find((f) => (by === "iban" ? f !== want : !sameMask(f, want)));
  return other === undefined ? null : { file: maskLast4(other), account: maskLast4(want) };
}

/** Whether the rows before the table show a masked card (a card feature of IMP-05@PoC FR 5, FR 6). */
export const hasCardMask = (preamble: readonly (readonly string[])[]): boolean =>
  preamble
    .flat()
    .map(compact)
    .some((cell) => maskedIn(cell).length > 0);

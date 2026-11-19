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

/** An IBAN-shaped value, as `ibanCountry` finds one: two letters, two digits, 11–30 letters or digits. */
const IBAN = /(?:^|[^A-Z0-9])([A-Z]{2}\d{2}[A-Z0-9]{11,30})(?![A-Z0-9])/;
/** Digits grouped by spaces or hyphens, as account numbers are printed. */
const NUMBER = /\d[\d -]*\d/g;
/** A masked card: digits and mask marks, at least one mark and four digits at the end. */
const MASKED = /[\d*xX•]*[*xX•][\d*xX•]*\d{4}/g;

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
        cells.some((c) => IBAN.test(c)),
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
        const iban = IBAN.exec(compact(cell))?.[1];
        if (iban && digits(iban).endsWith(number)) return true;
        return (cell.normalize("NFKC").match(NUMBER) ?? []).some((n) => digits(n) === number);
      });
    return { by, status: status(matched, false) };
  }
  const masks = cells.flatMap((c) => c.match(MASKED) ?? []);
  return {
    by,
    status: status(
      masks.some((m) => sameMask(m, want)),
      masks.length > 0,
    ),
  };
}

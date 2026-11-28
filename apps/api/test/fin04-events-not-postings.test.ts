import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "../../../packages/i18n/src/messages/en.ts";
import { uk } from "../../../packages/i18n/src/messages/uk.ts";

/**
 * FIN-04@PoC FR 8: the user sees events and transactions, never debit and credit. The journal's double entry stays
 * inside module ledger: no API answer carries an entry, a posting, its side or its journal account (the committed
 * contract is the one the routes generate and real answers match it — test/contract.test.ts), and no text of the
 * product (uk, en) names a debit or a credit side. A statement file's own «Debit» / «Credit» columns (the column
 * roles of an import recipe, IMP-06) describe the bank's file, not the journal, and stay.
 */
const contract = JSON.parse(
  readFileSync(new URL("../../../packages/api-contract/openapi.json", import.meta.url), "utf8"),
) as { paths: Record<string, unknown> };

/** Property names that would show the journal's mechanics to the client. */
const JOURNAL_FIELD =
  /^(debit|debits|credits|debitAmount|creditAmount|posting|postings|entry|entries|entryId|ledgerAccountId|journalAccountId)$/i;
/** Enum values that would name a side of an entry (a transfer's `side` is «outflow» / «inflow» — money out and in). */
const SIDE_VALUE = /^(debit|credit-side|dr|cr)$/i;

/** The statement column roles of an import recipe: the bank file's own column names (IMP-06), not the journal. */
const isFileColumnRole = (trail: readonly string[]) =>
  trail[0]?.startsWith("/v1/import/") === true && trail.at(-1) === "role";
/** The sign basis of a statement row (where the file puts the sign: a «Debit»/«Credit» column pair). */
const isFileSignBasis = (trail: readonly string[]) =>
  trail[0]?.startsWith("/v1/import/") === true && trail.at(-1) === "basis";

function journalLeaks(): string[] {
  const found: string[] = [];
  const walk = (node: unknown, trail: readonly string[]) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, trail);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") {
      for (const name of Object.keys(record.properties)) {
        if (JOURNAL_FIELD.test(name)) found.push(`${trail[0]} ${trail[1] ?? ""} property «${name}»`);
      }
    }
    if (Array.isArray(record.enum) && !isFileColumnRole(trail) && !isFileSignBasis(trail)) {
      for (const value of record.enum) {
        if (typeof value === "string" && (SIDE_VALUE.test(value) || /debit/i.test(value))) {
          found.push(`${trail[0]} ${trail[1] ?? ""} value «${value}» at ${trail.slice(-3).join("/")}`);
        }
      }
    }
    for (const [key, value] of Object.entries(record)) walk(value, [...trail, key]);
  };
  for (const [path, operations] of Object.entries(contract.paths)) walk(operations, [path]);
  return found;
}

describe("FIN-04@PoC FR 8: events and transactions, not debit and credit", () => {
  it("FIN-04@PoC FR 8: no API answer or request carries a journal entry, a posting, its side or its journal account, and no uk or en text names a debit or a credit side", () => {
    // The contract has the money the user sees — transactions with a signed amount, accounts with balances.
    const paths = Object.keys(contract.paths);
    expect(paths).toContain("/v1/transactions");
    expect(paths).toContain("/v1/accounts/{accountId}");
    expect(journalLeaks()).toEqual([]);

    // The texts: «Списання» / «Надходження» (money out, money in), never «дебет» / «кредит» as a side, nor
    // «Debits» / «Credits». «Кредит» the loan and «Credit card» are kinds of account, not sides.
    const side = /дебет|debit|\bcredits\b|кредит(ов)?а сторона|(^|[^а-яіїєґ])(дт|кт)([^а-яіїєґ]|$)/i;
    const offending = (messages: Readonly<Record<string, string>>) =>
      Object.entries(messages)
        .filter(([, text]) => side.test(text))
        .map(([key, text]) => `${key}: ${text}`);
    expect(offending(uk)).toEqual([]);
    expect(offending(en)).toEqual([]);
  });
});

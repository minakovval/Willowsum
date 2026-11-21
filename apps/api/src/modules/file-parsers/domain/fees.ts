import { Decimal } from "@willowsum/domain-kernel";
import type { StatementAnalysis } from "./analysis.ts";
import { checkControls } from "./checks.ts";
import type { StatementEvent, StatementEvents } from "./events.ts";
import type { DeclaredFigures } from "./figures.ts";

/**
 * IMP-02@PoC FR 5 (#698 owner report): whether a row's amount already includes its fee. monobank's «Сума в валюті
 * картки» is the card's movement with the fee in it (−21 840 = 412,50 EUR × rate + 840 fee); a bank may print the
 * operation without its fee instead (the reading of the 2026-11-19 decision). Decided for the whole file, from the
 * strongest evidence: the statement's balances (chain or opening + rows = closing) agree with the amounts as printed —
 * `included`; or only with the fees taken off — `excluded`. Where the balances break somewhere (neither reading
 * verifies), the unbroken links decide: the links of the rows with a fee hold under one reading and under no other.
 * Where they do not tell (no fee row on an unbroken link, or links holding under both), the basis is unknown: the rows
 * with a fee are flagged `fee-basis-unknown` and never written by a guess (#703 round 1, a fee taken off twice); only
 * where both readings verify (no break; the fee rows on no link) may the amount header still tell. A file without
 * balances is read by its amount header («Сума в валюті картки» — `included`) or else as `excluded`.
 * Null — no row has a fee. Pure.
 */
export type FeeBasis = "included" | "excluded";
export interface FeeReading {
  /** Null — the balances do not tell (the rows with a fee are flagged). */
  readonly basis: FeeBasis | null;
  readonly by: "balances" | "header" | "default";
}

const CARD_AMOUNT = /валют[іи] картки/;

/** The rows as the account moves under `excluded`: each fee taken off its amount. */
export function feesTaken(statement: StatementEvents): StatementEvents {
  return {
    ...statement,
    events: statement.events.map((e): StatementEvent => {
      const leg = e.legs[0];
      if (!e.fee || !leg || e.legs.length !== 1) return e;
      return { ...e, legs: [{ ...leg, amount: new Decimal(leg.amount).minus(e.fee.amount).toFixed() }] };
    }),
  };
}

const BALANCE_CHECKS = new Set(["balance-chain", "balance-equation"]);
/** What the balances say of the rows read one way: whether they verify, whether there are any, and the linked fee rows. */
function evidence(figures: DeclaredFigures, statement: StatementEvents, feeRows: ReadonlySet<number>) {
  const result = checkControls(figures, statement);
  const balances = result.checks.filter((c) => BALANCE_CHECKS.has(c.kind));
  return {
    verified: balances.some((c) => c.status === "verified"),
    checked: balances.some((c) => c.status !== "not-checked"),
    linked: [...feeRows].filter((row) => result.chainRows.has(row)).length,
  };
}

export function readFeeBasis(
  statement: StatementEvents,
  figures: DeclaredFigures,
  analysis: Pick<StatementAnalysis, "columns">,
): FeeReading | null {
  if (!statement.events.some((e) => e.fee !== null)) return null;
  const feeRows = new Set(statement.events.filter((e) => e.fee !== null).map((e) => e.row));
  const printed = evidence(figures, statement, feeRows);
  const taken = evidence(figures, feesTaken(statement), feeRows);
  if (printed.verified !== taken.verified)
    return { basis: printed.verified ? "included" : "excluded", by: "balances" };
  const amount = analysis.columns.find((c) => c.role.chosen.value === "amount");
  const cardHeader = !!amount?.header && CARD_AMOUNT.test(amount.header.toLowerCase());
  if (printed.checked || taken.checked) {
    // The balances are there and neither reading alone verifies: the unbroken links decide.
    if (printed.linked > 0 && taken.linked === 0) return { basis: "included", by: "balances" };
    if (taken.linked > 0 && printed.linked === 0) return { basis: "excluded", by: "balances" };
    // Both verify (the only fee rows sit where no link reaches): the header may still tell. A real break never guesses.
    if (printed.verified && cardHeader) return { basis: "included", by: "header" };
    return { basis: null, by: "balances" };
  }
  if (cardHeader) return { basis: "included", by: "header" };
  return { basis: "excluded", by: "default" };
}

/** Each row with a fee marked by the file's reading; with no reading, flagged `fee-basis-unknown`. */
export function withFeeBasis(statement: StatementEvents, reading: FeeReading | null): StatementEvents {
  if (reading === null) return statement;
  const basis = reading.basis;
  return {
    ...statement,
    events: statement.events.map((e): StatementEvent => {
      if (!e.fee) return e;
      if (basis === null)
        return e.flags.includes("fee-basis-unknown") ? e : { ...e, flags: [...e.flags, "fee-basis-unknown"] };
      return { ...e, feeIncluded: basis === "included" };
    }),
  };
}

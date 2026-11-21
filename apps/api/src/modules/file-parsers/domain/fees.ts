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
 * `included`; or only with the fees taken off — `excluded`; else an amount header that names the card's currency
 * («Сума в валюті картки») — `included`; else `excluded`. Null — no row has a fee. Pure.
 */
export type FeeBasis = "included" | "excluded";
export interface FeeReading {
  readonly basis: FeeBasis;
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

const agrees = (figures: DeclaredFigures, statement: StatementEvents): boolean =>
  checkControls(figures, statement).checks.some(
    (c) => (c.kind === "balance-chain" || c.kind === "balance-equation") && c.status === "verified",
  );

export function readFeeBasis(
  statement: StatementEvents,
  figures: DeclaredFigures,
  analysis: Pick<StatementAnalysis, "columns">,
): FeeReading | null {
  if (!statement.events.some((e) => e.fee !== null)) return null;
  const printed = agrees(figures, statement);
  const taken = agrees(figures, feesTaken(statement));
  if (printed !== taken) return { basis: printed ? "included" : "excluded", by: "balances" };
  const amount = analysis.columns.find((c) => c.role.chosen.value === "amount");
  if (amount?.header && CARD_AMOUNT.test(amount.header.toLowerCase()))
    return { basis: "included", by: "header" };
  return { basis: "excluded", by: "default" };
}

/** Each row with a fee marked by the file's reading. */
export function withFeeBasis(statement: StatementEvents, reading: FeeReading | null): StatementEvents {
  if (reading === null) return statement;
  return {
    ...statement,
    events: statement.events.map((e) => (e.fee ? { ...e, feeIncluded: reading.basis === "included" } : e)),
  };
}

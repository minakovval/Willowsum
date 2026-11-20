import { Decimal as KernelDecimal } from "@willowsum/domain-kernel";
import { checkControls } from "./checks.ts";
import type { StatementEvents } from "./events.ts";
import type { DeclaredFigures } from "./figures.ts";

/**
 * A credit card's printed debt (IMP-05@PoC FR 6; Рішення власника (2026-11-20), п. 6): on an account of kind
 * «кредитна картка» a positive printed balance is the debt. When every printed balance (the declared opening and
 * closing balances and the rows' balances) is zero or positive and one is positive, the statement is read in the debt
 * basis: its balances, opening and closing are inverted, and — when the chain needs it — the rows' amounts too
 * (a purchase printed «50,00» that raises the debt becomes −50,00). The basis is inverted only when the balance chain
 * confirms exactly one inverted reading (its chain «перевірено», no declared balance against it); otherwise nothing is inverted and the batch gets «знак картки»: the
 * statement's totals and its chain, read in the debt basis, confirm no sign. Exact decimals at the printed scale; never
 * rounded. Pure and deterministic.
 */
export type CardDebt =
  /** The chain confirmed the debt basis; `amounts` — the rows' amounts were inverted too (not only the balances). */
  | { readonly status: "inverted"; readonly amounts: boolean }
  /** A positive printed balance on a credit card the chain does not confirm: «знак картки». */
  | { readonly status: "unconfirmed" };

export interface CardDebtReading {
  readonly events: StatementEvents;
  readonly figures: DeclaredFigures;
  /** Null — the rule does not apply (not a credit card, or no positive printed balance, or a negative one). */
  readonly debt: CardDebt | null;
}

/** As in the checks: a 64-character cell with 18 decimals is exact. */
const Decimal = KernelDecimal.clone({ precision: 120 });

const scaleOf = (text: string): number => (text.includes(".") ? text.length - text.indexOf(".") - 1 : 0);

/** The printed decimal negated at its printed scale; a zero carries no sign (`toFixed` drops it). */
const negate = (text: string): string => new Decimal(text).neg().toFixed(scaleOf(text));

function inverted(events: StatementEvents, figures: DeclaredFigures, amounts: boolean) {
  return {
    events: {
      ...events,
      events: events.events.map((e) => ({
        ...e,
        balance: e.balance === null ? null : negate(e.balance),
        legs: amounts ? e.legs.map((l) => ({ ...l, amount: negate(l.amount) })) : e.legs,
      })),
    },
    figures: {
      ...figures,
      opening: figures.opening === null ? null : negate(figures.opening),
      closing: figures.closing === null ? null : negate(figures.closing),
    },
  };
}

export function readCardDebt(
  events: StatementEvents,
  figures: DeclaredFigures,
  kind: string | undefined,
): CardDebtReading {
  const none: CardDebtReading = { events, figures, debt: null };
  if (kind !== "credit-card") return none;
  const balances = [figures.opening, figures.closing, ...events.events.map((e) => e.balance)]
    .filter((b): b is string => b !== null)
    .map((b) => new Decimal(b));
  if (
    !balances.some((b) => b.isPositive() && !b.isZero()) ||
    balances.some((b) => b.isNegative() && !b.isZero())
  )
    return none;
  // Both readings are tried: a card that prints a purchase negative and the debt positive keeps its amounts, one
  // that prints it positive has them inverted too. Exactly one must hold — the chain «перевірено» and neither end
  // against a declared balance — or the chain confirms nothing (rows of zero, a chain the two readings both satisfy).
  const confirmed = [false, true].flatMap((amounts) => {
    const candidate = inverted(events, figures, amounts);
    const checks = checkControls(candidate.figures, candidate.events).checks;
    const of = (kind: string) => checks.find((c) => c.kind === kind)!.status;
    return of("balance-chain") === "verified" &&
      of("opening-balance") !== "mismatch" &&
      of("closing-balance") !== "mismatch"
      ? [{ ...candidate, debt: { status: "inverted", amounts } as const }]
      : [];
  });
  if (confirmed.length === 1) return confirmed[0]!;
  return { events, figures, debt: { status: "unconfirmed" } };
}

import { Decimal as KernelDecimal } from "@willowsum/domain-kernel";
import { checkControls } from "./checks.ts";
import type { StatementEvents } from "./events.ts";
import type { DeclaredFigures } from "./figures.ts";

/**
 * A credit card's printed debt (IMP-05@PoC FR 6; Рішення власника (2026-11-20), п. 6): on an account of kind
 * «кредитна картка» a positive printed balance is the debt. When every printed balance (the declared opening and
 * closing balances and the rows' balances) is zero or positive and one is positive, the statement may be read in the
 * debt basis: its balances, opening and closing are inverted, the rows' amounts never. That reading is taken only when
 * the balance chain confirms it (its chain «перевірено», no declared balance against it) and the chain does not hold as
 * printed too. A reading that would invert the rows' amounts as well is never confirmed: its chain is the printed chain
 * negated, so it holds whenever the printed one does and tells a debt printed positive from the ordinary basis no
 * better (Рішення ведучого (2026-11-20; власник не схвалював; #643), рецензія безпеки 5988616888). Otherwise nothing is
 * inverted and the batch gets «знак картки»: the statement's totals and its chain confirm no sign. Exact decimals at
 * the printed scale; never rounded. Pure and deterministic.
 */
export type CardDebt =
  /** The chain confirmed the debt basis: the balances, the opening and the closing were inverted; the amounts kept. */
  | { readonly status: "inverted" }
  /** A positive printed balance on a credit card the chain does not confirm as debt: «знак картки». */
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

/** The debt basis: the balances, the opening and the closing negated; the rows' amounts as printed. */
function inverted(events: StatementEvents, figures: DeclaredFigures) {
  return {
    events: {
      ...events,
      events: events.events.map((e) => ({
        ...e,
        balance: e.balance === null ? null : negate(e.balance),
      })),
    },
    figures: {
      ...figures,
      opening: figures.opening === null ? null : negate(figures.opening),
      closing: figures.closing === null ? null : negate(figures.closing),
    },
  };
}

/** The chain of a reading is «перевірено» and neither end is against a declared balance. */
function fits(reading: { events: StatementEvents; figures: DeclaredFigures }): boolean {
  const checks = checkControls(reading.figures, reading.events).checks;
  const of = (kind: string) => checks.find((c) => c.kind === kind)!.status;
  return (
    of("balance-chain") === "verified" &&
    of("opening-balance") !== "mismatch" &&
    of("closing-balance") !== "mismatch"
  );
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
  // A card that prints a purchase negative and the debt positive: only its balances are inverted. A reading with the
  // amounts inverted too is the printed chain negated, so it fits exactly when the printed reading does: then (rows of
  // zero, a purchase printed positive, or the ordinary basis with a positive balance) the chain does not tell the debt
  // basis, and nothing is inverted.
  const debt = inverted(events, figures);
  if (fits(debt) && !fits({ events, figures })) return { ...debt, debt: { status: "inverted" } };
  return { events, figures, debt: { status: "unconfirmed" } };
}

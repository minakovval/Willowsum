import { logEvent } from "../../../platform/telemetry/signals.ts";
import type { IntegrityCheck } from "../application/index.ts";

/**
 * A failed integrity check in the server log (FIN-04 FR 10, AC7): an event of level «error» with the check and the
 * number of entries only — no amounts, accounts, spaces or other data of a space.
 */
export function logIntegrityViolation(check: IntegrityCheck, entries: number): void {
  logEvent("ledger.integrity_violation", "error", {
    "ws.module": "ledger",
    "ws.job.name": "ledger.integrity-check",
    "ws.ledger.check": check,
    "ws.ledger.entries": entries,
  });
}

/**
 * Spaces whose integrity check could not run (FIN-04 FR 9): an «error» event with their number only; the check of
 * the other spaces still runs and reports.
 */
export function logIntegrityCheckFailed(spaces: number): void {
  logEvent("ledger.integrity_check_failed", "error", {
    "ws.module": "ledger",
    "ws.job.name": "ledger.integrity-check",
    "ws.ledger.spaces": spaces,
  });
}

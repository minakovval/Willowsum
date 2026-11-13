import { logEvent } from "../../../platform/telemetry/signals.ts";
import type { IntegrityAlertEvent, IntegrityCheck } from "../application/index.ts";

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

/**
 * The alert letter of a discrepancy period (owner decision 2026-11-12): sent («info»), not sent («error», the error
 * class only; the next daily run tries again), its claim not given back after a failed send («error», the error
 * class only; no retry until the findings change or a clean run) or not possible without a recipient («error»).
 * Never the address.
 */
export function logIntegrityAlertEvent(event: IntegrityAlertEvent): void {
  const attributes = { "ws.module": "ledger", "ws.job.name": "ledger.integrity-check" };
  if (event.kind === "alert-sent") logEvent("ledger.integrity_alert_sent", "info", attributes);
  else if (event.kind === "alert-failed")
    logEvent("ledger.integrity_alert_failed", "error", { ...attributes, "error.type": event.errorClass });
  else if (event.kind === "release-failed")
    logEvent("ledger.integrity_alert_release_failed", "error", {
      ...attributes,
      "error.type": event.errorClass,
    });
  else logEvent("alerts.recipient_missing", "error", attributes);
}

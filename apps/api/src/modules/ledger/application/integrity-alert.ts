import { INTEGRITY_CHECKS, type IntegrityCheck, type IntegrityFindings } from "./journal.ts";

/**
 * The letter to the product owner when the daily integrity check finds a discrepancy (FIN-04 FR 10, AC6; ARC-11
 * «Перевірки цілісності»; owner decision 2026-11-12: PoC alerts are letters from the app, sent through its mail
 * adapter). One letter per discrepancy period: a period is a run of daily checks with the same findings (kinds and
 * counts); it ends with a clean run or when the findings change. The claim is kept in the module's own append-only
 * table, so a restart or a second scheduler sends no second letter, and it is given back when the letter could not
 * be sent.
 */

/** The claims of discrepancy periods (`ledger.integrity_alerts`): platform data, no space, no amounts. */
export interface IntegrityAlertStore {
  /** Claims the letter of `period`; true for the first claim only. Ends every other period (findings changed). */
  claim(period: string, at: number): Promise<boolean>;
  /** Gives the claim back when the letter could not be sent, so the next run sends it. */
  release(period: string, at: number): Promise<void>;
  /** A clean run: the period is over, so the same discrepancy later is news again. */
  endPeriod(at: number): Promise<void>;
}

/** What the letter says: the kinds and counts of findings and how many spaces could not be checked. */
export interface IntegrityAlertSummary {
  readonly findings: IntegrityFindings;
  readonly failedSpaces: number;
}

/** Sends the letter to the product owner (the app's mail adapter). */
export type IntegrityAlert = (summary: IntegrityAlertSummary) => Promise<void>;

/** What the alert step reports; the scheduler writes it to the server log. */
export type IntegrityAlertEvent =
  | { readonly kind: "alert-sent" }
  /** The letter, its claim or the end of a period failed; the next daily run tries again. */
  | { readonly kind: "alert-failed"; readonly errorClass: string }
  /**
   * The claim of a letter that was not sent could not be given back: no letter for this period until the findings
   * change or a clean run ends it. Reported so the owner sees why no retry came.
   */
  | { readonly kind: "release-failed"; readonly errorClass: string }
  /** A discrepancy, but no recipient configured (`WS_ALERT_EMAIL`): an «error» event instead of the letter. */
  | { readonly kind: "recipient-missing" };

export interface IntegrityAlertDeps {
  readonly store: IntegrityAlertStore;
  readonly clock: { now(): number };
  readonly report: (event: IntegrityAlertEvent) => void;
  /** Without it (no recipient configured) only the log events remain. */
  readonly alert?: IntegrityAlert;
}

/** The period of a set of findings: kinds and counts in the fixed order of the checks — no ids, no amounts. */
export function integrityPeriodKey(findings: IntegrityFindings): string {
  return INTEGRITY_CHECKS.map((check) => `${check}=${findings[check]}`).join(";");
}

const CHECK_TITLES: Record<IntegrityCheck, string> = {
  "unbalanced-entry": "Незбалансований запис",
  "empty-entry": "Запис без проводок",
  "reversal-mismatch": "Сторно не збігається з початковим записом",
  "balance-cache": "Рахунки, кеш залишків яких не дорівнює сумі проводок",
};

/** The text of the letter: fixed words and counts only (no amounts, accounts, spaces, entries or persons). */
export function integrityAlertMessage(summary: IntegrityAlertSummary): { subject: string; text: string } {
  const lines = INTEGRITY_CHECKS.filter((check) => summary.findings[check] > 0).map(
    (check) => `${CHECK_TITLES[check]}: ${summary.findings[check]}.`,
  );
  return {
    subject: "Willowsum: перевірка цілісності журналу знайшла розбіжність",
    text: [
      "Щоденна перевірка цілісності журналу проводок знайшла порушення (кількість записів, для кешу залишків — рахунків, за видом перевірки):",
      ...lines,
      ...(summary.failedSpaces > 0 ? [`Просторів, які не вдалося перевірити: ${summary.failedSpaces}.`] : []),
      "Подробиці — подія ledger.integrity_violation у журналі сервера.",
      "Наступний такий лист прийде лише тоді, коли знахідки зміняться або після перевірки без порушень.",
    ].join("\n"),
  };
}

const classOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name || error.name : typeof error;

const hasFindings = (findings: IntegrityFindings) => INTEGRITY_CHECKS.some((check) => findings[check] > 0);

/**
 * After a daily run: a discrepancy sends the one letter of its period; a clean run (nothing found and every space
 * checked) ends the period. Never throws: a failure here never fails the check, it is reported instead.
 */
export async function alertIntegrityFindings(
  deps: IntegrityAlertDeps,
  findings: IntegrityFindings,
  failedSpaces: number,
): Promise<void> {
  if (!hasFindings(findings)) {
    // Spaces that could not be checked may still hold the discrepancy: the period goes on.
    if (failedSpaces > 0) return;
    try {
      await deps.store.endPeriod(deps.clock.now());
    } catch (error) {
      deps.report({ kind: "alert-failed", errorClass: classOf(error) });
    }
    return;
  }
  if (!deps.alert) {
    deps.report({ kind: "recipient-missing" });
    return;
  }
  const period = integrityPeriodKey(findings);
  try {
    if (!(await deps.store.claim(period, deps.clock.now()))) return;
  } catch (error) {
    deps.report({ kind: "alert-failed", errorClass: classOf(error) });
    return;
  }
  try {
    await deps.alert({ findings, failedSpaces });
    deps.report({ kind: "alert-sent" });
  } catch (error) {
    deps.report({ kind: "alert-failed", errorClass: classOf(error) });
    try {
      await deps.store.release(period, deps.clock.now());
    } catch (releaseError) {
      deps.report({ kind: "release-failed", errorClass: classOf(releaseError) });
    }
  }
}

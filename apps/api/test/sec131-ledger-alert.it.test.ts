import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseIntegrityAlertStore, logIntegrityAlertEvent } from "../src/modules/ledger/adapters/index.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Review of PR #131 (FIN-04@PoC FR 10, AC7, EC4), follow-ups 1 and 2: the claim of a discrepancy period on a real
 * PostgreSQL under concurrent check instances (kills: `claim` ignoring `ON CONFLICT DO NOTHING`), and the «error»
 * event when the claim of an unsent letter cannot be given back.
 */
const telemetry = testTelemetryForFile();

let db: RealModulesDatabase;
beforeAll(async () => {
  db = await setupRealModules(8);
});
afterAll(async () => {
  await db?.close();
});
const NOW = Date.UTC(2026, 10, 12, 3, 17, 0, 0);

describe("sec131 — one letter per period under concurrent claims", () => {
  it("FIN-04@PoC AC7: of concurrent claims of the same period exactly one wins; a release lets exactly one claim in again", async () => {
    const store = databaseIntegrityAlertStore(db.databases.for("ledger"));
    await store.endPeriod(NOW);
    const period = "unbalanced-entry=0;empty-entry=7;reversal-mismatch=0";
    for (let round = 0; round < 5; round++) {
      const wins = (await Promise.all(Array.from({ length: 8 }, () => store.claim(period, NOW)))).filter(
        Boolean,
      );
      expect(wins).toHaveLength(1);
      expect(await store.claim(period, NOW)).toBe(false);
      await store.release(period, NOW);
    }
  });
});

describe("sec131 — a claim that cannot be given back is logged, not swallowed", () => {
  it("FIN-04@PoC EC4: release-failed is an «error» event ledger.integrity_alert_release_failed with the error class only", async () => {
    logIntegrityAlertEvent({ kind: "release-failed", errorClass: "RangeError" });
    const logged = await exportedText(telemetry);
    expect(logged).toContain("ledger.integrity_alert_release_failed");
    expect(logged).toContain('"severity":"ERROR"');
    expect(logged).toContain('"error.type":"RangeError"');
  });
});

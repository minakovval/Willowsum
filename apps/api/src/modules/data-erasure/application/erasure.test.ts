import { describe, expect, it } from "vitest";
import type { ErasureRecord } from "../domain/index.ts";
import { runErasure, type ErasureDeps } from "./erasure.ts";

const HOUSEHOLD = "00000000-0000-4000-8000-0000000000aa";
const ACCOUNT = "00000000-0000-4000-8000-0000000000bb";
const NOW = Date.parse("2026-11-16T10:00:00Z");

/** Fake ports that record every call in order, so the order of the steps can be pinned. */
function fakeDeps(calls: string[]): ErasureDeps {
  const records: ErasureRecord[] = [
    {
      kind: "requested",
      requestId: "00000000-0000-4000-8000-0000000000cc",
      accountId: ACCOUNT,
      householdIds: [HOUSEHOLD],
      at: new Date(NOW).toISOString(),
      dueAt: new Date(NOW + 86_400_000).toISOString(),
    },
  ];
  const erase = (name: string) => ({
    eraseHousehold: async () => void calls.push(name),
  });
  return {
    log: { append: async (r) => void records.push(r), records: async () => records },
    identity: { accountIdByEmail: async () => null, eraseAccount: async () => true },
    spaces: {
      spacesOf: async () => [{ householdId: HOUSEHOLD, members: 1 }],
      eraseSpace: async () => {
        calls.push("space");
        return { keyDestroyed: true };
      },
    },
    accounts: erase("accounts"),
    transactions: erase("transactions"),
    bulkActions: erase("bulk-actions"),
    categories: erase("categories"),
    categorization: erase("categorization"),
    merchants: erase("merchants"),
    goals: erase("goals"),
    recurring: erase("recurring"),
    debtPayoff: erase("debt-payoff"),
    liabilities: erase("liabilities"),
    ledger: erase("ledger"),
    audit: erase("audit"),
    platformAudit: {
      requestRecorded: async () => undefined,
      requestCompleted: async () => undefined,
      spaceStep: async (_h, step, reason = "erasure-request") => void calls.push(`step:${step}:${reason}`),
    },
    newId: () => "id",
    now: () => NOW,
  };
}

describe("NFR-12@PoC FR 3 (#296 no. 11, #306 no. 4): the queue consumers are swept after the last step", () => {
  it("NFR-12@PoC FR 3: after the space's key the consumers of the queues (categorization, goals, recurring) are erased once more, the log last", async () => {
    const calls: string[] = [];
    await runErasure(fakeDeps(calls), "00000000-0000-4000-8000-0000000000cc");
    const after = calls.slice(calls.indexOf("space") + 1);
    expect(after).toEqual([
      "step:categorization.records:erasure-sweep",
      "categorization",
      "step:goals.records:erasure-sweep",
      "goals",
      "step:recurring.records:erasure-sweep",
      "recurring",
      "step:audit.log:erasure-sweep",
      "audit",
    ]);
  });
});

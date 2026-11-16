import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * FIN-01@PoC EC4 (code review finding 3, 2026-11-16): the process passes the real transactions port to accounts, never
 * `[]`. `pendingPostings` is required by the type, but an explicit `[]` in main.ts would type-check and let an account
 * close while a transaction's hand-off to the journal is still queued; no test builds main.ts and closes an account, so
 * the wiring is checked by its text (as PR 292's `walletUsage`).
 */
describe("FIN-01@PoC EC4: main.ts wires the transactions' pending postings into accounts", () => {
  it("FIN-01@PoC EC4: createAccountsServices in main.ts gets createTransactionPendingPostings", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const call = main.slice(main.indexOf("createAccountsServices({"));
    // The object ends at the first line that closes it at the call's own indent: `            }),`.
    const args = call.slice(0, call.search(/\n {12}\}\),\n/));
    expect(args).toMatch(
      /pendingPostings:\s*\[\s*createTransactionPendingPostings\(databases\.for\("transactions"\),\s*\{\s*accounts: createAccountDirectory\(databases\.for\("accounts"\)\),\s*ledger: createLedger\(databases\.for\("ledger"\)\),\s*audit,\s*\}\),\s*\]/,
    );
  });
});

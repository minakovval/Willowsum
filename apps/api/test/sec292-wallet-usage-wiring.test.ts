import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * IMP-02@PoC FR 15 (PR 292 security, non-blocking): the process passes the real transactions port to accounts, never `[]`.
 * `walletUsage` is required by the type, but an explicit `[]` in main.ts would type-check and let a wallet with
 * transactions be removed; no test builds main.ts and removes a wallet, so the wiring is checked by its text.
 */
describe("PR 292 security: main.ts wires the transactions' wallet usage into accounts", () => {
  it("IMP-02@PoC FR 15: createAccountsServices in main.ts gets createTransactionWalletUsage", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const call = main.slice(main.indexOf("createAccountsServices({"));
    // The object ends at the first line that closes it at the call's own indent: `            }),`.
    const args = call.slice(0, call.search(/\n\s*\}\),\n/));
    expect(args).toMatch(
      /walletUsage:\s*\[\s*createTransactionWalletUsage\(databases\.for\("transactions"\)\)\s*\]/,
    );
  });
});

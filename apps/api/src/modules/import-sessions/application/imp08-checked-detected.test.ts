import { describe, expect, it } from "vitest";
import type { StatementChecks } from "../../file-parsers/index.ts";
import { checkedDetected } from "./parse.ts";

/**
 * IMP-08@PoC FR 2 (#711 confirmation; row 230b): what the parse step keeps of the worker's detected facts before it
 * matches the account and stores the checks (`checkedDetected`, which replaced #711's `withDirectoryBank` in #718). The
 * worker's answer is not trusted: the bank is kept only as `bankName` gives it, whether it is the directory's is decided
 * here against the directory the worker was given, and the worker's own match outcome is dropped. Synthetic values.
 */
const base = { account: { reasons: [] }, flags: [] } as unknown as StatementChecks;
const directory = [{ name: "ПУМБ", legalName: "АТ «ПУМБ»" }, { name: "Універсал Банк (monobank)" }];
const of = (detected: unknown) => ({ ...base, detected }) as unknown as StatementChecks;

describe("IMP-08@PoC FR 2: the detected facts the parse step keeps (checkedDetected)", () => {
  it("IMP-08@PoC FR 2: a directory name is marked as the directory's, whatever the worker said", () => {
    expect(checkedDetected(of({ bank: "ПУМБ", bankInDirectory: false }), directory)).toEqual({
      bank: "ПУМБ",
      bankInDirectory: true,
    });
  });

  it("IMP-08@PoC FR 2 (row 230b): a printed bank outside the directory is kept and marked so, even if the worker said it is in", () => {
    expect(checkedDetected(of({ bank: "Revolut Bank UAB", bankInDirectory: true }), directory)).toEqual({
      bank: "Revolut Bank UAB",
      bankInDirectory: false,
    });
    // An empty directory (none given to the worker): nothing is the directory's.
    expect(checkedDetected(of({ bank: "ПУМБ" }), [])).toEqual({ bank: "ПУМБ", bankInDirectory: false });
  });

  it("IMP-08@PoC FR 2: a bank with a long digit run is dropped with its mark; currency and mask pass; the worker's match is dropped", () => {
    const run = ["4149", "4999", "1234"].join("");
    const out = checkedDetected(
      of({
        bank: `Revolut ${run}`,
        bankInDirectory: true,
        currency: "EUR",
        mask: "…5678",
        accountMatch: "picked",
      }),
      directory,
    );
    expect(out).toEqual({ currency: "EUR", mask: "…5678" });
    expect(JSON.stringify(out)).not.toContain(run.slice(0, 8));
  });

  it("IMP-08@PoC FR 2: no detected facts — nothing", () => {
    expect(checkedDetected(base, directory)).toEqual({});
  });
});

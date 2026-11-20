import { describe, expect, it } from "vitest";
import { isolatedStatementParser } from "./run.ts";

/**
 * Security review of #639 (#624): the account opener taken for a parse is wiped on every path where its key was not
 * moved into the worker — here the copy of the file fails before any worker starts.
 */
describe("ARC-06@PoC FR 2: the opener's key does not outlive a parse that never reached its worker", () => {
  it("ARC-06@PoC FR 2: the file cannot be copied — the parse fails and the key taken for it is zeroed", async () => {
    const key = new ArrayBuffer(32);
    new Uint8Array(key).fill(7);
    const parser = isolatedStatementParser({ concurrent: 1 });
    await expect(
      parser.parse(Symbol("not bytes") as unknown as Uint8Array, {}, {}, async () => ({
        by: "iban",
        sealedValue: "ws1.x",
        opener: { householdId: "h", field: "importRecipes.accountValue", key },
      })),
    ).rejects.toThrow();
    expect(key.byteLength).toBe(32);
    expect([...new Uint8Array(key)].every((b) => b === 0)).toBe(true);
  });
});

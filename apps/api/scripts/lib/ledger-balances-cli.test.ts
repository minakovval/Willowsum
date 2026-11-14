import { describe, expect, it } from "vitest";
import { parseLedgerBalancesCommand } from "./ledger-balances-cli.ts";

const space = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";
const account = "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07";

describe("ARC-11: scripts/ledger-balances.ts — the rebuild command of the daily balance cache", () => {
  it("ARC-11 criterion «Перебудова кешу залишків з проводок»: rebuild of a space or of one account", () => {
    expect(parseLedgerBalancesCommand(["rebuild", space])).toEqual({ kind: "rebuild", householdId: space });
    expect(parseLedgerBalancesCommand(["rebuild", space, account])).toEqual({
      kind: "rebuild",
      householdId: space,
      accountId: account,
    });
  });

  it("refuses unknown commands, missing or malformed ids and extra arguments", () => {
    expect(() => parseLedgerBalancesCommand([])).toThrow(/unknown command/);
    expect(() => parseLedgerBalancesCommand(["drop", space])).toThrow(/unknown command/);
    expect(() => parseLedgerBalancesCommand(["rebuild"])).toThrow(/space UUID/);
    expect(() => parseLedgerBalancesCommand(["rebuild", "home"])).toThrow(/UUIDs/);
    expect(() => parseLedgerBalancesCommand(["rebuild", space, "cash"])).toThrow(/UUIDs/);
    expect(() => parseLedgerBalancesCommand(["rebuild", space, account, account])).toThrow(/too many/);
  });
});

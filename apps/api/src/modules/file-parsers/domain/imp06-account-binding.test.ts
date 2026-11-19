import { describe, expect, it } from "vitest";
import { matchAccount } from "./account.ts";

/**
 * IMP-06@PoC FR 1 «прив'язка до рахунку» (wave 2 row 41 part 3): the recipe's account value, opened in the parse
 * worker, is looked for in the rows before the table. Values are synthetic, built at runtime (no bank has them).
 */
const IBAN = ["UA", "00", "000000", "0000000", "123456", "987654"].join("");
const OTHER = ["UA", "00", "000000", "0000000", "654321", "456789"].join("");
const grouped = (iban: string): string => iban.replace(/(.{4})/g, "$1 ").trim();

describe("IMP-06@PoC FR 1: the statement is bound to the recipe's account", () => {
  it("IMP-06@PoC FR 1: an IBAN printed in groups of four in the preamble matches the recipe's IBAN", () => {
    const preamble = [["Виписка"], [`IBAN: ${grouped(IBAN)}`, "EUR"]];
    expect(matchAccount(preamble, "iban", IBAN)).toEqual({ by: "iban", status: "match" });
    expect(matchAccount(preamble, "iban", grouped(IBAN).toLowerCase())).toEqual({
      by: "iban",
      status: "match",
    });
  });

  it("IMP-06@PoC FR 1: another IBAN in the preamble is a mismatch; none at all is not-found", () => {
    expect(matchAccount([[`Рахунок ${OTHER}`]], "iban", IBAN).status).toBe("mismatch");
    expect(matchAccount([["Виписка за березень"]], "iban", IBAN).status).toBe("not-found");
    expect(matchAccount([], "iban", IBAN).status).toBe("not-found");
  });

  it("IMP-06@PoC FR 1: an account number matches as printed with spaces or hyphens, or as the end of the IBAN", () => {
    expect(matchAccount([["Рахунок: 2600-1234-5678"]], "account-number", "260012345678").status).toBe(
      "match",
    );
    expect(matchAccount([[grouped(IBAN)]], "account-number", "123456987654").status).toBe("match");
    // Another long number of the preamble cannot be told from an account: never «mismatch».
    expect(matchAccount([["ЄДРПОУ 12345678"]], "account-number", "260012345678").status).toBe("not-found");
    // A number shorter than 6 digits never matches part of another one.
    expect(matchAccount([["Рахунок 2600"]], "account-number", "2600").status).toBe("not-found");
  });

  it("IMP-06@PoC FR 1: an IBAN after a label and a space is still found: another one is a mismatch, its end is the account number", () => {
    expect(matchAccount([[`IBAN ${OTHER}`]], "iban", IBAN).status).toBe("mismatch");
    expect(matchAccount([[`Account ${grouped(OTHER)} EUR`]], "iban", IBAN).status).toBe("mismatch");
    expect(matchAccount([[`IBAN ${grouped(IBAN)}`]], "iban", IBAN).status).toBe("match");
    expect(matchAccount([[`IBAN ${IBAN}`]], "account-number", "123456987654").status).toBe("match");
    expect(matchAccount([[`IBAN ${grouped(IBAN)} UAH`]], "account-number", "123456987654").status).toBe(
      "match",
    );
  });

  it("IMP-06@PoC FR 1: an account number followed by another number in the same cell still matches", () => {
    expect(matchAccount([["Рахунок 260012345678 980"]], "account-number", "260012345678").status).toBe(
      "match",
    );
    expect(
      matchAccount([["Рахунок 2600 1234 5678 01-11-2026"]], "account-number", "260012345678").status,
    ).toBe("match");
    expect(matchAccount([["Договір 1260012345678 980"]], "account-number", "260012345678").status).toBe(
      "not-found",
    );
  });

  it("IMP-06@PoC FR 1: a card mask matches a masked card whose shown digits agree", () => {
    expect(matchAccount([["Картка 5168 **** **** 1234"]], "mask", "**** 1234").status).toBe("match");
    expect(matchAccount([["Card 5168XXXXXXXX1234"]], "mask", "5168 **** **** 1234").status).toBe("match");
    expect(matchAccount([["Картка 5168 **** **** 4321"]], "mask", "**** 1234").status).toBe("mismatch");
    expect(matchAccount([["Картка 4149 **** **** 1234"]], "mask", "5168 **** **** 1234").status).toBe(
      "mismatch",
    );
    expect(matchAccount([["Виписка"]], "mask", "**** 1234").status).toBe("not-found");
  });

  it("IMP-06@PoC FR 1: the outcome holds only the kind and the status, never the value or what the file holds", () => {
    const outcome = matchAccount([[`IBAN ${OTHER}`]], "iban", IBAN);
    expect(Object.keys(outcome).sort()).toEqual(["by", "status"]);
    expect(JSON.stringify(outcome)).not.toMatch(/\d{4}/);
  });
});

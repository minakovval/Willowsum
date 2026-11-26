import { describe, expect, it } from "vitest";
import type { StatementChecks } from "../../file-parsers/index.ts";
import { maskedChecks } from "./decisions.ts";

/**
 * IMP-05 business rule, #637 item 3, IMP-08@PoC FR 2 (security review of #711): the boundary keeps the detected facts
 * of a file masked whatever the parse worker gave — a number of a card or an IBAN never reaches the stored checks
 * through `detected.bank`, `detected.currency` or `detected.mask`. Synthetic values built at runtime.
 */
const IBAN = ["UA", "00", "0000", "0000", "0000", "0000", "0000", "1234", "5"].join("");
const base = { account: { reasons: [] }, flags: [] } as unknown as StatementChecks;

describe("SEC #711: detected facts at the import boundary", () => {
  it("IMP-08@PoC FR 2: a full IBAN given as the mask is kept as «…» and its last 4 characters", () => {
    expect(maskedChecks({ ...base, detected: { mask: IBAN } }).detected).toEqual({ mask: "…2345" });
  });

  it("IMP-08@PoC FR 2: a number given as the bank or as the currency is not kept", () => {
    const out = maskedChecks({
      ...base,
      detected: { bank: IBAN, currency: IBAN.slice(4, 14), mask: "…1234" },
    });
    expect(out.detected).toEqual({ mask: "…1234" });
    expect(JSON.stringify(out)).not.toContain(IBAN.slice(4, 12));
  });

  it("IMP-08@PoC FR 2: a directory name and a currency code pass unchanged", () => {
    const d = { bank: "БАНК 3/4", currency: "UAH", mask: "…1234" };
    expect(maskedChecks({ ...base, detected: d }).detected).toEqual(d);
  });

  it("IMP-08@PoC FR 2 (row 230b): a printed bank name with a long digit run never reaches the stored checks", () => {
    const out = maskedChecks({
      ...base,
      detected: { bank: `Revolut Bank ${IBAN.slice(4, 20)}`, bankInDirectory: false, mask: "…1234" },
    });
    expect(out.detected).toEqual({ mask: "…1234" });
    expect(JSON.stringify(out)).not.toContain(IBAN.slice(4, 12));
  });

  it("IMP-08@PoC FR 2 (row 230b): a printed bank passes with its mark; an unknown match outcome is dropped", () => {
    const out = maskedChecks({
      ...base,
      detected: {
        bank: "Revolut Bank UAB",
        bankInDirectory: false,
        accountMatch: "everything" as unknown as "none",
      },
    });
    expect(out.detected).toEqual({ bank: "Revolut Bank UAB", bankInDirectory: false });
    expect(
      maskedChecks({ ...base, detected: { bank: "Revolut Bank UAB", accountMatch: "none" } }).detected,
    ).toEqual({ bank: "Revolut Bank UAB", accountMatch: "none" });
  });
});

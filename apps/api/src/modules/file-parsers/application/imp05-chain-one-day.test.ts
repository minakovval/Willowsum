import { describe, expect, it } from "vitest";
import type { StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * IMP-05@PoC FR 1 (#703 round 1): rows of one day are put in the chain's order in time linear in the day's rows — a
 * file of 20 000 operations of one date (the table limit), printed newest first and with fees, reads well inside the
 * parse time limit, the chain verified. Synthetic amounts.
 */
const HEADER =
  '"Дата i час операції","Деталі операції",MCC,"Сума в валюті картки (UAH)","Сума в валюті операції",Валюта,Курс,"Сума комісій (UAH)","Сума кешбеку (UAH)","Залишок після операції"';
// The table limit counts the header row too.
const ROWS = 19_999;

function oneDay(): Uint8Array {
  const lines: string[] = [];
  let balance = 1_000_000_00; // in kopiyky
  for (let k = 0; k < ROWS; k++) {
    const fee = k % 10 === 0 ? 100 : 0;
    const amount = -(100 + (k % 7)) - fee;
    balance += amount;
    const money = (v: number) => (v / 100).toFixed(2);
    lines.push(
      `"16.11.2026 12:00:00","Синтетичний рядок ${k}",5411,${money(amount)},${money(amount + fee)},UAH,—,${fee ? money(fee) : "—"},—,${money(balance)}`,
    );
  }
  return new TextEncoder().encode([HEADER, ...lines.reverse()].join("\n") + "\n");
}

const UAH: StatementOptions = { account: { currencies: ["UAH"], multiCurrency: false } };

describe("IMP-05@PoC FR 1: the chain order of one day is linear", () => {
  it("IMP-05@PoC FR 1: 19 999 operations of one date, newest first, with fees — chain verified within 15 s", () => {
    const bytes = oneDay();
    const started = performance.now();
    const p = parseStatement(bytes, {}, UAH);
    const took = performance.now() - started;
    expect(p.checks.controls.find((c) => c.kind === "balance-chain")!.status).toBe("verified");
    expect(p.events.events.filter((e) => e.feeIncluded === true)).toHaveLength(Math.ceil(ROWS / 10));
    expect(took).toBeLessThan(15_000);
  }, 60_000);
});

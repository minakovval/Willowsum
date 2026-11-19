// Security review of #619: what the parse worker answers is copied into the API process, so it stays small whatever
// the file holds (ARC-06@PoC FR 4: the parse's memory is the worker's, not the API's).
import { describe, expect, it } from "vitest";
import { isolatedStatementParser, StatementParseError } from "./run.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const MIB = 1024 * 1024;

/** The size of the answer as JSON, or 0 for a refusal. */
async function answerSize(file: string, timeoutMs?: number): Promise<number> {
  const bytes = enc(file);
  expect(bytes.length).toBeLessThan(25 * MIB);
  try {
    return JSON.stringify(await isolatedStatementParser(timeoutMs ? { timeoutMs } : {}).parse(bytes)).length;
  } catch (error) {
    expect(error).toBeInstanceOf(StatementParseError);
    expect((error as StatementParseError).code).toBe("CORRUPTED");
    return 0;
  }
}

describe("ARC-06@PoC FR 4: the answer of the parse worker is bounded", () => {
  it("ARC-06@PoC FR 4: a 23 MiB file of 32 000-digit «numbers» does not come back as tens of MiB of readings", async () => {
    const digits = "9".repeat(32_000);
    const row = (d: string) => Array.from({ length: 250 }, () => d + digits).join(";");
    const header = Array.from({ length: 250 }, (_, i) => `h${i}`).join(";");
    expect(await answerSize([header, row("1"), row("2"), row("3")].join("\n"))).toBeLessThan(2 * MIB);
  }, 120_000);

  it("ARC-06@PoC FR 4: 32 000-character headers do not come back whole", async () => {
    const header = Array.from({ length: 250 }, (_, i) => `amount ${"x".repeat(32_000)} ${i}`).join(";");
    const row = Array.from({ length: 250 }, () => "1,50").join(";");
    expect(await answerSize([header, row, row].join("\n"))).toBeLessThan(2 * MIB);
  }, 120_000);

  it("IMP-06@PoC FR 3: cells of 32 000 spaces between digits are text, not seconds of pattern matching", async () => {
    const cell = `1${" ".repeat(32_000)}1x`;
    const row = Array.from({ length: 100 }, () => cell).join(";");
    const started = Date.now();
    await answerSize(["a;b", ...Array.from({ length: 7 }, () => row)].join("\n"), 20_000);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 60_000);

  it("IMP-06@PoC FR 8: an ordinary statement is still analysed (amounts and dates under the 64-character bound)", async () => {
    const parse = await isolatedStatementParser().parse(
      enc(["Дата;Сума;Опис", "01.03.2026;-1 234 567,89 грн;Кава", "02.03.2026;-5,00 грн;Хліб"].join("\n")),
    );
    expect(parse.analysis.columns.map((c) => c.role.chosen.value)).toEqual(["date", "amount", "description"]);
    expect(parse.analysis.columns[1]!.role.chosen.examples[0]!.reads).toBe("-1234567.89");
  });
});

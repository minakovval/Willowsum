import { describe, expect, it } from "vitest";
import { encodeSingleByte } from "../../domain/bytes.test-helper.ts";
import { isolatedStatementParser, PARSE_LIMITS, StatementParseError } from "./run.ts";

const fixture = (name: string) =>
  new URL(`../../../../../test/fixtures/file-storage/${name}`, import.meta.url);

const statement = [
  "Рахунок:;UA000000000000000000000000001",
  "Дата;Сума;Опис;Залишок",
  "01.03.2026;-120,50;Кава;1 000,00",
  "02.03.2026;-5,00;Хліб;995,00",
].join("\r\n");

describe("IMP-06@PoC: the statement is read and analysed in the isolated parse worker (#607 item 3)", () => {
  it("IMP-06@PoC FR 8: the worker gives the encoding, delimiter, dates, numbers, sign and roles with alternatives and evidence", async () => {
    const parse = await isolatedStatementParser().parse(encodeSingleByte(statement, "windows-1251"));
    expect(parse.reading.encoding.chosen.encoding).toBe("windows-1251");
    expect(parse.reading.encoding.alternatives.length).toBeGreaterThan(0);
    expect(parse.reading.delimiter.chosen.delimiter).toBe(";");
    expect(parse.reading.format!.fingerprint).toMatch(/^fp1:/);
    const { analysis } = parse;
    expect(analysis.table.headerRow).toBe(2);
    expect(analysis.dates!.alternatives.map((h) => h.value.order)).toContain("mdy");
    expect(analysis.numbers!.chosen.value.decimalSeparator).toBe(",");
    expect(analysis.sign!.chosen.value).toBe("as-printed");
    expect(analysis.columns.map((c) => c.role.chosen.value)).toEqual([
      "date",
      "amount",
      "description",
      "balance",
    ]);
    expect(analysis.columns[0]!.header).toBe("Дата");
  });

  it("IMP-06@PoC FR 1: the recipe's file rules reach the worker", async () => {
    const parse = await isolatedStatementParser().parse(new TextEncoder().encode(statement), {
      encoding: "utf-8",
      skipRows: 1,
      headerRow: 1,
    });
    expect(parse.reading.encoding.chosen.reason).toBe("recipe");
    expect(parse.analysis.table.evidence).toContainEqual({ code: "header-row", row: 2, count: 4 });
    expect(parse.analysis.table.evidence.some((e) => e.code === "rows-before-header")).toBe(false);
  });

  it("ARC-06@PoC FR 4: the parse worker has the limits of row 38 (512 MiB, 60 s)", () => {
    expect(PARSE_LIMITS).toEqual({ memoryMb: 512, timeoutMs: 60_000 });
  });

  it("ARC-06@PoC FR 4: a parse over the memory limit ends only its worker and is refused with PARSE_MEMORY", async () => {
    const parser = isolatedStatementParser({ memoryMb: 64, workerUrl: fixture("hog-worker.ts") });
    const err = await parser.parse(new TextEncoder().encode(statement)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StatementParseError);
    expect((err as StatementParseError).code).toBe("PARSE_MEMORY");
    await expect(isolatedStatementParser().parse(new TextEncoder().encode(statement))).resolves.toBeDefined();
  }, 60_000);

  it("ARC-06@PoC FR 4: a parse over the time limit is refused with PARSE_TIMEOUT", async () => {
    const parser = isolatedStatementParser({ timeoutMs: 500, workerUrl: fixture("spin-worker.ts") });
    const err = await parser.parse(new TextEncoder().encode(statement)).catch((e: unknown) => e);
    expect((err as StatementParseError).code).toBe("PARSE_TIMEOUT");
  }, 30_000);

  it("IMP-01@PoC FR 13: a file over 25 MiB is refused in the worker with FILE_TOO_LARGE", async () => {
    const err = await isolatedStatementParser()
      .parse(new Uint8Array(25 * 1024 * 1024 + 1))
      .catch((e: unknown) => e);
    expect((err as StatementParseError).code).toBe("FILE_TOO_LARGE");
  }, 30_000);
});

import { describe, expect, it } from "vitest";
import { isolatedStatementParser, PARSE_LIMITS } from "./run.ts";

/**
 * #624 (the parse step): at most `concurrent` parse workers of one parser at a time — each may take 512 MiB and 60 s —
 * and a lazy account binding takes its opener only once its turn has come, the last step before the worker.
 */
const slow = new URL("../../../../../test/fixtures/file-storage/slow-worker.ts", import.meta.url);
const file = new TextEncoder().encode("Дата;Сума\n01.03.2026;1,00\n");

describe("IMP-01@PoC FR 13: the parse workers at a time are limited", () => {
  it("IMP-01@PoC FR 13: with one turn, two parses run one after the other; the default is two at a time", async () => {
    expect(PARSE_LIMITS.concurrent).toBe(2);
    const one = isolatedStatementParser({ workerUrl: slow, concurrent: 1 });
    const started = performance.now();
    await Promise.all([one.parse(file), one.parse(file)]);
    // Each worker answers after 300 ms: one at a time takes at least two of them.
    expect(performance.now() - started).toBeGreaterThanOrEqual(580);
    expect(() => isolatedStatementParser({ concurrent: 0 })).toThrow();
  });

  it("IMP-01@PoC FR 13: a waiting parse takes its account opener only when its turn comes (#624)", async () => {
    const one = isolatedStatementParser({ workerUrl: slow, concurrent: 1 });
    const started = performance.now();
    let takenAfter = -1;
    const first = one.parse(file);
    const second = one
      .parse(file, {}, {}, async () => {
        takenAfter = performance.now() - started;
        // A used (empty) key: refused before any worker, as any binding that cannot be opened.
        return {
          by: "iban",
          sealedValue: "ws1.x",
          opener: { householdId: "h", field: "f", key: new ArrayBuffer(0) },
        };
      })
      .catch((error: Error) => error.message);
    await first;
    expect(await second).toBe("ACCOUNT_BINDING");
    // Not before the first worker's 300 ms were over.
    expect(takenAfter).toBeGreaterThanOrEqual(280);
  });
});

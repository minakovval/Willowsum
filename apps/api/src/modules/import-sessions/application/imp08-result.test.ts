import { describe, expect, it } from "vitest";
import { followUpOf, RESULT_PAGE, type ResultPorts } from "./result.ts";

/** IMP-08@PoC FR 11 (the step «Результат»): what is left after the apply, read page by page from the owning modules. */
describe("IMP-08@PoC FR 11: the counts of the step «Результат»", () => {
  const BATCH = "00000000-0000-4000-8000-0000000000b1";

  function ports(rows: number, categorized: (i: number) => boolean) {
    const all = Array.from({ length: rows }, (_, i) => ({
      transactionId: `t${i}`,
      fileId: i < rows / 2 ? "f1" : "f2",
      row: i + 1,
    }));
    const pages: number[] = [];
    const p: ResultPorts = {
      transactions: async ({ batchId, limit, after }) => {
        expect(batchId).toBe(BATCH);
        const start = after ? all.findIndex((t) => t.fileId === after.fileId && t.row === after.row) + 1 : 0;
        const page = all.slice(start, start + limit);
        pages.push(page.length);
        return page;
      },
      categoriesOf: async (ids) => {
        expect(ids.length).toBeLessThanOrEqual(RESULT_PAGE);
        return new Map(ids.filter((id) => categorized(Number(id.slice(1)))).map((id) => [id, "c"]));
      },
      proposals: async (batchId) => ({ count: batchId === BATCH ? 4 : 0, more: false }),
    };
    return { p, pages };
  }

  it("IMP-08@PoC AC7: «4 пари переказів», «9 без категорії» — the counts of the batch", async () => {
    const { p } = ports(12, (i) => i < 3);
    expect(await followUpOf(p, BATCH)).toEqual({
      cardPaymentTransfers: 0,
      transferProposals: { count: 4, more: false },
      uncategorized: 9,
    });
  });

  it("IMP-08@PoC FR 11: a batch of more rows than a page is read in bounded pages after the last (file, row)", async () => {
    const { p, pages } = ports(2 * RESULT_PAGE + 500, (i) => i % 10 === 0);
    const out = await followUpOf(p, BATCH);
    expect(pages).toEqual([RESULT_PAGE, RESULT_PAGE, 500]);
    expect(out.uncategorized).toBe(2 * RESULT_PAGE + 500 - 250);
  });

  it("IMP-08@PoC FR 11: a batch with nothing left — zeros, and a full last page asks once more", async () => {
    const { p, pages } = ports(RESULT_PAGE, () => true);
    expect((await followUpOf(p, BATCH)).uncategorized).toBe(0);
    expect(pages).toEqual([RESULT_PAGE, 0]);
  });
});

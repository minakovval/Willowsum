import { describe, expect, it } from "vitest";
import { fileMayLeave, stateAfterFileLeft } from "./parse.ts";
import { BATCH_STATES } from "./batch.ts";

/** BUD-21@PoC FR 2 (wave 2 row 243): a file leaving its statements' batch for a history batch of its own. Pure. */
describe("BUD-21@PoC FR 2: the statements' batch a file leaves", () => {
  it("BUD-21@PoC FR 2: a file leaves only a batch not being parsed and never applied", () => {
    expect(BATCH_STATES.filter(fileMayLeave)).toEqual(["uploaded", "parsed", "needs-review", "failed"]);
  });

  it("IMP-08@PoC FR 17: the rest of the batch goes on — its state from the files that stay; none left closes it", () => {
    expect(stateAfterFileLeft("needs-review", 1, "parsed")).toBe("parsed");
    expect(stateAfterFileLeft("parsed", 2, "parsed")).toBe("parsed");
    expect(stateAfterFileLeft("failed", 1, "failed")).toBe("failed");
    expect(stateAfterFileLeft("needs-review", 0, null)).toBe("cancelled");
    expect(stateAfterFileLeft("failed", 0, null)).toBe("cancelled");
    // A batch not parsed yet stays open for other files.
    expect(stateAfterFileLeft("uploaded", 0, null)).toBe("uploaded");
    expect(stateAfterFileLeft("uploaded", 1, null)).toBe("uploaded");
  });
});

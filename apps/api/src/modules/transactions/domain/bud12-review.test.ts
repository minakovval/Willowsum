import { describe, expect, it } from "vitest";
import { confirmReview, reopenReview, reviewOnCreate } from "./review.ts";

/** BUD-12@PoC a) (wave 2 row 24): the rules of «До розбору», without I/O. */
describe("BUD-12@PoC FR 8, FR 9: the fixed rule of the queue", () => {
  it("BUD-12@PoC FR 8: every new transaction imported from a statement goes into the queue; one entered by hand never does", () => {
    expect(reviewOnCreate({ importedFromStatement: true })).toBe("queued");
    expect(reviewOnCreate({ importedFromStatement: false })).toBeNull();
  });
});

describe("BUD-12@PoC FR 4, FR 6: «Підтвердити» and its «Відмінити»", () => {
  it("BUD-12@PoC FR 4: «Підтвердити» confirms the category of a queued transaction; a confirmed one stays; one never queued is refused", () => {
    expect(confirmReview("queued")).toBe("confirmed");
    expect(confirmReview("confirmed")).toBe("unchanged");
    expect(confirmReview(null)).toBe("not-queued");
  });

  it("BUD-12@PoC FR 6: «Відмінити» puts a confirmed transaction back into the queue; a queued one stays; one never queued is not put there", () => {
    expect(reopenReview("confirmed")).toBe("queued");
    expect(reopenReview("queued")).toBe("unchanged");
    expect(reopenReview(null)).toBe("not-queued");
  });
});

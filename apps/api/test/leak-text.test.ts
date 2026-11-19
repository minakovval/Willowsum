import { describe, expect, it } from "vitest";
import { leakText } from "./leak-text.ts";

const SUPPORT_ID = "b0aa96e35cf687db5000e7f6ea3e05b9";

describe("leakText: the body of a leak check without its random fields (#563)", () => {
  it("drops the random supportId, so a short number in it is not a leak", () => {
    const body = JSON.stringify({ code: "NOT_FOUND", supportId: SUPPORT_ID });
    expect(body).toContain("5000");
    expect(leakText(body)).not.toContain("5000");
    expect(leakText(body)).toContain("NOT_FOUND");
  });

  it("drops requestId and traceId at any depth", () => {
    const body = JSON.stringify({ errors: [{ traceId: SUPPORT_ID }], nested: { requestId: SUPPORT_ID } });
    expect(leakText(body)).not.toContain("5000");
  });

  it("still holds a real leak in any other field, at any depth", () => {
    const top = JSON.stringify({ code: "NOT_FOUND", detail: "Visa 5000.00", supportId: SUPPORT_ID });
    const deep = JSON.stringify({ errors: [{ field: "x", message: "5000" }], supportId: SUPPORT_ID });
    expect(leakText(top)).toContain("5000");
    expect(leakText(deep)).toContain("5000");
  });

  it("returns a body that is not JSON as it is", () => {
    expect(leakText("plain 5000 text")).toBe("plain 5000 text");
  });
});

import { describe, expect, it } from "vitest";
import { parseErasureCommand } from "./erasure-cli.ts";

const id = "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10";

describe("NFR-12@PoC FR 3: scripts/erasure.ts — the product owner's erasure on a person's request", () => {
  it("NFR-12@PoC FR 3: parses each command", () => {
    expect(parseErasureCommand(["request", "--email"])).toEqual({
      kind: "request",
      subject: { emailFromStdin: true },
    });
    expect(parseErasureCommand(["request", "--account", id])).toEqual({
      kind: "request",
      subject: { accountId: id },
    });
    expect(parseErasureCommand(["run", id])).toEqual({ kind: "run", requestId: id });
    expect(parseErasureCommand(["status"])).toEqual({ kind: "status" });
    expect(parseErasureCommand(["reapply"])).toEqual({ kind: "reapply" });
  });

  it("NFR-12@PoC FR 3: refuses a request without a subject, a bad id and unknown commands", () => {
    expect(() => parseErasureCommand(["request"])).toThrow();
    expect(() => parseErasureCommand(["request", "--email", "x@y", "--account", id])).toThrow();
    // The address never comes from argv (it would show in `ps` and shell history).
    expect(() => parseErasureCommand(["request", "--email", "olena@example.test"])).toThrow();
    expect(() => parseErasureCommand(["run", "not-an-id"])).toThrow();
    expect(() => parseErasureCommand(["drop"])).toThrow();
    expect(() => parseErasureCommand([])).toThrow();
  });
});

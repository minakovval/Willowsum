import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INK } from "./categories.ts";

/**
 * BUD-01@PoC FR 10 (#251 item 4): `INK`, the dark icon on a light category circle, copies the design token `--ws-ink`
 * (DS-06) because the API may not import the UI package; this test keeps the copy equal to the source of the tokens.
 */
describe("BUD-01@PoC FR 10: the icon colour is the design token", () => {
  it("BUD-01@PoC FR 10: INK equals `--ws-ink` of the light theme in packages/ui tokens.css", () => {
    const css = readFileSync(
      new URL("../../../../../../packages/ui/src/styles/tokens.css", import.meta.url),
      "utf8",
    );
    const token = /^\s*--ws-ink:\s*(#[0-9A-Fa-f]{6})\s*;/m.exec(css)?.[1];
    expect(token).toBeDefined();
    expect(INK.toUpperCase()).toBe(token!.toUpperCase());
  });
});

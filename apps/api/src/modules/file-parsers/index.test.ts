import { describe, expect, it } from "vitest";
import { fileParsersModule } from "./index.ts";

describe("file-parsers module", () => {
  it("declares its public interface", () => {
    expect(fileParsersModule.name).toBe("file-parsers");
  });
});

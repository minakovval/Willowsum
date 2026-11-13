import { describe, expect, it } from "vitest";
import { fileStorageModule } from "./index.ts";

describe("file-storage module", () => {
  it("declares its public interface", () => {
    expect(fileStorageModule.name).toBe("file-storage");
  });
});

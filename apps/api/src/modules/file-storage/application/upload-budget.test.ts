import { describe, expect, it } from "vitest";
import { FileRejectedError, FILE_LIMITS, type RejectionCode } from "../domain/index.ts";
import { uploadBudget } from "./upload-budget.ts";

const MiB = 1024 * 1024;
const CHUNK = Buffer.alloc(MiB, 0x41);

/** A request stream of `mib` MiB that counts how much of it was pulled and whether it was destroyed. */
function stream(mib: number) {
  const state = { pulled: 0, destroyed: false };
  const body = {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < mib; i++) {
        state.pulled++;
        yield CHUNK;
      }
    },
    destroy() {
      state.destroyed = true;
    },
  };
  return { body, state };
}

async function codeOf(work: () => Promise<unknown>): Promise<RejectionCode> {
  try {
    await work();
  } catch (error) {
    if (error instanceof FileRejectedError) return error.code;
    throw error;
  }
  throw new Error("accepted");
}

describe("sizes on the request stream (ARC-06@PoC FR 4, NFR-15@PoC FR 18, IMP-01@PoC FR 13)", () => {
  it("ARC-06@PoC FR 4: the limits are 25 MiB a file and 150 MiB a request", () => {
    expect(FILE_LIMITS.fileBytes).toBe(25 * MiB);
    expect(FILE_LIMITS.requestBytes).toBe(150 * MiB);
  });

  it("ARC-06@PoC FR 4: a file over 25 MiB is refused while it streams, before it is buffered in full", async () => {
    const { body, state } = stream(100);
    expect(await codeOf(() => uploadBudget().read(body))).toBe("FILE_TOO_LARGE");
    expect(state.pulled).toBe(26);
    expect(state.destroyed).toBe(true);
    const ok = stream(25);
    await expect(uploadBudget().read(ok.body)).resolves.toHaveLength(25 * MiB);
  });

  it("ARC-06@PoC FR 4: a request declared over 150 MiB is refused before any byte is read", async () => {
    for (const declared of [150 * MiB + 1, 200 * MiB]) {
      const { body, state } = stream(1);
      expect(await codeOf(() => uploadBudget(declared).read(body))).toBe("REQUEST_TOO_LARGE");
      expect(state.pulled).toBe(0);
      expect(state.destroyed).toBe(true);
    }
  });

  it("ARC-06@PoC FR 4: files of one request over 150 MiB together are refused on the stream, whatever the declared length", async () => {
    const budget = uploadBudget(10 * MiB); // a lying Content-Length
    for (let i = 0; i < 6; i++) await budget.read(stream(24).body);
    expect(budget.used).toBe(144 * MiB);
    const last = stream(24);
    expect(await codeOf(() => budget.read(last.body))).toBe("REQUEST_TOO_LARGE");
    expect(last.state.pulled).toBe(7);
    expect(last.state.destroyed).toBe(true);
  });

  it("IMP-01@PoC FR 13: the size messages name the ceiling and advise splitting, never a plan", async () => {
    const err = (await uploadBudget()
      .read(stream(30).body)
      .catch((e: unknown) => e)) as FileRejectedError;
    expect(err.rejection).toMatchObject({ status: 413, ceiling: { name: "fileBytes", limit: 25 * MiB } });
    expect(err.rejection.message.uk).toContain("25 МБ");
    expect(err.rejection.message.uk).toContain("Розділіть файл");
    expect(err.rejection.message.uk).not.toMatch(/план/i);
  });
});

import net from "node:net";
import { describe, expect, it } from "vitest";

// Deliberately does not import tools/test-guards/no-network.mjs: the guard must already be installed by the
// Vitest config's setupFiles (ARC-05 criterion «Тести, що потребують інтернету в CI — 0»).
const MARK = Symbol.for("willowsum.noNetworkGuard");

describe("ARC-05: the no-network guard is loaded by the test configuration itself", () => {
  it("ARC-05: sockets and fetch are guarded before any test code imports the guard", async () => {
    expect((net.Socket.prototype as unknown as Record<symbol, unknown>)[MARK]).toBe(true);
    expect((globalThis.fetch as unknown as Record<symbol, unknown>)[MARK]).toBe(true);
    await expect(fetch("https://example.com/")).rejects.toMatchObject({ code: "WS_NETWORK_BLOCKED" });
  });
});

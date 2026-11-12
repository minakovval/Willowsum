import { Decimal } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { crossRate, RateUnavailableError } from "../domain/index.ts";
import type { FxClock, FxRateStore } from "./index.ts";
import { startFxRefresh } from "./index.ts";

/** Security review of PR #120: guards of the update task that do not depend on one provider's parser. */
const clock: FxClock = {
  now: () => Date.UTC(2026, 10, 12, 14),
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

describe("sec#120: refresh and cross-rate guards", () => {
  it("a feed (any implementation) that returns a rate of a later date than today in Kyiv stores nothing", async () => {
    const saved: unknown[] = [];
    const store = {
      saveUpdate: async (u: unknown) => void saved.push(u),
      lastSuccessAt: async () => null,
      ratesOnOrBefore: async () => null,
      ratesOnOrBeforeEach: async (requests) => requests.map(() => null),
      claimStaleAlert: async () => false,
      releaseStaleAlert: async () => undefined,
    } satisfies FxRateStore;
    const loop = startFxRefresh({
      feed: {
        name: "replacement",
        dailyRates: async () => [
          { currency: "EUR", rate: new Decimal("45"), date: "2026-11-13", source: "NBU" },
        ],
      },
      store,
      clock,
      report: () => undefined,
    });
    expect(await loop.attempt()).toBe("failed");
    await loop.stop();
    expect(saved).toEqual([]);
  });

  it("a cross rate that rounds to 0 at 18 decimals is «no rate», never 0", () => {
    const rates = new Map([
      ["JPY", new Decimal("0.000000000000000001")],
      ["XAU", new Decimal("110385.17")],
    ]);
    expect(() => crossRate("JPY", "XAU", "2026-11-12", "NBU", rates)).toThrow(RateUnavailableError);
  });
});

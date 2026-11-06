import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLAGS_DB_TIMEOUTS } from "../src/modules/feature-flags/index.ts";

/**
 * CICD-06 / ADR-0004: what main.ts wires for the flags. The decisions themselves are unit-tested
 * (checkFlagsReady, flagsReadiness: runtime.test.ts); the api process end to end in security-cicd06.it.test.ts
 * («flags-not-loaded»). This pins that main.ts uses them, without a 60 s child process.
 */
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("CICD-06: main.ts wires the flag readiness and the pool timeouts", () => {
  it("the readiness probe of the api role answers with checkFlagsReady's reason", () => {
    expect(main).toMatch(
      /const reason = await checkFlagsReady\(flags\);\s*if \(reason !== "ok"\) return \{ ready: false, reason \};/,
    );
    expect(main).not.toMatch(/flags\.loaded/);
  });

  it("the feature-flags pool gets the 5 s statement and connection timeouts", () => {
    expect(main).toMatch(/module === "feature-flags" \? FLAGS_DB_TIMEOUTS : \{\}/);
    expect(FLAGS_DB_TIMEOUTS).toEqual({ statement_timeout: 5_000, connectionTimeoutMillis: 5_000 });
  });
});

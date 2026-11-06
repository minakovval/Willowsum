import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeImports } from "./analyze.ts";

const fixture = fileURLToPath(new URL("../../test/fixtures/dep-rules", import.meta.url));

describe("ARC-01 dependency analyzer (criteria table: internal imports, cycles, domain purity — 0)", () => {
  it("reports every forbidden import of the fixture and nothing else", async () => {
    const violations = await analyzeImports(fixture, {
      modules: {
        alpha: { layer: "subject", dependsOn: ["beta"] },
        beta: { layer: "subject", dependsOn: [] },
        gamma: { layer: "subject", dependsOn: [] },
      },
    });
    const normalised = violations.map((v) => v.replace(/→ .*node_modules\/\.pnpm\/pg@[^/]+\/.*/, "→ pg"));
    expect(normalised).toEqual([
      // ARC-01 FR 5: the application layer uses ports, not adapters.
      "application-not-to-adapters: src/modules/alpha/application/run.ts → src/modules/alpha/adapters/store.ts",
      // ARC-01 FR 5: the domain has no I/O and no adapters (the domain kernel and zod are allowed).
      "domain-pure: src/modules/alpha/domain/total.ts → fs",
      "domain-pure: src/modules/alpha/domain/total.ts → src/modules/alpha/adapters/store.ts",
      "domain-pure: src/modules/beta/domain/helper.ts → src/modules/beta/adapters/loop.ts",
      // ARC-01 FR 2: another module only through its index.ts.
      "module-internals: src/modules/alpha/application/run.ts → src/modules/beta/domain/helper.ts",
      // ARC-01 FR 4: no cycles.
      "no-circular: src/modules/beta/adapters/loop.ts → src/modules/beta/domain/helper.ts",
      // The database driver only through platform/db; a type-only import counts.
      "no-db-driver-in-modules: src/modules/alpha/adapters/store.ts → pg",
      // Code outside src/modules (e.g. an HTTP entry point) also goes only through index.ts.
      "outside-to-module-internals: src/http/routes.ts → src/modules/beta/domain/helper.ts",
      // ARC-01 FR 4: only dependencies declared in module-rules.json (alpha → beta is declared, gamma is not).
      "undeclared-dependency:alpha: src/modules/alpha/application/run.ts → src/modules/gamma/index.ts",
      // An import that does not resolve can't be checked, so it is an error itself.
      "unresolvable: src/modules/gamma/index.ts → ./missing.ts",
    ]);
  });

  it("finds no violations in apps/api itself", async () => {
    const { readFileSync } = await import("node:fs");
    const base = fileURLToPath(new URL("../..", import.meta.url));
    const rules = JSON.parse(readFileSync(`${base}/module-rules.json`, "utf8"));
    expect(await analyzeImports(base, rules)).toEqual([]);
  });
});

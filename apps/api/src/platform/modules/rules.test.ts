import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultLayer, parseCatalogue, readCatalogue } from "./catalogue.ts";
import { findCycles, moduleRoleName, schemaName, topologicalOrder, validateRules } from "./rules.ts";

const repoRoot = fileURLToPath(new URL("../../../../..", import.meta.url));
const catalogue = readCatalogue(repoRoot);

describe("ARC-01 module catalogue", () => {
  it("is read from the ARC-01 slices: 79 modules, the PoC slice first", () => {
    expect(catalogue.size).toBe(79);
    expect(catalogue.get("ledger")).toMatchObject({ domain: "Гроші" });
    expect(catalogue.get("bank-monobank")?.owns).toContain("monobank");
  });

  it("assigns the dependency layer: platform ← subject ← process", () => {
    expect(defaultLayer(catalogue.get("identity")!)).toBe("platform");
    expect(defaultLayer(catalogue.get("bulk-actions")!)).toBe("platform");
    expect(defaultLayer(catalogue.get("ledger")!)).toBe("subject");
    expect(defaultLayer(catalogue.get("budget")!)).toBe("process");
    expect(defaultLayer(catalogue.get("dashboard")!)).toBe("process");
  });

  it("parses only catalogue rows", () => {
    const parsed = parseCatalogue([
      "| Домен | Модуль | Що |\n| --- | --- | --- |\n| Гроші | ledger | Журнал |\n| Критерій | Поріг | Перевірка |",
    ]);
    expect([...parsed.keys()]).toEqual(["ledger"]);
  });
});

describe("ARC-01 FR 4: one rules file, no cycles, dependencies point to the platform", () => {
  it("accepts a valid rules file", () => {
    const rules = {
      modules: {
        identity: { layer: "platform" as const, dependsOn: [] },
        ledger: { layer: "subject" as const, dependsOn: ["identity"] },
        budget: { layer: "process" as const, dependsOn: ["ledger", "identity"] },
      },
    };
    expect(validateRules(rules, catalogue)).toEqual([]);
    expect(topologicalOrder(rules)).toEqual(["identity", "ledger", "budget"]);
  });

  it("rejects unknown modules, missing and duplicate dependencies, self-dependencies", () => {
    const problems = validateRules(
      {
        modules: {
          "not-a-module": { layer: "subject", dependsOn: [] },
          ledger: { layer: "subject", dependsOn: ["ghost", "ledger", "accounts", "accounts"] },
          accounts: { layer: "subject", dependsOn: [] },
        },
      },
      catalogue,
    );
    expect(problems).toEqual([
      "not-a-module: not in the module catalogue of ARC-01",
      "ledger: depends on «ghost», which is not declared",
      "ledger: depends on itself",
      "ledger: «accounts» is listed twice",
      "cycle: ledger → ledger",
    ]);
  });

  it("rejects a dependency from the platform or a subject module towards a process module", () => {
    const problems = validateRules(
      {
        modules: {
          identity: { layer: "platform", dependsOn: ["ledger"] },
          ledger: { layer: "subject", dependsOn: ["budget"] },
          budget: { layer: "process", dependsOn: [] },
        },
      },
      catalogue,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^identity \(platform\) → ledger \(subject\)/);
    expect(problems[1]).toMatch(/^ledger \(subject\) → budget \(process\)/);
  });

  it("reports cycles once each", () => {
    const rules = {
      modules: {
        accounts: { layer: "subject" as const, dependsOn: ["ledger"] },
        ledger: { layer: "subject" as const, dependsOn: ["transactions"] },
        transactions: { layer: "subject" as const, dependsOn: ["accounts"] },
        merchants: { layer: "subject" as const, dependsOn: ["merchants"] },
      },
    };
    expect(findCycles(rules)).toEqual([
      ["accounts", "ledger", "transactions", "accounts"],
      ["merchants", "merchants"],
    ]);
    expect(validateRules(rules, catalogue)).toContain("cycle: accounts → ledger → transactions → accounts");
  });

  it("names the schema and role of a module", () => {
    expect(schemaName("bank-monobank")).toBe("bank_monobank");
    expect(moduleRoleName("bank-monobank")).toBe("ws_mod_bank_monobank");
    expect(() => schemaName('x"; drop')).toThrow(/Invalid module name/);
  });
});

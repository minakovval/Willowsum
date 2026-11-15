import { describe, expect, it } from "vitest";
import type { AuditEntryInput } from "../audit/index.ts";
import { categoriesAudit } from "./adapters/http/index.ts";
import {
  deleteCategory,
  type CategoriesDeps,
  type CategoriesTx,
  type StoredCategory,
} from "./application/index.ts";

/**
 * BUD-01@PoC FR 12 (#277 item 4): the audit path of a category's delete, without a database. The entry is `delete`,
 * lists every field before with each after null, is the user's from the web, and is written after the row went and
 * only when it did. Synthetic values.
 */
const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";

const stored: StoredCategory = {
  id: CATEGORY,
  groupId: GROUP,
  kind: "expense",
  systemKey: null,
  name: "Синтетична категорія",
  renamed: false,
  icon: "tag",
  color: "blue",
  essential: true,
  state: "active",
  mergedInto: null,
  position: 3,
  version: 2,
};

describe("BUD-01@PoC FR 12 (#277 item 4): `categoriesAudit` on a delete", () => {
  it("BUD-01@PoC FR 12: a delete is one `delete` entry of the user from the web, every field before and null after", async () => {
    const recorded: { householdId: string; entry: AuditEntryInput }[] = [];
    const audit = categoriesAudit({
      record: async (householdId, entry) => {
        recorded.push({ householdId, entry });
        return {} as never;
      },
    });
    await audit.changed(
      HOUSEHOLD,
      { accountId: ACCOUNT },
      { type: "categories.category", id: CATEGORY },
      "delete",
      { name: "Синтетична категорія", icon: "tag", essential: null, mergedInto: null },
      null,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.householdId).toBe(HOUSEHOLD);
    expect(recorded[0]!.entry).toEqual({
      actor: { kind: "user", id: ACCOUNT },
      channel: "web",
      entity: { type: "categories.category", id: CATEGORY },
      action: "delete",
      changes: [
        { field: "name", before: "Синтетична категорія", after: null, sensitive: false },
        { field: "icon", before: "tag", after: null, sensitive: false },
        { field: "essential", before: null, after: null, sensitive: false },
        { field: "mergedInto", before: null, after: null, sensitive: false },
      ],
    });
  });
});

describe("BUD-01@PoC FR 12 (#277 item 4): `deleteCategory` writes the audit entry once, after the delete, and only when it deleted", () => {
  function setup(category: StoredCategory | null, used: readonly string[] = []) {
    const log: string[] = [];
    const audits: unknown[][] = [];
    const tx = {
      category: async () => category,
      mergeTargets: async () => new Set<string>(),
      deleteCategory: async () => void log.push("delete"),
    } as unknown as CategoriesTx;
    const deps: CategoriesDeps = {
      audit: {
        changed: async (...args) => {
          log.push("audit");
          audits.push(args);
        },
      },
      newId: () => "x",
      now: () => 0,
    };
    const usage = [{ module: "test", used: async () => new Set(used) }];
    const run = () =>
      deleteCategory(deps, usage, tx, { householdId: HOUSEHOLD, accountId: ACCOUNT } as never, CATEGORY);
    return { run, log, audits };
  }

  it("BUD-01@PoC FR 12: an empty custom category — the row goes, then one `delete` entry with the fields before", async () => {
    const { run, log, audits } = setup(stored);
    expect((await run()).kind).toBe("ok");
    expect(log).toEqual(["delete", "audit"]);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.slice(2)).toEqual([
      { type: "categories.category", id: CATEGORY },
      "delete",
      {
        name: "Синтетична категорія",
        groupId: GROUP,
        icon: "tag",
        color: "blue",
        essential: "true",
        state: "active",
        mergedInto: null,
      },
      null,
    ]);
  });

  it.each([
    ["in use", stored, [CATEGORY], "not-empty"],
    ["a system category", { ...stored, systemKey: "groceries" }, [], "system-fixed"],
    ["unknown", null, [], "not-found"],
    ["retired", { ...stored, state: "retired" as const }, [], "not-found"],
  ] as const)(
    "BUD-01@PoC FR 12: %s — refused as %s, nothing deleted and no entry",
    async (_name, category, used, kind) => {
      const { run, log } = setup(category as StoredCategory | null, used);
      expect((await run()).kind).toBe(kind);
      expect(log).toEqual([]);
    },
  );
});

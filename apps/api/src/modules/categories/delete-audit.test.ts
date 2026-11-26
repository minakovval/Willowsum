import { describe, expect, it } from "vitest";
import type { AuditEntryInput } from "../audit/index.ts";
import { categoriesAudit } from "./adapters/http/index.ts";
import {
  deleteCategory,
  type CategoriesDeps,
  type CategoriesTx,
  type CategoryUsage,
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
  const entries = { limit: { amount: "30.00", currency: "EUR" }, stored: true, planCells: 2 };
  let failDelete = false;
  function setup(category: StoredCategory | null, used: readonly string[] = [], limited = false) {
    const log: string[] = [];
    const audits: unknown[][] = [];
    const tx = {
      category: async () => category,
      mergeTargets: async () => new Set<string>(),
      mergedCount: async () => 0,
      deleteCategory: async () => {
        if (failDelete) {
          failDelete = false;
          throw new Error("injected");
        }
        log.push("delete");
      },
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
    const usage: CategoryUsage[] = [
      {
        module: "test",
        used: async () => new Set(used),
        transactions: async () => (used.length > 0 ? 40 : 0),
      },
      {
        module: "budget",
        limits: {
          held: async () => new Set(limited ? [CATEGORY] : []),
          entries: async () => entries,
          release: async () => {
            log.push("release");
            limited = false;
            return entries;
          },
        },
      },
    ];
    const run = (confirmLimit = false) =>
      deleteCategory(
        deps,
        usage,
        tx,
        { householdId: HOUSEHOLD, accountId: ACCOUNT } as never,
        CATEGORY,
        confirmLimit,
      );
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

  it("BUD-01@PoC AC 22: only its limit holds it — unconfirmed, refused naming the limit and nothing changes; confirmed, module budget removes the entries, then the row goes, then one entry with them", async () => {
    const first = setup(stored, [], true);
    const refused = await first.run(false);
    expect(refused).toEqual({
      kind: "confirm-limit",
      usage: {
        transactions: 0,
        rules: 0,
        recurringPayments: 0,
        mergedCategories: 0,
        budget: entries,
      },
    });
    expect(first.log).toEqual([]);
    const { run, log, audits } = setup(stored, [], true);
    expect((await run(true)).kind).toBe("ok");
    expect(log).toEqual(["release", "delete", "audit"]);
    expect(audits[0]![4]).toMatchObject({ name: "Синтетична категорія", limit: "30.00 EUR", planCells: "2" });
  });

  it("BUD-01@PoC FR 12: the category's delete fails after budget's commit — the request fails, `release` ran once and the category is left without its limit; a retry without `confirmLimit` deletes it", async () => {
    const { run, log, audits } = setup(stored, [], true);
    failDelete = true;
    await expect(run(true)).rejects.toThrow("injected");
    expect(log).toEqual(["release"]);
    expect(audits).toHaveLength(0);
    expect((await run(false)).kind).toBe("ok");
    expect(log).toEqual(["release", "delete", "audit"]);
    expect(audits[0]![4]).not.toHaveProperty("limit");
  });

  it("BUD-01@PoC AC 19: held by transactions — refused with the reason and its count, even confirmed; the limit is not removed", async () => {
    const { run, log } = setup(stored, [CATEGORY], true);
    const refused = await run(true);
    expect(refused).toMatchObject({ kind: "not-empty", usage: { transactions: 40, budget: entries } });
    expect(log).toEqual([]);
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

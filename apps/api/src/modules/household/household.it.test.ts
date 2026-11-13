import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { localKeyManagement } from "../../platform/adapters/kms/index.ts";
import { createAuditLog } from "../audit/index.ts";
import { databaseSpacesStore } from "./adapters/index.ts";
import { ensureFirstSpace, newSpaceKey, type SpacesStore } from "./application/index.ts";
import { createHouseholdSpaces, type HouseholdSpaces } from "./index.ts";

/**
 * ACC-01@PoC part c, household side (ADR-0010) on a real PostgreSQL: the first space «Родина <Прізвище>» with the
 * account as Owner, idempotent under concurrent calls, the login → space directory, the space's audit entries and
 * the household policy on the space's own record. Accounts are random ids; names are synthetic.
 */
/** Resolves for everyone once `n` callers have arrived, or after `ms` (then it stays open). */
function barrier(n: number, ms: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
    setTimeout(resolve, ms);
  });
  return async () => {
    if (++arrived >= n) open();
    await opened;
  };
}

async function spaceCount(accountId: string): Promise<number> {
  const { rows } = await db.owner.query(
    `SELECT count(*)::int AS spaces FROM household.households h
       JOIN household.account_spaces m ON m.space_id = h.household_id WHERE m.account_id = $1`,
    [accountId],
  );
  return rows[0].spaces as number;
}

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = createHouseholdSpaces(
    db.databases.for("household"),
    createAuditLog(db.databases.for("audit")),
    localKeyManagement(),
  );
});

afterAll(async () => {
  await db?.close();
});

describe("ACC-01 FR 7 / ACC-08 FR 1: the first space of an account", () => {
  it("«Родина <Прізвище>» in the EU region with the account as its Owner; audited in the space's own log", async () => {
    const accountId = randomUUID();
    const result = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
    expect(result).toEqual({ householdId: expect.any(String), role: "owner", created: true });
    const { rows } = await db.owner.query(
      `SELECT name, data_region, encryption_key_ref FROM household.households WHERE household_id = $1`,
      [result.householdId],
    );
    expect(rows).toEqual([
      // ARC-06@PoC FR 1: the reference names the space's own key (ADR-0012).
      {
        name: "Родина Синтетична",
        data_region: "eu",
        encryption_key_ref: expect.stringMatching(/^dek:[0-9a-f-]{36}$/),
      },
    ]);
    expect(await spaces.membershipOf(accountId)).toEqual({ householdId: result.householdId, role: "owner" });

    const audit = createAuditLog(db.databases.for("audit"));
    const created = await audit.entriesFor(result.householdId, {
      type: "household.space",
      id: result.householdId,
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      actorKind: "user",
      actorId: accountId,
      action: "create",
      changes: [
        { field: "name", before: null, after: "Родина Синтетична", masked: false },
        { field: "dataRegion", before: null, after: "eu", masked: false },
      ],
    });
    const member = await audit.entriesFor(result.householdId, { type: "household.member", id: accountId });
    expect(member[0]).toMatchObject({
      action: "create",
      changes: [{ field: "role", before: null, after: "owner", masked: false }],
    });
  });

  it("ACC-08 edge case: a one-word name gives «Родина <Ім'я>»", async () => {
    const result = await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Тарас" });
    const { rows } = await db.owner.query(`SELECT name FROM household.households WHERE household_id = $1`, [
      result.householdId,
    ]);
    expect(rows[0].name).toBe("Родина Тарас");
  });

  it("only when the account has no space: a second call finds the first and changes nothing", async () => {
    const accountId = randomUUID();
    const first = await spaces.ensureFirstSpace({ accountId, displayName: "Ірина Перша" });
    const second = await spaces.ensureFirstSpace({ accountId, displayName: "Ірина Друга" });
    expect(second).toEqual({ householdId: first.householdId, role: "owner", created: false });
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM household.account_spaces WHERE account_id = $1`,
      [accountId],
    );
    expect(rows[0].n).toBe(1);
    const entries = await createAuditLog(db.databases.for("audit")).entriesFor(first.householdId, {
      type: "household.space",
      id: first.householdId,
    });
    expect(entries).toHaveLength(1);
  });

  it("concurrent first calls for one account make exactly one space", async () => {
    const accountId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        spaces.ensureFirstSpace({ accountId, displayName: "Петро Паралельний" }),
      ),
    );
    expect(new Set(results.map((r) => r.householdId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await spaceCount(accountId)).toBe(1);
  });

  it("racing first sign-ins that all passed the quick check still make one space (the lock per account)", async () => {
    // Every call misses the quick check outside the transaction, and inside it each one waits after its own check
    // until all have checked (or 300 ms). Without the lock per account all of them would then create a space.
    const N = 5;
    const store = databaseSpacesStore(db.databases.for("household"));
    const checked = barrier(N, 300);
    const racing: SpacesStore = {
      membershipOf: async () => null,
      spaceIds: () => store.spaceIds(),
      inSpace: (householdId, work) =>
        store.inSpace(householdId, (tx) =>
          work({
            ...tx,
            membershipOf: async (id) => {
              const found = await tx.membershipOf(id);
              await checked();
              return found;
            },
          }),
        ),
    };
    const audit = { spaceCreated: async () => undefined };
    const accountId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        ensureFirstSpace(
          {
            store: racing,
            audit,
            newId: randomUUID,
            newKey: (id) => newSpaceKey(localKeyManagement(), id),
            dataRegion: "eu",
          },
          { accountId, displayName: "Рита Гонка" },
        ),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.householdId)).size).toBe(1);
    expect(await spaceCount(accountId)).toBe(1);
  });

  it("FIN-04 FR 9: the scheduler's daily checks get the id of every space with a member", async () => {
    const a = await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Віра Перелік" });
    const b = await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Олег Перелік" });
    const ids = await spaces.spaceIds();
    expect(ids).toEqual(expect.arrayContaining([a.householdId, b.householdId]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an account without a space has no membership", async () => {
    expect(await spaces.membershipOf(randomUUID())).toBeNull();
  });
});

describe("ARC-03: the space's record is under the household policy; the directory only in the module's role", () => {
  it("another space, or no space, sees nothing of it", async () => {
    const mine = await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Анна Своя" });
    const other = await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Богдан Чужий" });
    const household = db.databases.for("household");
    const seen = await household.inHousehold(mine.householdId, async (q) => {
      const { rows } = await q.query<{ household_id: string }>(`SELECT household_id FROM households`);
      return rows.map((r) => r.household_id);
    });
    expect(seen).toEqual([mine.householdId]);
    expect(seen).not.toContain(other.householdId);
    const unbound = await household.transaction(
      async (q) => (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM households`)).rows[0]!.n,
    );
    expect(unbound).toBe(0);
  });

  it("other modules' roles cannot read the directory", async () => {
    const error = await db.databases
      .for("identity")
      .transaction((q) => q.query(`SELECT * FROM household.account_spaces`))
      .then(
        () => null,
        (e: { code?: string }) => e.code,
      );
    expect(error).toBe("42501");
  });
});

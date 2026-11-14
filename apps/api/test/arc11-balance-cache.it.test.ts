import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseLedgerStore } from "../src/modules/ledger/adapters/index.ts";
import {
  post as postWith,
  type LedgerStore,
  type LedgerTx,
} from "../src/modules/ledger/application/index.ts";
import { naturalBalance } from "../src/modules/ledger/domain/index.ts";
import {
  createLedger,
  createLedgerIntegrityCheck,
  type Entry,
  type Ledger,
  type LedgerAccount,
  type PostInput,
} from "../src/modules/ledger/index.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * ARC-11@PoC «Баланси і продуктивність» (issue #126) on a real PostgreSQL, through the ledger module's own role: the
 * daily balance cache is updated in the entry's transaction with a version check, a conflict is retried, the cache is
 * rebuilt from the postings by one command with the same numbers, and `balanceAt` (with and without «as known at»)
 * gives from the cache exactly what the postings give. Spaces, ids and amounts are synthetic; the random journals come
 * from a fixed seed.
 */

let db: RealModulesDatabase;
let ledger: Ledger;
let store: LedgerStore;

beforeAll(async () => {
  db = await setupRealModules(8);
  ledger = createLedger(db.databases.for("ledger"));
  store = databaseLedgerStore(db.databases.for("ledger"));
});

afterAll(async () => {
  await db?.close();
});

const eur = (amount: string) => Money.of(amount, "EUR");
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

interface Space {
  householdId: string;
  cash: LedgerAccount;
  savings: LedgerAccount;
  card: LedgerAccount;
}

async function space(): Promise<Space> {
  const householdId = randomUUID();
  const open = (type: "asset" | "liability") =>
    ledger.openAccount(householdId, { module: "accounts", id: randomUUID() }, { type, currency: "EUR" });
  return {
    householdId,
    cash: await open("asset"),
    savings: await open("asset"),
    card: await open("liability"),
  };
}

const input = (event: PostInput["event"], operationDate: string, key: string = randomUUID()): PostInput => ({
  source: { module: "transactions", id: randomUUID() },
  idempotencyKey: key,
  operationDate,
  event,
});

/** The balance from the postings alone (the raw sum, never the cache), with the sign of the account's type. */
async function rawBalance(
  householdId: string,
  account: LedgerAccount,
  date: string,
  asKnownAt: string | null = null,
): Promise<Money> {
  const totals = await store.inHousehold(householdId, (tx) => tx.totals(account.id, date, asKnownAt));
  return naturalBalance(
    account.type,
    Money.of(totals.debits, account.currency),
    Money.of(totals.credits, account.currency),
  );
}

/** The superuser's view of a space's cache (bypasses the policy): for comparing what is stored. */
async function cacheRows(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT b.account_id, b.day::text AS day, b.currency, b.debits::text AS debits, b.credits::text AS credits
       FROM ledger.daily_balances b WHERE b.household_id = $1 ORDER BY 1, 2`,
    [householdId],
  );
  return rows;
}

async function versions(householdId: string): Promise<Record<string, number>> {
  const { rows } = await db.owner.query<{ account_id: string; version: string }>(
    `SELECT account_id, version::text AS version FROM ledger.balance_versions WHERE household_id = $1`,
    [householdId],
  );
  return Object.fromEntries(rows.map((r) => [r.account_id, Number(r.version)]));
}

const checkOf = (householdId: string) =>
  createLedgerIntegrityCheck(
    db.databases.for("ledger"),
    async () => [householdId],
    () => undefined,
    () => undefined,
  );

/** A small deterministic generator (mulberry32), so a failing journal can be replayed from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    int,
    pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!,
    /** A day of June–July 2026. */
    day: () => `2026-0${int(6, 7)}-${String(int(1, 28)).padStart(2, "0")}`,
    /** A positive amount with up to 18 decimals, so no float could carry it. */
    amount: () => `${int(0, 99999)}.${String(int(0, 999999)).padStart(6, "0")}${int(1, 9)}00000000001`,
  };
}

/** A random journal: events on the space's accounts, back-dated ones, reversals and corrections. */
async function randomJournal(s: Space, seed: number, steps: number): Promise<Entry[]> {
  const r = rng(seed);
  const posted: Entry[] = [];
  const reversible = () => posted.filter((e) => e.reversesEntryId === null && !reversed.has(e.id));
  const reversed = new Set<string>();
  const assets = [s.cash, s.savings];
  for (let i = 0; i < steps; i++) {
    const kind = r.int(0, 9);
    const candidates = reversible();
    if (kind === 0 && candidates.length > 0) {
      const target = r.pick(candidates);
      posted.push(await ledger.reverse(s.householdId, target.id, randomUUID()));
      reversed.add(target.id);
      continue;
    }
    if (kind === 1 && candidates.length > 0) {
      const target = r.pick(candidates);
      const fixed = await ledger.correct(
        s.householdId,
        target.id,
        input({ type: "transaction", account: r.pick(assets).id, amount: eur(r.amount()) }, r.day()),
      );
      reversed.add(target.id);
      posted.push(fixed.reversal, fixed.entry);
      continue;
    }
    const day = r.day(); // dates are random, so most entries are back-dated against the latest one
    const amount = eur(r.amount());
    const event: PostInput["event"] =
      kind <= 4
        ? {
            type: "transaction",
            account: r.pick([...assets, s.card]).id,
            amount: r.int(0, 1) ? amount : amount.negated(),
          }
        : kind <= 7
          ? { type: "transfer", from: s.cash.id, to: s.savings.id, amount }
          : { type: "transfer", from: s.savings.id, to: s.cash.id, amount };
    posted.push(await ledger.post(s.householdId, input(event, day)));
  }
  return posted;
}

describe("ARC-11@PoC «Баланси і продуктивність»: the daily balance cache", () => {
  it("ARC-11 criterion «Перебудова кешу залишків з проводок»: the rebuild command gives the cache it replaces, to the last digit", async () => {
    const s = await space();
    await randomJournal(s, 126, 40);
    const before = await cacheRows(s.householdId);
    expect(before.length).toBeGreaterThan(10);
    const versionsBefore = await versions(s.householdId);
    // The cache equals the postings day by day: every cached day holds the totals up to it.
    for (const row of before) {
      const account = [s.cash, s.savings, s.card].find((a) => a.id === row.account_id);
      if (!account) continue; // a service account
      const totals = await store.inHousehold(s.householdId, (tx) => tx.totals(account.id, row.day, null));
      expect(eur(row.debits as string).equals(eur(totals.debits)), row.day as string).toBe(true);
      expect(eur(row.credits as string).equals(eur(totals.credits)), row.day as string).toBe(true);
    }
    const rebuilt = await ledger.rebuildBalances(s.householdId);
    // Three owner accounts and the service account «Зовнішні кошти».
    expect(rebuilt).toEqual({ accounts: 4, days: before.length });
    expect(await cacheRows(s.householdId)).toEqual(before);
    // Each account's cache got a new version, so an update that read the old one retries on the rebuilt cache.
    for (const [account, version] of Object.entries(await versions(s.householdId)))
      expect(version, account).toBe(versionsBefore[account]! + 1);
    expect((await checkOf(s.householdId).run())["balance-cache"]).toBe(0);
  });

  it("ARC-11: balanceAt gives from the cache what the postings give — random journals with back-dated entries, reversals and corrections, with and without «as known at»", async () => {
    for (const seed of [1, 2, 3]) {
      const s = await space();
      const r = rng(1000 + seed);
      const entries = await randomJournal(s, seed, 30);
      const moments = [...new Set(entries.map((e) => e.recordedAt))].sort();
      const latest = moments.at(-1)!;
      const dates = [
        "2026-05-31",
        "2026-06-01",
        "2026-07-28",
        "2026-12-31",
        ...entries.map((e) => e.operationDate),
      ];
      for (let i = 0; i < 6; i++) dates.push(r.day());
      for (const account of [s.cash, s.savings, s.card])
        for (const date of dates)
          for (const asKnownAt of [null, latest, "2099-01-01T00:00:00Z", r.pick(moments), moments[0]!]) {
            const options = asKnownAt === null ? {} : { asKnownAt };
            const cached = await ledger.balanceAt(s.householdId, account.id, date, options);
            const raw = await rawBalance(s.householdId, account, date, asKnownAt);
            expect(cached.equals(raw), `seed ${seed}, ${account.type}, ${date}, ${asKnownAt}`).toBe(true);
          }
      expect((await checkOf(s.householdId).run())["balance-cache"]).toBe(0);
    }
  });

  it("ARC-11: balanceAt is served from the cache when it can answer, and from the postings when «as known at» is earlier than the cache", async () => {
    const s = await space();
    const first = await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("100") }, "2026-06-10"),
    );
    await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("25.5") }, "2026-06-05"),
    );
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe(
      "125.5",
    );
    // Only the cache could show this number: the superuser changes a cached row behind the module's back.
    await db.owner.query(
      `UPDATE ledger.daily_balances SET debits = debits + 1000 WHERE household_id = $1 AND account_id = $2 AND day = '2026-06-10'`,
      [s.householdId, s.savings.id],
    );
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe(
      "1125.5",
    );
    expect(
      (
        await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30", {
          asKnownAt: "2099-01-01T00:00:00Z",
        })
      ).toDecimalString(),
    ).toBe("1125.5");
    // «As known at» the first entry is earlier than the cache's latest entry: the postings answer, not the cache.
    expect(
      (
        await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30", { asKnownAt: first.recordedAt })
      ).toDecimalString(),
    ).toBe("100");
    // The daily check finds the damaged account; the rebuild command repairs it from the postings.
    expect((await checkOf(s.householdId).run())["balance-cache"]).toBe(1);
    expect(await ledger.rebuildBalances(s.householdId, s.savings.id)).toEqual({ accounts: 1, days: 2 });
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe(
      "125.5",
    );
    expect((await checkOf(s.householdId).run())["balance-cache"]).toBe(0);
  });

  it("ARC-11: an account without a cache is answered from its postings; its next entry builds the cache from all of them", async () => {
    const s = await space();
    await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("40") }, "2026-06-01"),
    );
    // The module role may drop the derived cache (never the journal).
    await db.databases.for("ledger").inHousehold(s.householdId, async (q) => {
      await q.query(`DELETE FROM daily_balances WHERE account_id = $1`, [s.savings.id]);
      await q.query(`DELETE FROM balance_versions WHERE account_id = $1`, [s.savings.id]);
    });
    expect(await versions(s.householdId)).not.toHaveProperty(s.savings.id);
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe("40");
    await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("2") }, "2026-05-20"),
    );
    expect(await versions(s.householdId)).toHaveProperty(s.savings.id, 1);
    expect((await cacheRows(s.householdId)).filter((r) => r.account_id === s.savings.id)).toEqual([
      {
        account_id: s.savings.id,
        day: "2026-05-20",
        currency: "EUR",
        debits: "2.000000000000000000",
        credits: "0.000000000000000000",
      },
      {
        account_id: s.savings.id,
        day: "2026-06-01",
        currency: "EUR",
        debits: "42.000000000000000000",
        credits: "0.000000000000000000",
      },
    ]);
    expect((await checkOf(s.householdId).run())["balance-cache"]).toBe(0);
  });

  it("ARC-11: concurrent entries on the same accounts are not lost — the version check retries the conflicts", async () => {
    const s = await space();
    const r = rng(77);
    const events = Array.from({ length: 24 }, () =>
      input(
        r.int(0, 1)
          ? { type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur(r.amount()) }
          : { type: "transfer", from: s.savings.id, to: s.cash.id, amount: eur(r.amount()) },
        r.day(),
      ),
    );
    await Promise.all(events.map((e) => ledger.post(s.householdId, e)));
    for (const account of [s.cash, s.savings])
      for (const date of ["2026-06-15", "2026-07-31"])
        expect(
          (await ledger.balanceAt(s.householdId, account.id, date)).equals(
            await rawBalance(s.householdId, account, date),
          ),
        ).toBe(true);
    expect(await versions(s.householdId)).toEqual({ [s.cash.id]: 24, [s.savings.id]: 24 });
    expect((await checkOf(s.householdId).run())["balance-cache"]).toBe(0);
  });

  it("ARC-11: a conflict on the version is retried on the fresh cache, inside the same entry's transaction", async () => {
    const s = await space();
    // «Зовнішні кошти» exists before the race, so both entries wait only on the cache.
    await ledger.post(
      s.householdId,
      input({ type: "transaction", account: s.savings.id, amount: eur("1") }, "2026-06-01"),
    );
    const real = databaseLedgerStore(db.databases.for("ledger"));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let moved!: () => void;
    const firstMoved = new Promise<void>((resolve) => (moved = resolve));
    const outcomes: boolean[] = [];
    // The first entry stops after its cache updates (holding both version rows); the second records each try.
    const holding: LedgerStore = {
      inHousehold: (h, work) =>
        real.inHousehold(h, (tx) =>
          work({
            ...tx,
            recorded: async (entry) => {
              await tx.recorded(entry);
              moved();
              await held;
            },
          }),
        ),
    };
    const counting: LedgerStore = {
      inHousehold: (h, work) =>
        real.inHousehold(h, (tx) =>
          work({
            ...tx,
            moveBalance: async (...args: Parameters<LedgerTx["moveBalance"]>) => {
              const ok = await tx.moveBalance(...args);
              outcomes.push(ok);
              return ok;
            },
          }),
        ),
    };
    const first = postWith(
      { store: holding, newId: randomUUID },
      s.householdId,
      input({ type: "transaction", account: s.savings.id, amount: eur("10") }, "2026-06-02"),
    );
    await firstMoved;
    const second = postWith(
      { store: counting, newId: randomUUID },
      s.householdId,
      input({ type: "transaction", account: s.savings.id, amount: eur("5") }, "2026-05-30"),
    );
    // The second waits on the version row the first holds; then the first commits.
    for (let i = 0; i < 100; i++) {
      const { rows } = await db.owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE balance_versions%'`,
      );
      if (rows[0]!.n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    release();
    await Promise.all([first, second]);
    // The second's first account waited, found a new version and retried; its other account was already free.
    expect(outcomes).toEqual([false, true, true]);
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe("16");
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-05-31")).toDecimalString()).toBe("5");
    expect((await checkOf(s.householdId).run())["balance-cache"]).toBe(0);
  });

  it("ARC-11: a posting on a cached account that skips the cache is refused at commit (no stale cache is written)", async () => {
    const s = await space();
    const entry = await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("1") }, "2026-06-01"),
    );
    const id = randomUUID();
    const outcome = await code(
      db.databases.for("ledger").inHousehold(s.householdId, async (q) => {
        await q.query(
          `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
           VALUES ($1, $2, 'transactions', $2, 'transfer', '2026-06-02', 1, $3)`,
          [s.householdId, id, `bypass-${id}`],
        );
        await q.query(`INSERT INTO postings VALUES ($1, $2, 1, $3, $4, 7, 'EUR')`, [
          s.householdId,
          id,
          s.cash.id,
          s.savings.id,
        ]);
      }),
    );
    expect(outcome).toBe("23514");
    expect(entry.id).toBeDefined();
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-06-30")).toDecimalString()).toBe("1");
  });

  it("ARC-11: the rebuild stays in its space — another space's account is unknown, and its cache is untouched", async () => {
    const mine = await space();
    const theirs = await space();
    await ledger.post(
      theirs.householdId,
      input(
        { type: "transfer", from: theirs.cash.id, to: theirs.savings.id, amount: eur("9") },
        "2026-06-01",
      ),
    );
    const theirsBefore = await cacheRows(theirs.householdId);
    const versionsBefore = await versions(theirs.householdId);
    expect(await code(ledger.rebuildBalances(mine.householdId, theirs.savings.id))).toBe("UNKNOWN_ACCOUNT");
    expect(await code(ledger.rebuildBalances(mine.householdId, "not-a-uuid"))).toBe("UNKNOWN_ACCOUNT");
    expect(await ledger.rebuildBalances(mine.householdId)).toEqual({ accounts: 3, days: 0 });
    expect(await cacheRows(theirs.householdId)).toEqual(theirsBefore);
    expect(await versions(theirs.householdId)).toEqual(versionsBefore);
  });
});

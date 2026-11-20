import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountDirectory, PostingAccount } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { createImportedTransactions, type ImportedRowInput } from "../src/modules/transactions/index.ts";
import { leakText } from "./leak-text.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of #658 (IMP-04@PoC FR 5, FR 6 at apply time): the other transaction of a link (`mergeInto`,
 * `replaces`) is re-checked under its row lock in module transactions — another space's or another account's
 * transaction, a changed amount, one merged or with something merged into it, a manual one where a pending one is
 * named and the reverse: no link, nothing of the other transaction changes, the row is written on its own or (a key
 * match, `ifUnlinked: "skip"`) not at all. Called through the module's public write with a forged plan, as a caller
 * that names any id would. Synthetic data only.
 */
let db: RealModulesDatabase;
let audit: AuditLog;
const accountsOf = new Map<string, PostingAccount>();
const accounts: Pick<AccountDirectory, "postingAccount"> = {
  postingAccount: async (householdId, accountId) => accountsOf.get(`${householdId}/${accountId}`) ?? null,
};
const EUR = (a: string) => Money.of(a, "EUR");

interface Space {
  readonly householdId: string;
  readonly actorId: string;
  readonly eur: string;
  readonly sub: string;
  readonly eur2: string;
  readonly sub2: string;
}

async function openAccount(householdId: string) {
  const id = randomUUID();
  const sub = { subaccountId: randomUUID(), currency: "EUR", ledgerAccountId: randomUUID() };
  accountsOf.set(`${householdId}/${id}`, {
    accountId: id,
    kind: "current",
    status: "active",
    subaccounts: [sub],
  });
  await createLedger(db.databases.for("ledger")).openAccount(
    householdId,
    { module: "accounts", id: sub.subaccountId },
    { type: "asset", currency: "EUR", id: sub.ledgerAccountId },
  );
  return { id, sub: sub.subaccountId };
}

async function newSpace(): Promise<Space> {
  const actorId = randomUUID();
  const { householdId } = await householdSpaces(db).ensureFirstSpace({
    accountId: actorId,
    displayName: "Олена Синтетична",
  });
  const a = await openAccount(householdId);
  const b = await openAccount(householdId);
  return { householdId, actorId, eur: a.id, sub: a.sub, eur2: b.id, sub2: b.sub };
}

async function manual(householdId: string, accountId: string, sub: string, amount: string, extra = "") {
  const id = randomUUID();
  await db.owner.query(
    `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                            description, note ${extra ? ", merged_into, hidden" : ""})
     VALUES ($1, $2, $3, $4, $5, 'EUR', '2026-04-10', 'Обід', 'Синтетична нотатка' ${extra ? ", $6, true" : ""})`,
    extra ? [householdId, id, accountId, sub, amount, extra] : [householdId, id, accountId, sub, amount],
  );
  return id;
}

async function pending(householdId: string, accountId: string, sub: string, amount: string) {
  const id = randomUUID();
  await db.owner.query(
    `INSERT INTO transactions.transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                            description, status, source, import_batch_id, import_file_id, import_row,
                                            bank_description, review)
     VALUES ($1, $2, $3, $4, $5, 'EUR', '2026-04-08', 'HOLD SHOP', 'pending', 'imported', $6, $7, 3, 'HOLD SHOP', 'queued')`,
    [householdId, id, accountId, sub, amount, randomUUID(), randomUUID()],
  );
  return id;
}

interface Stored {
  id: string;
  account_id: string;
  hidden: boolean;
  merged_into: string | null;
  version: number;
  status: string;
  source: string;
}

async function stored(householdId: string): Promise<Stored[]> {
  const { rows } = await db.owner.query<Stored>(
    `SELECT id, account_id, hidden, merged_into, version, status, source FROM transactions.transactions
      WHERE household_id = $1 ORDER BY id`,
    [householdId],
  );
  return rows;
}

const transactions = () =>
  createImportedTransactions(db.databases.for("transactions"), {
    accounts,
    ledger: createLedger(db.databases.for("ledger")),
    audit,
    newId: randomUUID,
    now: () => Date.parse("2026-11-20T10:00:00Z"),
  });

/** One file's rows written with a forged plan; what `create` reported back. */
async function write(
  space: Space,
  accountId: string,
  link: Pick<ImportedRowInput, "mergeInto" | "replaces" | "ifUnlinked">,
  amount = "-42.00",
) {
  const fileId = randomUUID();
  let unlinked: readonly { fileId: string; row: number }[] = [];
  const result = await transactions().write(
    space.householdId,
    {
      batchId: randomUUID(),
      attemptId: randomUUID(),
      actorId: space.actorId,
      accountIds: [accountId],
      fileIds: [fileId],
    },
    async (context) => {
      ({ unlinked } = await context.create([
        {
          fileId,
          row: 1,
          accountId,
          amount: EUR(amount),
          date: "2026-04-11",
          description: "CAFE CENTRAL",
          counterparty: null,
          balanceAfter: null,
          ...link,
        },
      ]));
      return { import: 1 };
    },
  );
  return { result, unlinked, fileId };
}

beforeAll(async () => {
  db = await setupRealModules(4);
  audit = createAuditLog(db.databases.for("audit"));
});

afterAll(async () => {
  await db?.close();
});

describe("PR #658 security: a link only to a fitting transaction of the same space and account", () => {
  it("sec658: another space's manual transaction or pending one named — no link, nothing of the other space changes, no leak", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const theirs = await manual(b.householdId, b.eur, b.sub, "-42.00");
    const theirPending = await pending(b.householdId, b.eur, b.sub, "-42.00");
    const before = await stored(b.householdId);
    for (const link of [
      { mergeInto: theirs },
      { replaces: { transactionId: theirPending, amount: EUR("-42.00") } },
    ]) {
      const { unlinked } = await write(a, a.eur, link);
      expect(unlinked).toHaveLength(1);
    }
    expect(await stored(b.householdId)).toEqual(before);
    // Space A has its two rows, each on its own (shown, merged into nothing).
    const mine = await stored(a.householdId);
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => !r.hidden && r.merged_into === null)).toBe(true);
    // And never the other space's ids anywhere in A's rows.
    expect(leakText(JSON.stringify(mine))).not.toContain(theirs);
  });

  it("sec658: a manual transaction of another account of the same space — no link, it stays as it was", async () => {
    const s = await newSpace();
    const other = await manual(s.householdId, s.eur2, s.sub2, "-42.00");
    const { unlinked } = await write(s, s.eur, { mergeInto: other });
    expect(unlinked).toHaveLength(1);
    const all = await stored(s.householdId);
    expect(all.find((r) => r.id === other)).toMatchObject({ version: 1, hidden: false, merged_into: null });
    expect(all.filter((r) => r.merged_into !== null)).toEqual([]);
  });

  it("sec658: a pending one of another account named for a replacement — no link, it stays shown", async () => {
    const s = await newSpace();
    const other = await pending(s.householdId, s.eur2, s.sub2, "-42.00");
    const { unlinked } = await write(s, s.eur, { replaces: { transactionId: other, amount: EUR("-42.00") } });
    expect(unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).find((r) => r.id === other)).toMatchObject({
      version: 1,
      hidden: false,
      merged_into: null,
    });
  });
});

describe("PR #658 security: the re-check under the row lock", () => {
  it("sec658: a manual one of another amount — no link (a merge never hides a different operation)", async () => {
    const s = await newSpace();
    const m = await manual(s.householdId, s.eur, s.sub, "-42.00");
    const { unlinked } = await write(s, s.eur, { mergeInto: m }, "-42.01");
    expect(unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).filter((r) => r.merged_into !== null)).toEqual([]);
  });

  it("sec658: a manual one something is merged into already — no second link", async () => {
    const s = await newSpace();
    const m = await manual(s.householdId, s.eur, s.sub, "-42.00");
    await manual(s.householdId, s.eur, s.sub, "-42.00", m);
    const { unlinked } = await write(s, s.eur, { mergeInto: m });
    expect(unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).filter((r) => r.merged_into === m)).toHaveLength(1);
  });

  it("sec658: a manual one merged into another — no link to it", async () => {
    const s = await newSpace();
    const keep = await manual(s.householdId, s.eur, s.sub, "-42.00");
    const merged = await manual(s.householdId, s.eur, s.sub, "-42.00", keep);
    const { unlinked } = await write(s, s.eur, { mergeInto: merged });
    expect(unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).filter((r) => r.merged_into === merged)).toEqual([]);
  });

  it("sec658: a pending imported one named as `mergeInto`, a manual one named as `replaces` — no link either way", async () => {
    const s = await newSpace();
    const p = await pending(s.householdId, s.eur, s.sub, "-42.00");
    const m = await manual(s.householdId, s.eur, s.sub, "-42.00");
    expect((await write(s, s.eur, { mergeInto: p })).unlinked).toHaveLength(1);
    expect(
      (await write(s, s.eur, { replaces: { transactionId: m, amount: EUR("-42.00") } })).unlinked,
    ).toHaveLength(1);
    const all = await stored(s.householdId);
    expect(all.find((r) => r.id === p)).toMatchObject({ hidden: false, merged_into: null, version: 1 });
    expect(all.find((r) => r.id === m)).toMatchObject({ hidden: false, merged_into: null, version: 1 });
  });

  it("sec658: a manual one «Очікує» (not posted) named as `mergeInto` — no link", async () => {
    const s = await newSpace();
    const m = await manual(s.householdId, s.eur, s.sub, "-42.00");
    await db.owner.query(
      `UPDATE transactions.transactions SET status = 'pending' WHERE household_id = $1 AND id = $2`,
      [s.householdId, m],
    );
    expect((await write(s, s.eur, { mergeInto: m })).unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).filter((r) => r.merged_into === m)).toEqual([]);
  });

  it("sec658: a pending one replaced already (merged into its posted one) named again — no second replacement", async () => {
    const s = await newSpace();
    const p = await pending(s.householdId, s.eur, s.sub, "-30.00");
    const first = await write(s, s.eur, { replaces: { transactionId: p, amount: EUR("-30.00") } }, "-30.10");
    expect(first.unlinked).toEqual([]);
    const posted = (await stored(s.householdId)).find((r) => r.id !== p)!;
    const again = await write(s, s.eur, { replaces: { transactionId: p, amount: EUR("-30.00") } }, "-30.10");
    expect(again.unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).find((r) => r.id === p)).toMatchObject({
      merged_into: posted.id,
      version: 2,
    });
  });

  it("sec658: a shown, posted imported one of an earlier batch named as `mergeInto` — no link (only a manual one keeps a link)", async () => {
    const s = await newSpace();
    const earlier = await write(s, s.eur, {});
    expect(earlier.unlinked).toEqual([]);
    const imported = (await stored(s.householdId))[0]!;
    expect((await write(s, s.eur, { mergeInto: imported.id })).unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).filter((r) => r.merged_into !== null)).toEqual([]);
  });

  it("sec658: a manual one that is a side of a transfer — no link", async () => {
    const s = await newSpace();
    const out = await manual(s.householdId, s.eur, s.sub, "-42.00");
    const into = await manual(s.householdId, s.eur2, s.sub2, "42.00");
    const transferId = randomUUID();
    await db.owner.query(
      `INSERT INTO transactions.transfers (household_id, id, outflow_id, inflow_id) VALUES ($1, $2, $3, $4)`,
      [s.householdId, transferId, out, into],
    );
    await db.owner.query(
      `UPDATE transactions.transactions SET transfer_id = $2 WHERE household_id = $1 AND id IN ($3, $4)`,
      [s.householdId, transferId, out, into],
    );
    expect((await write(s, s.eur, { mergeInto: out })).unlinked).toHaveLength(1);
    expect((await stored(s.householdId)).filter((r) => r.merged_into !== null)).toEqual([]);
  });

  it("sec658: the pending one's amount changed after the plan — no replacement: the posted row written on its own, the pending one shown as it is", async () => {
    const s = await newSpace();
    const p = await pending(s.householdId, s.eur, s.sub, "-29.00");
    const { unlinked } = await write(
      s,
      s.eur,
      { replaces: { transactionId: p, amount: EUR("-30.00") } },
      "-30.10",
    );
    expect(unlinked).toHaveLength(1);
    const all = await stored(s.householdId);
    expect(all.find((r) => r.id === p)).toMatchObject({ hidden: false, merged_into: null, version: 1 });
    expect(all.filter((r) => r.status === "posted" && r.source === "imported" && !r.hidden)).toHaveLength(1);
  });

  it("sec658: a key match whose manual one no longer fits (`ifUnlinked: skip`) — nothing written, so nothing counts twice", async () => {
    const s = await newSpace();
    const m = await manual(s.householdId, s.eur, s.sub, "-42.00");
    await db.owner.query(
      `UPDATE transactions.transactions SET hidden = true WHERE household_id = $1 AND id = $2`,
      [s.householdId, m],
    );
    const { unlinked, result } = await write(s, s.eur, { mergeInto: m, ifUnlinked: "skip" });
    expect(unlinked).toHaveLength(1);
    expect(result.created).toBe(0);
    expect(await stored(s.householdId)).toHaveLength(1);
  });

  it("sec658: a link that fits — the manual one hidden, merged into the bank's row, which stays shown (#658 round 1: FR 5)", async () => {
    const s = await newSpace();
    const m = await manual(s.householdId, s.eur, s.sub, "-42.00");
    const { unlinked } = await write(s, s.eur, { mergeInto: m });
    expect(unlinked).toEqual([]);
    const all = await stored(s.householdId);
    const row = all.find((r) => r.source === "imported")!;
    expect(row).toMatchObject({ version: 1, hidden: false, merged_into: null });
    expect(all.find((r) => r.id === m)).toMatchObject({ version: 2, hidden: true, merged_into: row.id });
  });
});

describe("PR #658 security: the link rows' locks and a user's merge (lock order)", () => {
  // #658 round 1: the link rows are taken in id order; one below a row held already only without waiting (busy — no
  // link). Before, the apply was aborted with 40P01.
  it("sec658: two links of one apply (higher id first) and a user's merge that locks the same two rows in id order — neither is aborted as a deadlock", async () => {
    const s = await newSpace();
    const [lo, hi] = [
      await manual(s.householdId, s.eur, s.sub, "-42.00"),
      await manual(s.householdId, s.eur, s.sub, "-43.00"),
    ].sort();
    const amountOf = async (id: string) =>
      (
        await db.owner.query<{ amount: string }>(
          `SELECT trim_scale(amount)::text AS amount FROM transactions.transactions WHERE id = $1`,
          [id],
        )
      ).rows[0]!.amount;
    const [loAmount, hiAmount] = [await amountOf(lo!), await amountOf(hi!)];
    const fileId = randomUUID();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atGate = new Promise<void>((r) => (reached = r));
    const row = (n: number, mergeInto: string, amount: string): ImportedRowInput => ({
      fileId,
      row: n,
      accountId: s.eur,
      amount: EUR(amount),
      date: "2026-04-11",
      description: "CAFE CENTRAL",
      counterparty: null,
      balanceAfter: null,
      mergeInto,
    });
    let settled = false;
    const writing = transactions()
      .write(
        s.householdId,
        {
          batchId: randomUUID(),
          attemptId: randomUUID(),
          actorId: s.actorId,
          accountIds: [s.eur],
          fileIds: [fileId],
        },
        async (context) => {
          await context.create([row(1, hi!, hiAmount)]);
          reached();
          await gate;
          await context.create([row(2, lo!, loAmount)]);
          return { merge: 2 };
        },
      )
      .then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "error",
      )
      .finally(() => (settled = true));
    await atGate;
    // The user's merge of the two (lockBoth: both rows in the order of their ids), as a raw transaction.
    const client = db.owner;
    let userOutcome = "ok";
    await client.query("BEGIN");
    try {
      await client.query(`SELECT 1 FROM transactions.transactions WHERE id = $1 FOR UPDATE`, [lo]);
      release();
      for (let i = 0; i < 2000; i++) {
        const { rows } = await db.owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`,
        );
        // The apply never waits for `lo` now (it is below `hi`, held): it ends without that link.
        if (rows[0]!.n > 0 || settled) break;
        await new Promise((r) => setTimeout(r, 5));
      }
      await client.query(`SELECT 1 FROM transactions.transactions WHERE id = $1 FOR UPDATE`, [hi]);
      await client.query("COMMIT");
    } catch (e) {
      userOutcome = (e as { code?: string }).code ?? "error";
      await client.query("ROLLBACK");
    }
    expect([await writing, userOutcome]).toEqual(["ok", "ok"]);
    // The first link made; the second one's row was held by the user: no link, the bank's row written on its own.
    const all = await stored(s.householdId);
    expect(all.find((r) => r.id === hi)).toMatchObject({ hidden: true });
    expect(all.find((r) => r.id === lo)).toMatchObject({ hidden: false, merged_into: null, version: 1 });
  });
});

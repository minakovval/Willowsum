import {
  mergeIssue,
  merchantName,
  normalizeDescription,
  type Merchant,
  type MergeIssue,
  type NormalizedMerchant,
} from "../domain/index.ts";
import type { MerchantHandOff } from "./hand-off.ts";

/**
 * The merchants of a space (BUD-14@PoC FR 1–3, AC1, AC10, AC11, AC16; wave 2 row 22). A transaction belongs to module
 * transactions; its merchant is what its counterparty — the bank's description — normalizes to (FR 1), so this module
 * keeps no row per transaction: a merchant is born, once, for each match key the space's descriptions have, and a
 * merge or a rename changes that merchant only. The original description is never changed (FR 3).
 */

/** The space's transactions as this module reads them (module transactions' `TransactionTexts`). */
export interface TransactionTextsPort {
  counterparties(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  counterpartyCounts(
    householdId: string,
  ): Promise<readonly { readonly counterparty: string; readonly count: number }[]>;
}

/** The merchants schema in one transaction of the module, bound to one space (adapters/db/store.ts). */
export interface MerchantsTx {
  /** Births the merchants of `born` whose keys the space has none for yet; another writer's birth wins. */
  ensure(householdId: string, born: readonly NormalizedMerchant[]): Promise<void>;
  byKeys(householdId: string, keys: readonly string[]): Promise<ReadonlyMap<string, Merchant>>;
  byIds(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, Merchant>>;
  /** The rows of `ids`, locked for this transaction in the order of their ids. */
  lock(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, Merchant>>;
  /** The merchants that joined `id`, locked. */
  joined(householdId: string, id: string): Promise<readonly Merchant[]>;
  /** Every merchant of the space. */
  all(householdId: string): Promise<readonly Merchant[]>;
  rename(householdId: string, id: string, name: string, version: number): Promise<void>;
  point(householdId: string, id: string, mergedInto: string | null, version: number): Promise<void>;
  enqueueHandOff(householdId: string, handOff: MerchantHandOff): Promise<void>;
}

/** «Деталі транзакції» (FR 2): the merchant of a transaction. */
export interface TransactionMerchant {
  readonly transactionId: string;
  /** «Оригінальний опис: …» — the counterparty as the bank sent it (or the user typed it), never changed (FR 3). */
  readonly originalDescription: string | null;
  /** FR 1: «Канал: …» — the payment intermediary, or null. */
  readonly channel: string | null;
  /** The merchant shown; null — the transaction has no description to take one from. */
  readonly merchant: Merchant | null;
  /** FR 2, FR 3: the description's own merchant when it was joined into the one shown — «Роз'єднати»; else null. */
  readonly joinedFrom: Merchant | null;
}

async function resolve(tx: MerchantsTx, householdId: string, born: Merchant): Promise<Merchant> {
  if (born.mergedInto === null) return born;
  return (await tx.byIds(householdId, [born.mergedInto])).get(born.mergedInto) ?? born;
}

/**
 * FR 1, FR 2: the merchant of one transaction, from its counterparty. The merchant of a description seen for the first
 * time is born here (the same key later — the same merchant, FR 3 «нові транзакції … потрапляють до об'єднаного»).
 */
export async function merchantOfTransaction(
  tx: MerchantsTx,
  householdId: string,
  transactionId: string,
  counterparty: string | null,
): Promise<TransactionMerchant> {
  const normalized = normalizeDescription(counterparty);
  if (normalized === null)
    return {
      transactionId,
      originalDescription: counterparty,
      channel: null,
      merchant: null,
      joinedFrom: null,
    };
  await tx.ensure(householdId, [normalized]);
  const born = (await tx.byKeys(householdId, [normalized.key])).get(normalized.key)!;
  const shown = await resolve(tx, householdId, born);
  return {
    transactionId,
    originalDescription: counterparty,
    channel: normalized.channel,
    merchant: shown,
    joinedFrom: shown.id === born.id ? null : born,
  };
}

/**
 * The merchant each counterparty shows (FR 1, FR 3) — for another module that groups transactions by merchant (BUD-07
 * FR 1): the merchant a merge joined it into, else its own; a counterparty that normalizes to nothing is absent. The
 * merchant of a description seen for the first time is born, as when it is read here.
 */
export async function shownMerchants(
  tx: MerchantsTx,
  householdId: string,
  counterparties: readonly string[],
): Promise<ReadonlyMap<string, Merchant>> {
  const normalized = new Map<string, NormalizedMerchant>();
  for (const counterparty of new Set(counterparties)) {
    const n = normalizeDescription(counterparty);
    if (n !== null) normalized.set(counterparty, n);
  }
  const born = new Map([...normalized.values()].map((n) => [n.key, n]));
  await tx.ensure(householdId, [...born.values()]);
  const byKey = await tx.byKeys(householdId, [...born.keys()]);
  const roots = await tx.byIds(householdId, [
    ...new Set([...byKey.values()].flatMap((m) => (m.mergedInto === null ? [] : [m.mergedInto]))),
  ]);
  const shown = new Map<string, Merchant>();
  for (const [counterparty, n] of normalized) {
    const own = byKey.get(n.key)!;
    shown.set(counterparty, own.mergedInto === null ? own : (roots.get(own.mergedInto) ?? own));
  }
  return shown;
}

/** A merchant of the list «Об'єднати з…»: with how many shown transactions it has, its joined merchants' included. */
export interface ListedMerchant {
  readonly merchant: Merchant;
  readonly transactionCount: number;
}

/**
 * FR 3 «Об'єднати з…»: the space's merchants a merchant may join or be joined by — those that joined none — with their
 * transaction counts, by name. Every description of the space has its merchant born first, so a merchant with
 * transactions is never missing. `search` — a part of the name, any case.
 */
export async function listMerchants(
  tx: MerchantsTx,
  texts: TransactionTextsPort,
  householdId: string,
  search?: string,
): Promise<readonly ListedMerchant[]> {
  const counts = new Map<string, number>();
  const born = new Map<string, NormalizedMerchant>();
  for (const { counterparty, count } of await texts.counterpartyCounts(householdId)) {
    const normalized = normalizeDescription(counterparty);
    if (normalized === null) continue;
    born.set(normalized.key, normalized);
    counts.set(normalized.key, (counts.get(normalized.key) ?? 0) + count);
  }
  await tx.ensure(householdId, [...born.values()]);
  const merchants = await tx.all(householdId);
  const totals = new Map<string, number>();
  for (const m of merchants) {
    const root = m.mergedInto ?? m.id;
    totals.set(root, (totals.get(root) ?? 0) + (counts.get(m.key) ?? 0));
  }
  const needle = search?.trim().toLocaleLowerCase("uk") ?? "";
  return merchants
    .filter((m) => m.mergedInto === null)
    .filter((m) => needle.length === 0 || m.name.toLocaleLowerCase("uk").includes(needle))
    .map((merchant) => ({ merchant, transactionCount: totals.get(merchant.id) ?? 0 }))
    .sort(
      (a, b) =>
        a.merchant.name.localeCompare(b.merchant.name, "uk") || a.merchant.id.localeCompare(b.merchant.id),
    );
}

export type ChangeResult =
  | {
      readonly kind: "ok";
      readonly merchant: Merchant;
      readonly handOffs: readonly MerchantHandOff[];
    }
  | { readonly kind: "not-found" }
  /** The merchant joined another: only «Роз'єднати» changes it. */
  | { readonly kind: "merged" }
  | {
      readonly kind: "invalid";
      readonly field: "name" | "merchantId";
      readonly issue: "invalid" | "not_found" | MergeIssue;
    };

interface Actor {
  readonly householdId: string;
  readonly actorAccountId: string;
}

/**
 * FR 3 «Перейменувати мерчанта»: the space's name of a merchant — every transaction of it, and of the merchants that
 * joined it, shows the new name; the descriptions stay. A merchant that joined another is renamed through that one.
 */
export async function renameMerchant(
  tx: MerchantsTx,
  input: Actor & { readonly merchantId: string; readonly name: string },
): Promise<ChangeResult> {
  const name = merchantName(input.name);
  if (name === null) return { kind: "invalid", field: "name", issue: "invalid" };
  const current = (await tx.lock(input.householdId, [input.merchantId])).get(input.merchantId);
  if (!current) return { kind: "not-found" };
  if (current.mergedInto !== null) return { kind: "merged" };
  if (current.name === name) return { kind: "ok", merchant: current, handOffs: [] };
  const version = current.version + 1;
  await tx.rename(input.householdId, current.id, name, version);
  const handOff: MerchantHandOff = {
    merchantId: current.id,
    actorAccountId: input.actorAccountId,
    version,
    change: "rename",
    mergedInto: { before: null, after: null },
  };
  await tx.enqueueHandOff(input.householdId, handOff);
  return { kind: "ok", merchant: { ...current, name, version }, handOffs: [handOff] };
}

/**
 * FR 3, AC1 «Об'єднати з…»: `sourceId` joins `targetId`, whose name every transaction of both shows; new transactions
 * with the source's descriptions show it too (their key is the source's). The merchants that had joined the source join
 * the target directly — no chains, so «Роз'єднати» on any of them gives exactly that one back.
 */
export async function mergeMerchants(
  tx: MerchantsTx,
  input: Actor & { readonly targetId: string; readonly sourceId: string },
): Promise<ChangeResult> {
  const locked = await tx.lock(input.householdId, [input.targetId, input.sourceId]);
  const target = locked.get(input.targetId);
  if (!target) return { kind: "not-found" };
  if (target.mergedInto !== null) return { kind: "merged" };
  const source = locked.get(input.sourceId);
  if (!source) return { kind: "invalid", field: "merchantId", issue: "not_found" };
  const issue = mergeIssue(target, source);
  if (issue !== null) return { kind: "invalid", field: "merchantId", issue };
  const handOffs: MerchantHandOff[] = [];
  for (const m of [source, ...(await tx.joined(input.householdId, source.id))]) {
    const version = m.version + 1;
    await tx.point(input.householdId, m.id, target.id, version);
    const handOff: MerchantHandOff = {
      merchantId: m.id,
      actorAccountId: input.actorAccountId,
      version,
      change: "merge",
      mergedInto: { before: m.mergedInto, after: target.id },
    };
    await tx.enqueueHandOff(input.householdId, handOff);
    handOffs.push(handOff);
  }
  return { kind: "ok", merchant: target, handOffs };
}

/**
 * FR 3, AC16, edge case «Різних мерчантів помилково об'єднано»: «Роз'єднати» — the merchant that joined another is its
 * own again, with its own name and every transaction of its descriptions. Always available; on a merchant that joined
 * none it changes nothing.
 */
export async function unmergeMerchant(
  tx: MerchantsTx,
  input: Actor & { readonly merchantId: string },
): Promise<ChangeResult> {
  const current = (await tx.lock(input.householdId, [input.merchantId])).get(input.merchantId);
  if (!current) return { kind: "not-found" };
  if (current.mergedInto === null) return { kind: "ok", merchant: current, handOffs: [] };
  const version = current.version + 1;
  await tx.point(input.householdId, current.id, null, version);
  const handOff: MerchantHandOff = {
    merchantId: current.id,
    actorAccountId: input.actorAccountId,
    version,
    change: "unmerge",
    mergedInto: { before: current.mergedInto, after: null },
  };
  await tx.enqueueHandOff(input.householdId, handOff);
  return { kind: "ok", merchant: { ...current, mergedInto: null, version }, handOffs: [handOff] };
}

import { AUDIT_MASK } from "../../audit/index.ts";
import { noteText, tagKey, tagName, tagNames, type FieldIssue } from "../domain/index.ts";
import {
  changeRow,
  type Caller,
  type TransactionResult,
  type TransactionsDeps,
  type TransactionsTx,
} from "./transactions.ts";
import type { TagAudit } from "./hand-off.ts";

/**
 * The attributes of a transaction (BUD-13@PoC FR 1, FR 2, FR 5; wave 2 row 21): «Нотатка» and «Теги», and the space's
 * tags — renamed (onto another's name: merged), deleted from every transaction. No flags (FR 3) and no attachments
 * (FR 4) in this release.
 *
 * Locks, always in this order: the tags (`TagsTx.ensure` and `lockTags`, in the order of their ids), then the
 * transaction rows. A tag is attached only while its row is locked for share, and renamed, merged or deleted only while
 * it is locked for update, so a deleted tag is never left on a transaction.
 *
 * A change of one transaction's attributes is an `update` of the transaction with its hand-off (application/hand-off.ts:
 * the audit entry with `note` masked and `tags` as their ids; the journal unchanged). A change of a tag is its own audit
 * entry `transactions.tag` (job `transactions.tag-audit`), and each transaction that carried the tag gets a new version
 * (a bulk action's «Відмінити» does not restore one changed since, DAT-03 FR 9).
 */

export interface Tag {
  readonly id: string;
  readonly name: string;
  readonly version: number;
}

export interface TagsTx {
  /**
   * The space's tags of `names` by their keys, created when missing (with the name given), each locked for share until
   * the transaction ends; the map is by key.
   */
  ensure(householdId: string, names: readonly string[], newId: () => string): Promise<Map<string, Tag>>;
  /** The names of `ids` that are tags of the space (no lock); missing ids are absent. */
  names(householdId: string, ids: readonly string[]): Promise<Map<string, string>>;
  /** The tags `ids` of the space, locked for update in the order of their ids; missing ids are absent. */
  lockTags(householdId: string, ids: readonly string[]): Promise<Map<string, Tag>>;
  /** The tag of the space with this key (no lock), or null. */
  byKey(householdId: string, key: string): Promise<Tag | null>;
  rename(householdId: string, id: string, name: string, key: string): Promise<Tag>;
  /**
   * Every transaction of the space with the tag `fromId`: it is replaced by `toId` (kept once) or, with null, removed;
   * each such transaction gets a new version. Returns how many.
   */
  retag(householdId: string, fromId: string, toId: string | null): Promise<number>;
  remove(householdId: string, id: string): Promise<void>;
  /** ARC-04 FR 2: the tag change's audit entry, enqueued in this transaction. */
  enqueueTagAudit(householdId: string, entry: TagAudit): Promise<void>;
}

/** The fields of «Нотатка» and «Теги» that were sent; absent ones keep their value. */
export interface AttributesChange {
  /** null or empty removes the note. */
  readonly note?: string | null | undefined;
  /** The transaction's tags by name, replacing its tags; [] removes them. */
  readonly tags?: readonly string[] | undefined;
}

/**
 * The transaction's tags as the space's tag ids: the names checked (FR 2), each tag found by its key or created, in
 * the order given; at most 20.
 */
export async function resolveTags(
  tags: TagsTx,
  householdId: string,
  names: readonly string[],
  newId: () => string,
): Promise<string[] | FieldIssue> {
  const checked = tagNames(names);
  if ("issue" in checked) return checked.issue;
  const byKey = await tags.ensure(householdId, checked.names, newId);
  return checked.names.map((n) => byKey.get(tagKey(n))!.id);
}

/** «Зберегти» of «Нотатка» and «Теги» in the transaction's details (FR 1, FR 2, AC1). */
export async function setAttributes(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  tags: TagsTx,
  caller: Caller,
  id: string,
  change: AttributesChange,
): Promise<TransactionResult> {
  const issues: FieldIssue[] = [];
  const note = change.note === undefined || change.note === null ? change.note : noteText(change.note);
  if (note === undefined && change.note !== undefined) issues.push({ field: "note", issue: "invalid" });
  const checked = change.tags === undefined ? undefined : tagNames(change.tags);
  if (checked && "issue" in checked) issues.push(checked.issue);
  if (issues.length > 0) return { kind: "invalid", issues };
  // Before any tag is created: a transaction that is not there (or not to be changed) creates none.
  const seen = await tx.find(caller.householdId, id);
  if (!seen) return { kind: "not-found" };
  if (seen.mergedInto !== null) return { kind: "merged" };
  // The tags locked before the row (the order of every tag change, see above).
  const tagIds =
    change.tags === undefined
      ? undefined
      : await resolveTags(tags, caller.householdId, change.tags, deps.newId);
  if (tagIds !== undefined && !Array.isArray(tagIds)) return { kind: "invalid", issues: [tagIds] };
  return changeRow(deps, tx, caller, id, "update", (current) => {
    const next = {
      ...current,
      note: change.note === undefined ? current.note : (note ?? null),
      tagIds: tagIds ?? current.tagIds,
    };
    const same =
      next.note === current.note &&
      next.tagIds.length === current.tagIds.length &&
      next.tagIds.every((t, i) => t === current.tagIds[i]);
    return same ? null : next;
  });
}

export type TagResult =
  | { readonly kind: "ok"; readonly tag: Tag; readonly audit: readonly TagAudit[] }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  | { readonly kind: "not-found" };

/**
 * «Перейменувати» a tag (FR 2): onto a name no other tag of the space has (without regard to case) — the tag's new name;
 * onto another tag's name — the two are merged: that tag stays, every transaction of this one gets it (once), this one
 * goes. The same name — nothing.
 */
export async function renameTag(tags: TagsTx, caller: Caller, id: string, text: string): Promise<TagResult> {
  const name = tagName(text);
  if (name === undefined) return { kind: "invalid", issues: [{ field: "name", issue: "invalid" }] };
  const other = await tags.byKey(caller.householdId, tagKey(name));
  const locked = await tags.lockTags(caller.householdId, other && other.id !== id ? [id, other.id] : [id]);
  const tag = locked.get(id);
  if (!tag) return { kind: "not-found" };
  // The other tag, if it still has the name now that it is locked (it may have been renamed away meanwhile).
  const lockedOther = other && other.id !== id ? locked.get(other.id) : undefined;
  const target = lockedOther && tagKey(lockedOther.name) === tagKey(name) ? lockedOther : undefined;
  const actorAccountId = caller.accountId;
  if (!target) {
    // The other tag went meanwhile, or none has the name: a rename (the case may change, FR 2).
    if (tag.name === name) return { kind: "ok", tag, audit: [] };
    const renamed = await tags.rename(caller.householdId, id, name, tagKey(name));
    await tags.retag(caller.householdId, id, id);
    const entry: TagAudit = {
      tagId: id,
      actorAccountId,
      action: "update",
      key: `transactions.tag.rename:${id}:${renamed.version}`,
      changes: [{ field: "name", before: AUDIT_MASK, after: AUDIT_MASK, sensitive: true }],
    };
    await tags.enqueueTagAudit(caller.householdId, entry);
    return { kind: "ok", tag: renamed, audit: [entry] };
  }
  const moved = await tags.retag(caller.householdId, id, target.id);
  await tags.remove(caller.householdId, id);
  const entry: TagAudit = {
    tagId: id,
    actorAccountId,
    action: "delete",
    key: `transactions.tag.merge:${id}:${tag.version}`,
    changes: [
      { field: "name", before: AUDIT_MASK, after: null, sensitive: true },
      { field: "mergedInto", before: null, after: target.id, sensitive: false },
      { field: "transactions", before: String(moved), after: null, sensitive: false },
    ],
  };
  await tags.enqueueTagAudit(caller.householdId, entry);
  return { kind: "ok", tag: target, audit: [entry] };
}

/** «Видалити тег» (FR 2, AC6): after the confirmation with the count, the tag is taken off every transaction. */
export async function deleteTag(
  tags: TagsTx,
  caller: Caller,
  id: string,
): Promise<
  { readonly kind: "ok"; readonly removed: number; readonly audit: TagAudit } | { readonly kind: "not-found" }
> {
  const tag = (await tags.lockTags(caller.householdId, [id])).get(id);
  if (!tag) return { kind: "not-found" };
  const removed = await tags.retag(caller.householdId, id, null);
  await tags.remove(caller.householdId, id);
  const audit: TagAudit = {
    tagId: id,
    actorAccountId: caller.accountId,
    action: "delete",
    key: `transactions.tag.delete:${id}:${tag.version}`,
    changes: [
      { field: "name", before: AUDIT_MASK, after: null, sensitive: true },
      { field: "transactions", before: String(removed), after: null, sensitive: false },
    ],
  };
  await tags.enqueueTagAudit(caller.householdId, audit);
  return { kind: "ok", removed, audit };
}

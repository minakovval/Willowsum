import { unsafeText, type Recipe, type RecipeError } from "../domain/index.ts";
import { validateRecipe } from "./validate.ts";

/**
 * Parsing recipes of a space (IMP-06@PoC FR 1, FR 2, FR 3, FR 7, FR 14; wave 2 row 40 part 2): a recipe is saved only
 * whole and valid — its schema and limits, the safe dialect of its patterns, no control character in any of its texts
 * or its name (#607 item 5) — and is read or deleted only in its own space. The account binding's value (an IBAN, an
 * account number or a mask) is sealed with the space's key and kept apart from the recipe (NFR-01 FR 6). Every save
 * and deletion enqueues its audit hand-off in the same transaction (ADR-0015); the entry never holds the name or the
 * recipe's content. Applying a recipe to a file is not here: the parse worker does it (row 41).
 */
export interface StoredRecipe {
  readonly id: string;
  readonly householdId: string;
  readonly name: string;
  /** IMP-07 FR 1: the account of the space the template is for (scope «рахунок»), or null (scope «простір»). */
  readonly accountId: string | null;
  /** IMP-07 FR 2, FR 3: 1 when saved, one more with every save and restore. */
  readonly version: number;
  readonly schemaVersion: number;
  /** The recipe without `account.value`. */
  readonly recipe: Recipe;
  readonly accountValueSealed: string | null;
  readonly accountValueLast4: string | null;
  readonly fingerprint: string | null;
  /** IMP-07 FR 13: how many parses used the template, and when last. */
  readonly useCount: number;
  readonly lastUsedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** IMP-07 FR 1: «простір» or «рахунок». */
export type TemplateScope = "space" | "account";

/** A kept version of a template (IMP-07 FR 2). */
export interface StoredVersion {
  readonly recipeId: string;
  readonly version: number;
  readonly name: string;
  readonly accountId: string | null;
  readonly schemaVersion: number;
  readonly recipe: Recipe;
  readonly accountValueSealed: string | null;
  readonly accountValueLast4: string | null;
  readonly fingerprint: string | null;
  readonly savedBy: string;
  readonly savedAt: Date;
}

/**
 * IMP-07@PoC FR 2, AC9: a space holds at most 100 templates (a saved recipe is a template). The same for every plan,
 * no feature key of its own (`data.import`): 422 LIMIT_REACHED, never 402. Before IMP-07 the technical ceiling was 200
 * (lead decision 2026-11-19); the requirement's own number replaces it.
 */
export const RECIPES_PER_SPACE = 100;
/** IMP-07 FR 2: the last 20 versions of a template are kept. */
export const TEMPLATE_VERSIONS_KEPT = 20;
export const RECIPE_NAME_MAX = 120;
/** The sealed field of the account binding's value (household's space keys). */
export const ACCOUNT_VALUE_FIELD = "importRecipes.accountValue";

export const RECIPE_ENTITY = "import-recipes.recipe" as const;
export const HAND_OFF_ACTIONS = ["create", "update", "delete"] as const;

/** The audit entry of a recipe's change, carried by the hand-off job: ids, versions and counts only. */
export interface RecipeHandOff {
  readonly entityId: string;
  readonly actorAccountId: string;
  readonly action: (typeof HAND_OFF_ACTIONS)[number];
  readonly changeId: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}

export const handOffKey = (h: RecipeHandOff): string =>
  `${RECIPE_ENTITY}:${h.action}:${h.entityId}:${h.changeId}`;

export interface RecipesTx {
  /** Serialises the space's saves for the rest of the transaction (the ceiling is counted under it). */
  lockSpace(): Promise<void>;
  count(): Promise<number>;
  insert(recipe: StoredRecipe): Promise<void>;
  /** Writes the template's new state when its version is still `expectedVersion`; false — it changed. */
  update(recipe: StoredRecipe, expectedVersion: number): Promise<boolean>;
  /** Whether another template of the space has this name (without case) in the same scope (FR 2). */
  nameTaken(name: string, accountId: string | null, exceptId?: string): Promise<boolean>;
  insertVersion(version: StoredVersion): Promise<void>;
  /** Drops the template's versions up to and including `upTo` (FR 2: only the last 20 are kept). */
  pruneVersions(recipeId: string, upTo: number): Promise<void>;
  /** The template's kept versions, newest first. */
  versions(recipeId: string, limit: number): Promise<StoredVersion[]>;
  findVersion(recipeId: string, version: number): Promise<StoredVersion | null>;
  find(id: string): Promise<StoredRecipe | null>;
  /**
   * IMP-07 FR 6: the template to apply to a file of this format — of scope «рахунок» for the file's account first, then
   * of scope «простір», the most recently updated; never another account's, never a stale one (FR 5), or null.
   */
  forFormat(fingerprint: string, accountId: string | null): Promise<StoredRecipe | null>;
  /** FR 13: one more use of the template by this parse (the same parse again counts once). */
  recordUse(id: string, parseId: string, at: Date): Promise<void>;
  /** The space's recipes, newest first, after the cursor's recipe. */
  list(limit: number, after?: { readonly createdAt: Date; readonly id: string }): Promise<StoredRecipe[]>;
  /** The deleted recipe, or null when the space has none with this id. */
  remove(id: string): Promise<StoredRecipe | null>;
  enqueueHandOff(handOff: RecipeHandOff): Promise<void>;
}

/** A transaction of the module bound to the caller's space. */
export type SpaceTx = <T>(work: (tx: RecipesTx) => Promise<T>) => Promise<T>;

export interface RecipesDeps {
  readonly newId: () => string;
  readonly now: () => Date;
  /** The space's key (household): seals the account binding's value. */
  readonly seal: (householdId: string, field: string, plaintext: string) => Promise<string>;
  /** IMP-07 FR 1: the status of an account of the space (accounts), null — none such; without it no account scope. */
  readonly accountStatus?: (householdId: string, accountId: string) => Promise<"active" | "closed" | null>;
}

export interface Handed<R> {
  readonly result: R;
  readonly handOffs: readonly RecipeHandOff[];
}

export class RecipeNotFoundError extends Error {
  constructor() {
    super("Recipe not found");
    this.name = "RecipeNotFoundError";
  }
}

/** The recipe is not valid (FR 2, FR 3, FR 14): each error with its code and the field's path. */
export class RecipeRejectedError extends Error {
  readonly errors: readonly RecipeError[];
  constructor(errors: readonly RecipeError[]) {
    super(`Recipe rejected: ${errors.map((e) => e.code).join(", ")}`);
    this.name = "RecipeRejectedError";
    this.errors = errors;
  }
}

/** FR 3: the template changed since the version the save was made from («Шаблон змінено, оновіть»). */
export class TemplateChangedError extends Error {
  readonly currentVersion: number;
  constructor(currentVersion: number) {
    super("Template changed");
    this.name = "TemplateChangedError";
    this.currentVersion = currentVersion;
  }
}

/** FR 2: another template of the same scope has this name. */
export class TemplateNameTakenError extends Error {
  constructor() {
    super("Template name taken");
    this.name = "TemplateNameTakenError";
  }
}

/** FR 2: the template keeps no such version (older than the last 20, or never saved). */
export class TemplateVersionNotFoundError extends Error {
  constructor() {
    super("Template version not found");
    this.name = "TemplateVersionNotFoundError";
  }
}

/** FR 1: the template's account is not an account of this space. */
export class TemplateAccountNotFoundError extends Error {
  constructor() {
    super("Template account not found");
    this.name = "TemplateAccountNotFoundError";
  }
}

/** FR 1: the template's account is closed. */
export class TemplateAccountClosedError extends Error {
  constructor() {
    super("Template account closed");
    this.name = "TemplateAccountClosedError";
  }
}

/** The space holds `RECIPES_PER_SPACE` recipes already. */
export class RecipeCeilingError extends Error {
  readonly limit = RECIPES_PER_SPACE;
  constructor() {
    super("Recipe ceiling reached");
    this.name = "RecipeCeilingError";
  }
}

const FINGERPRINT = /^fp1:[0-9a-f]{64}$/;

/**
 * The last 4 characters of the value, spaces dropped: how it is shown (NFR-01 FR 6). A value of 4 characters or fewer
 * is never shown whole («*»); whole characters, so a pair of surrogates is never cut.
 */
export function accountValueLast4(value: string): string {
  const characters = [...value.replace(/\s+/g, "")];
  return characters.length > 4 ? characters.slice(-4).join("") : "*";
}

/** What a save of a template brings (FR 1–4): the recipe whole, its scope's account (null — «простір»). */
export interface TemplateInput {
  readonly name: string;
  readonly recipe: unknown;
  readonly fingerprint: string | null;
  /** The account of the space the template is for (scope «рахунок»), or null for the space's scope. */
  readonly accountId: string | null;
}

/** A recipe checked whole with its account value split off and sealed; `keep` — the stored value stays. */
interface Prepared {
  readonly name: string;
  readonly recipe: Recipe;
  readonly schemaVersion: number;
  readonly sealed: { readonly value: string; readonly last4: string } | null | "keep";
}

const BOUND_BY: ReadonlySet<string> = new Set(["iban", "account-number", "mask"]);

function checkName(raw: string): string {
  const name = raw.trim();
  if (unsafeText(name)) throw new RecipeRejectedError([{ code: "INVALID_CHARACTER", path: "name" }]);
  if (name.length < 1 || name.length > RECIPE_NAME_MAX)
    throw new RecipeRejectedError([{ code: "INVALID_VALUE", path: "name" }]);
  return name;
}

/**
 * The recipe checked whole (IMP-06 FR 2, FR 14) and its account binding's value sealed. On an update the editor shows
 * the value only masked, so a recipe that binds the same way without a value keeps the stored sealed value (`keep`).
 */
async function prepare(
  deps: RecipesDeps,
  householdId: string,
  input: Pick<TemplateInput, "name" | "recipe" | "fingerprint">,
  stored?: StoredRecipe,
): Promise<Prepared> {
  const name = checkName(input.name);
  if (input.fingerprint !== null && !FINGERPRINT.test(input.fingerprint))
    throw new RecipeRejectedError([{ code: "INVALID_VALUE", path: "fingerprint" }]);
  const checked = validateRecipe(input.recipe);
  const keepsValue = (by: string | undefined): boolean =>
    stored !== undefined &&
    stored.accountValueSealed !== null &&
    by !== undefined &&
    BOUND_BY.has(by) &&
    stored.recipe.account?.by === by;
  if (!checked.ok) {
    const errors = checked.errors.filter(
      (e) =>
        !(e.code === "INCOMPLETE_RULE" && e.path === "account.value" && keepsValue(accountBy(input.recipe))),
    );
    if (errors.length > 0) throw new RecipeRejectedError(errors);
    const again = validateRecipe(withPlaceholder(input.recipe));
    if (!again.ok) throw new RecipeRejectedError(again.errors);
    return { name, ...split(again.recipe), sealed: "keep" };
  }
  const value = checked.recipe.account?.value;
  const parts = split(checked.recipe);
  if (value === undefined) return { name, ...parts, sealed: null };
  const sealedValue = await deps.seal(householdId, ACCOUNT_VALUE_FIELD, value);
  return { name, ...parts, sealed: { value: sealedValue, last4: accountValueLast4(value) } };
}

const PLACEHOLDER = "0000";

function asObject(value: unknown): Record<string, unknown> | null {
  let v = value;
  if (typeof value === "string") {
    try {
      v = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function accountBy(recipe: unknown): string | undefined {
  const account = asObject(recipe)?.account;
  const by = account !== null && typeof account === "object" ? (account as { by?: unknown }).by : undefined;
  return typeof by === "string" ? by : undefined;
}

/** The same recipe with a placeholder account value: only to check it whole; the placeholder is dropped by `split`. */
function withPlaceholder(recipe: unknown): unknown {
  const value = asObject(recipe)!;
  return { ...value, account: { ...(value.account as object), value: PLACEHOLDER } };
}

/** The recipe without `account.value` (kept only sealed, NFR-01 FR 6). */
function split(recipe: Recipe): { readonly recipe: Recipe; readonly schemaVersion: number } {
  if (recipe.account?.value === undefined) return { recipe, schemaVersion: recipe.schemaVersion };
  const account = { ...recipe.account };
  delete account.value;
  return { recipe: { ...recipe, account }, schemaVersion: recipe.schemaVersion };
}

/** FR 13: what the audit entry of a template's change holds — versions and counts, never the name or the rules. */
function changesOf(before: StoredRecipe | null, after: StoredRecipe): RecipeHandOff["changes"] {
  return [
    { field: "version", before: before ? String(before.version) : null, after: String(after.version) },
    {
      field: "schemaVersion",
      before: before ? String(before.schemaVersion) : null,
      after: String(after.schemaVersion),
    },
    {
      field: "columnRules",
      before: before ? String(before.recipe.columns?.length ?? 0) : null,
      after: String(after.recipe.columns?.length ?? 0),
    },
    { field: "scope", before: before ? scopeOf(before) : null, after: scopeOf(after) },
  ];
}

export const scopeOf = (r: Pick<StoredRecipe, "accountId">): TemplateScope =>
  r.accountId === null ? "space" : "account";

/** FR 2: a name is unique within its scope (the space's, or one account's); compared without case. */
async function claimName(tx: RecipesTx, name: string, accountId: string | null, exceptId?: string) {
  if (await tx.nameTaken(name, accountId, exceptId)) throw new TemplateNameTakenError();
}

/** FR 1: a template of scope «рахунок» is for an account of this space (another's or an unknown one — not found). */
async function checkAccount(deps: RecipesDeps, householdId: string, accountId: string | null) {
  if (accountId === null) return;
  const status = deps.accountStatus ? await deps.accountStatus(householdId, accountId) : null;
  if (status === null) throw new TemplateAccountNotFoundError();
  if (status !== "active") throw new TemplateAccountClosedError();
}

/** FR 3: a save names the version it was made from; another window's save in between refuses it. */
function checkVersion(stored: StoredRecipe, expectedVersion: number): void {
  if (stored.version !== expectedVersion) throw new TemplateChangedError(stored.version);
}

/** The version row of a template as saved now (FR 2). */
const versionOf = (r: StoredRecipe, savedBy: string, savedAt: Date): StoredVersion => ({
  recipeId: r.id,
  version: r.version,
  name: r.name,
  accountId: r.accountId,
  schemaVersion: r.schemaVersion,
  recipe: r.recipe,
  accountValueSealed: r.accountValueSealed,
  accountValueLast4: r.accountValueLast4,
  fingerprint: r.fingerprint,
  savedBy,
  savedAt,
});

async function writeVersion(tx: RecipesTx, r: StoredRecipe, savedBy: string, savedAt: Date): Promise<void> {
  await tx.insertVersion(versionOf(r, savedBy, savedAt));
  await tx.pruneVersions(r.id, r.version - TEMPLATE_VERSIONS_KEPT);
}

/** «Зберегти як шаблон» (IMP-06 FR 1; IMP-07 FR 1–4): checked whole, the account value sealed, version 1. */
export async function saveRecipe(
  deps: RecipesDeps,
  run: SpaceTx,
  actor: { readonly actorId: string; readonly householdId: string },
  input: TemplateInput,
): Promise<Handed<StoredRecipe>> {
  const prepared = await prepare(deps, actor.householdId, input);
  await checkAccount(deps, actor.householdId, input.accountId);
  const sealed = prepared.sealed === "keep" ? null : prepared.sealed;
  return run(async (tx) => {
    await tx.lockSpace();
    if ((await tx.count()) >= RECIPES_PER_SPACE) throw new RecipeCeilingError();
    await claimName(tx, prepared.name, input.accountId);
    const now = deps.now();
    const stored: StoredRecipe = {
      id: deps.newId(),
      householdId: actor.householdId,
      name: prepared.name,
      accountId: input.accountId,
      version: 1,
      schemaVersion: prepared.schemaVersion,
      recipe: prepared.recipe,
      accountValueSealed: sealed?.value ?? null,
      accountValueLast4: sealed?.last4 ?? null,
      fingerprint: input.fingerprint,
      useCount: 0,
      lastUsedAt: null,
      createdBy: actor.actorId,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(stored);
    await writeVersion(tx, stored, actor.actorId, now);
    const handOff: RecipeHandOff = {
      entityId: stored.id,
      actorAccountId: actor.actorId,
      action: "create",
      changeId: deps.newId(),
      changes: changesOf(null, stored),
    };
    await tx.enqueueHandOff(handOff);
    return { result: stored, handOffs: [handOff] };
  });
}

/**
 * «Зберегти» an edited template (FR 2, FR 3): the version the editor was opened with must still be the current one,
 * else 409 «Шаблон змінено, оновіть»; the save is the next version, the oldest past the last 20 goes. Saving a stale
 * template with the current schema makes it applicable again (FR 5). `fingerprint` and `accountId` left undefined stay.
 */
export async function updateTemplate(
  deps: RecipesDeps,
  run: SpaceTx,
  actor: { readonly actorId: string; readonly householdId: string },
  id: string,
  input: Omit<TemplateInput, "fingerprint" | "accountId"> & {
    readonly fingerprint?: string | null;
    readonly accountId?: string | null;
    readonly expectedVersion: number;
  },
): Promise<Handed<StoredRecipe>> {
  // The stored template is read first only to keep its sealed value; the version is checked again under the lock.
  const current = await run((tx) => tx.find(id));
  if (!current) throw new RecipeNotFoundError();
  checkVersion(current, input.expectedVersion);
  const fingerprint = input.fingerprint === undefined ? current.fingerprint : input.fingerprint;
  const accountId = input.accountId === undefined ? current.accountId : input.accountId;
  const prepared = await prepare(deps, actor.householdId, { ...input, fingerprint }, current);
  if (accountId !== current.accountId) await checkAccount(deps, actor.householdId, accountId);
  return run(async (tx) => {
    await tx.lockSpace();
    const before = await tx.find(id);
    if (!before) throw new RecipeNotFoundError();
    checkVersion(before, input.expectedVersion);
    if (prepared.sealed === "keep" && before.accountValueSealed !== current.accountValueSealed)
      throw new TemplateChangedError(before.version);
    await claimName(tx, prepared.name, accountId, id);
    const now = deps.now();
    const kept = prepared.sealed === "keep";
    const sealed = kept ? null : prepared.sealed;
    const after: StoredRecipe = {
      ...before,
      name: prepared.name,
      accountId,
      version: before.version + 1,
      schemaVersion: prepared.schemaVersion,
      recipe: prepared.recipe,
      accountValueSealed: kept ? before.accountValueSealed : (sealed?.value ?? null),
      accountValueLast4: kept ? before.accountValueLast4 : (sealed?.last4 ?? null),
      fingerprint,
      updatedAt: now,
    };
    if (!(await tx.update(after, before.version))) throw new TemplateChangedError(before.version);
    await writeVersion(tx, after, actor.actorId, now);
    const handOff: RecipeHandOff = {
      entityId: after.id,
      actorAccountId: actor.actorId,
      action: "update",
      changeId: deps.newId(),
      changes: changesOf(before, after),
    };
    await tx.enqueueHandOff(handOff);
    return { result: after, handOffs: [handOff] };
  });
}

/**
 * «Відновити» a kept version (FR 2, AC11): its recipe, sealed account value and fingerprint become the template's next
 * version; the name and the scope stay the current ones. Needs the current version too (FR 3).
 */
export async function restoreTemplateVersion(
  deps: Pick<RecipesDeps, "newId" | "now">,
  run: SpaceTx,
  actorId: string,
  id: string,
  input: { readonly version: number; readonly expectedVersion: number },
): Promise<Handed<StoredRecipe>> {
  return run(async (tx) => {
    await tx.lockSpace();
    const before = await tx.find(id);
    if (!before) throw new RecipeNotFoundError();
    checkVersion(before, input.expectedVersion);
    // A version above the current one was never saved (and may not fit the column's integer): not found.
    const old = input.version <= before.version ? await tx.findVersion(id, input.version) : null;
    if (!old) throw new TemplateVersionNotFoundError();
    const now = deps.now();
    const after: StoredRecipe = {
      ...before,
      version: before.version + 1,
      schemaVersion: old.schemaVersion,
      recipe: old.recipe,
      accountValueSealed: old.accountValueSealed,
      accountValueLast4: old.accountValueLast4,
      fingerprint: old.fingerprint,
      updatedAt: now,
    };
    if (!(await tx.update(after, before.version))) throw new TemplateChangedError(before.version);
    await writeVersion(tx, after, actorId, now);
    const handOff: RecipeHandOff = {
      entityId: after.id,
      actorAccountId: actorId,
      // The audit log knows create, update and delete: a restore is an update naming the restored version.
      action: "update",
      changeId: deps.newId(),
      changes: [
        ...changesOf(before, after).slice(0, 3),
        { field: "restoredVersion", before: null, after: String(old.version) },
      ],
    };
    await tx.enqueueHandOff(handOff);
    return { result: after, handOffs: [handOff] };
  });
}

/** The kept versions of a template, newest first (FR 2); another space's template is «not found». */
export async function templateVersions(tx: RecipesTx, id: string): Promise<StoredVersion[]> {
  if (!(await tx.find(id))) throw new RecipeNotFoundError();
  return tx.versions(id, TEMPLATE_VERSIONS_KEPT);
}

/** One recipe of the space; another space's or an unknown one is «not found». */
export async function viewRecipe(tx: RecipesTx, id: string): Promise<StoredRecipe> {
  const found = await tx.find(id);
  if (!found) throw new RecipeNotFoundError();
  return found;
}

/** «Видалити рецепт»: the row goes with its sealed value; the audit hand-off in the same transaction. */
export async function deleteRecipe(
  deps: Pick<RecipesDeps, "newId">,
  run: SpaceTx,
  actorId: string,
  id: string,
): Promise<Handed<null>> {
  return run(async (tx) => {
    const removed = await tx.remove(id);
    if (!removed) throw new RecipeNotFoundError();
    const handOff: RecipeHandOff = {
      entityId: removed.id,
      actorAccountId: actorId,
      action: "delete",
      changeId: deps.newId(),
      changes: [
        { field: "version", before: String(removed.version), after: null },
        { field: "schemaVersion", before: String(removed.schemaVersion), after: null },
      ],
    };
    await tx.enqueueHandOff(handOff);
    return { result: null, handOffs: [handOff] };
  });
}

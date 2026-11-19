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
  readonly schemaVersion: number;
  /** The recipe without `account.value`. */
  readonly recipe: Recipe;
  readonly accountValueSealed: string | null;
  readonly accountValueLast4: string | null;
  readonly fingerprint: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** A technical ceiling of the space (NFR-15 FR 17), the same for every plan: never 402. */
export const RECIPES_PER_SPACE = 200;
export const RECIPE_NAME_MAX = 120;
/** The sealed field of the account binding's value (household's space keys). */
export const ACCOUNT_VALUE_FIELD = "import-recipes.account-value";

export const RECIPE_ENTITY = "import-recipes.recipe" as const;
export const HAND_OFF_ACTIONS = ["create", "delete"] as const;

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
  find(id: string): Promise<StoredRecipe | null>;
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

/** The space holds `RECIPES_PER_SPACE` recipes already. */
export class RecipeCeilingError extends Error {
  readonly limit = RECIPES_PER_SPACE;
  constructor() {
    super("Recipe ceiling reached");
    this.name = "RecipeCeilingError";
  }
}

const FINGERPRINT = /^fp1:[0-9a-f]{64}$/;

/** The last 4 characters of the value, spaces dropped: how it is shown (NFR-01 FR 6). */
const last4 = (value: string): string => value.replace(/\s+/g, "").slice(-4) || "*";

/** «Зберегти рецепт»: checked whole, the account value sealed, then written with its audit hand-off. */
export async function saveRecipe(
  deps: RecipesDeps,
  run: SpaceTx,
  actor: { readonly actorId: string; readonly householdId: string },
  input: { readonly name: string; readonly recipe: unknown; readonly fingerprint: string | null },
): Promise<Handed<StoredRecipe>> {
  const name = input.name.trim();
  if (unsafeText(name)) throw new RecipeRejectedError([{ code: "INVALID_CHARACTER", path: "name" }]);
  if (name.length < 1 || name.length > RECIPE_NAME_MAX)
    throw new RecipeRejectedError([{ code: "INVALID_VALUE", path: "name" }]);
  if (input.fingerprint !== null && !FINGERPRINT.test(input.fingerprint))
    throw new RecipeRejectedError([{ code: "INVALID_VALUE", path: "fingerprint" }]);
  const checked = validateRecipe(input.recipe);
  if (!checked.ok) throw new RecipeRejectedError(checked.errors);
  const value = checked.recipe.account?.value;
  let recipe: Recipe = checked.recipe;
  if (value !== undefined) {
    const account = { ...checked.recipe.account! };
    delete account.value;
    recipe = { ...checked.recipe, account };
  }
  const sealed = value === undefined ? null : await deps.seal(actor.householdId, ACCOUNT_VALUE_FIELD, value);
  return run(async (tx) => {
    await tx.lockSpace();
    if ((await tx.count()) >= RECIPES_PER_SPACE) throw new RecipeCeilingError();
    const stored: StoredRecipe = {
      id: deps.newId(),
      householdId: actor.householdId,
      name,
      schemaVersion: checked.recipe.schemaVersion,
      recipe,
      accountValueSealed: sealed,
      accountValueLast4: value === undefined ? null : last4(value),
      fingerprint: input.fingerprint,
      createdBy: actor.actorId,
      createdAt: deps.now(),
    };
    await tx.insert(stored);
    const handOff: RecipeHandOff = {
      entityId: stored.id,
      actorAccountId: actor.actorId,
      action: "create",
      changeId: deps.newId(),
      // Never the name or the rules (the user's text, maybe an account): the version and the rule counts.
      changes: [
        { field: "schemaVersion", before: null, after: String(stored.schemaVersion) },
        { field: "columnRules", before: null, after: String(recipe.columns?.length ?? 0) },
        { field: "formatBound", before: null, after: String(stored.fingerprint !== null) },
      ],
    };
    await tx.enqueueHandOff(handOff);
    return { result: stored, handOffs: [handOff] };
  });
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
      changes: [{ field: "schemaVersion", before: String(removed.schemaVersion), after: null }],
    };
    await tx.enqueueHandOff(handOff);
    return { result: null, handOffs: [handOff] };
  });
}

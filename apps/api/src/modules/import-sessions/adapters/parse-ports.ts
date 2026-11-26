import type { AccountDirectory } from "../../accounts/index.ts";
import { StatementParseError, type Institution, type StatementParser } from "../../file-parsers/index.ts";
import { FileNotFoundError, rejection, REJECTION_CODES, type FileStorage } from "../../file-storage/index.ts";
import type { SpaceKeys } from "../../household/index.ts";
import {
  ACCOUNT_VALUE_FIELD,
  readOptionsOf,
  type ImportRecipesReader,
  type RecipeForParse,
} from "../../import-recipes/index.ts";
import { ParseRefused, type FileRejection, type ParsePorts, type ParseRecipe } from "../application/index.ts";

/**
 * The parse step's ports over the other modules' public interfaces (ARC-01 FR 2): file-storage's originals, the
 * space's recipes (import-recipes), its accounts (accounts), the space's key (household) and the isolated parse worker
 * (file-parsers). The recipe's account value stays sealed: the opener of its field is taken lazily, once the parse
 * worker's turn has come, and is moved into the worker or wiped (#624).
 */
export interface ParseModules {
  readonly files: Pick<FileStorage, "read">;
  readonly recipes: ImportRecipesReader;
  readonly accounts: Pick<AccountDirectory, "postingAccount">;
  readonly keys: Pick<SpaceKeys, "fieldOpener" | "sealBytes">;
  readonly parser: StatementParser;
  /** IMP-08 FR 2 (row 230): accounts' directory of banks (`bankDirectory`), for the statement's own bank. */
  readonly banks?: () => readonly Institution[];
}

const BOUND: ReadonlySet<string> = new Set(["iban", "account-number", "mask"]);

function recipeOf(found: RecipeForParse | null): ParseRecipe | null {
  if (!found) return null;
  const by = found.recipe.account?.by;
  const symbols = found.recipe.numbers?.currencySymbols;
  return {
    id: found.id,
    fingerprint: found.fingerprint,
    options: readOptionsOf(found.recipe),
    ...(symbols ? { currencySymbols: symbols } : {}),
    // A pattern in the header or a column is applied with the recipe's rules (IMP-06 FR 1, a later part).
    binding:
      by && BOUND.has(by) && found.accountValueSealed
        ? { by: by as "iban" | "account-number" | "mask", sealedValue: found.accountValueSealed }
        : null,
  };
}

/** A parse refusal as the file's rejection code (IMP-01 FR 13, FR 15: the ceiling's own text). */
function refusalCode(error: StatementParseError): string {
  switch (error.code) {
    case "TABLE_LIMIT":
      return error.ceiling === "rows"
        ? "TOO_MANY_ROWS"
        : error.ceiling === "cells"
          ? "TOO_MANY_CELLS"
          : "CORRUPTED";
    case "FILE_TOO_LARGE":
    case "PARSE_MEMORY":
    case "PARSE_TIMEOUT":
    case "CORRUPTED":
    case "ACCOUNT_BINDING":
      return error.code;
  }
}

export function parsePorts(modules: ParseModules): ParsePorts {
  return {
    async original(householdId, fileId) {
      try {
        return await modules.files.read(householdId, fileId);
      } catch (error) {
        if (error instanceof FileNotFoundError) return null;
        throw error;
      }
    },
    recipe: async (householdId, recipeId) => recipeOf(await modules.recipes.forParse(householdId, recipeId)),
    recipeForFormat: async (householdId, fingerprint) =>
      recipeOf(await modules.recipes.forFormat(householdId, fingerprint)),
    async account(householdId, accountId) {
      const account = await modules.accounts.postingAccount(householdId, accountId);
      if (!account || account.status !== "active") return null;
      return { currencies: account.subaccounts.map((s) => s.currency), kind: account.kind };
    },
    async parse(householdId, bytes, options, statement, binding) {
      try {
        return await modules.parser.parse(
          bytes,
          options,
          statement,
          binding
            ? async () => ({
                ...binding,
                opener: await modules.keys.fieldOpener(householdId, ACCOUNT_VALUE_FIELD),
              })
            : undefined,
        );
      } catch (error) {
        if (error instanceof StatementParseError) throw new ParseRefused(refusalCode(error));
        throw error;
      }
    },
    ...(modules.banks ? { institutions: modules.banks } : {}),
    seal: (householdId, purpose, plaintext) => modules.keys.sealBytes(householdId, purpose, plaintext),
  };
}

/** file-storage's text of a rejection code, or null for a code that is not file-storage's. */
export function storageRejection(code: string): FileRejection | null {
  return (REJECTION_CODES as readonly string[]).includes(code)
    ? rejection(code as (typeof REJECTION_CODES)[number])
    : null;
}

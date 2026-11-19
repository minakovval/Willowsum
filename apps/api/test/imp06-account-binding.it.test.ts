import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import {
  isolatedStatementParser,
  StatementParseError,
  type SealedAccountBinding,
} from "../src/modules/file-parsers/index.ts";
import { createSpaceKeys, type HouseholdSpaces, type SpaceKeys } from "../src/modules/household/index.ts";
import {
  ACCOUNT_VALUE_FIELD,
  createImportRecipesReader,
  createImportRecipesServices,
  type ImportRecipesReader,
} from "../src/modules/import-recipes/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { kms } from "./erasure-helpers.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-06@PoC FR 1 «прив'язка до рахунку», NFR-01@PoC FR 6 (wave 2 row 41 part 3; #618, its second item, #624): a statement is
 * bound to its recipe's account in the parse worker, which opens `importRecipes.accountValue` with the space's key.
 * The API thread holds only the sealed value and an opener whose key moves into the worker: the plaintext is never in
 * this thread, an answer, an error or a log. Another space's recipe cannot be used and a wrong key fails closed.
 * Every value is synthetic and built at runtime (no bank has it).
 */
const WEB = "http://localhost:5173";
const IBAN = ["UA", "00", "000000", "0000000", "123456", "987654"].join("");
const OTHER_IBAN = ["UA", "00", "000000", "0000000", "654321", "456789"].join("");
/** The part of the value that is never shown (its last 4 characters are). */
const HIDDEN = IBAN.slice(0, -4);
const grouped = (iban: string): string => iban.replace(/(.{4})/g, "$1 ").trim();

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let keys: SpaceKeys;
let reader: ImportRecipesReader;
let app: ReturnType<typeof buildServer>;
const parser = isolatedStatementParser();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

async function saveRecipe(space: Space, account: { by: string; value: string }): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/import/recipes",
    headers: {
      origin: WEB,
      "content-type": "application/json",
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
    },
    payload: JSON.stringify({ name: "Банк", recipe: { schemaVersion: 1, account } }),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const statement = (preamble: string): Uint8Array =>
  new TextEncoder().encode(
    [preamble, "Дата;Сума;Валюта;Опис", "01.03.2026;-120,50;EUR;Кава", "02.03.2026;-20,00;EUR;Хліб"].join(
      "\n",
    ),
  );

/** What the API thread does: the recipe of the caller's space, an opener of its field, the parse in the worker. */
async function bind(space: Space, recipeId: string): Promise<SealedAccountBinding> {
  const found = await reader.forParse(space.householdId, recipeId);
  if (!found?.accountValueSealed || !found.recipe.account) throw new Error("no recipe");
  return {
    by: found.recipe.account.by as SealedAccountBinding["by"],
    sealedValue: found.accountValueSealed,
    opener: await keys.fieldOpener(space.householdId, ACCOUNT_VALUE_FIELD),
  };
}

/** Everything the API thread writes while `work` runs: console, stdout and stderr. */
async function written<T>(work: () => Promise<T>): Promise<{ result: T | Error; text: string }> {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => void lines.push(args.map((a) => String(a)).join(" "));
  const spies = [
    vi.spyOn(console, "log").mockImplementation(keep),
    vi.spyOn(console, "info").mockImplementation(keep),
    vi.spyOn(console, "warn").mockImplementation(keep),
    vi.spyOn(console, "error").mockImplementation(keep),
    vi.spyOn(console, "debug").mockImplementation(keep),
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => (keep(chunk), true)),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => (keep(chunk), true)),
  ];
  try {
    return { result: await work().catch((error: Error) => error), text: lines.join("\n") };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

function expectNoValue(text: string): void {
  expect(text).not.toContain(HIDDEN);
  expect(text).not.toContain(grouped(IBAN).slice(0, 14));
}

beforeAll(async () => {
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  const audit = createAuditLog(db.databases.for("audit"));
  keys = createSpaceKeys(db.databases.for("household"), audit, kms);
  reader = createImportRecipesReader(db.databases.for("import-recipes"));
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        importRecipes: createImportRecipesServices({
          keys,
          audit,
          clock: { now: () => Date.parse("2026-11-19T10:00:00Z") },
          newId: randomUUID,
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("IMP-06@PoC FR 1: the parse worker binds a statement to the recipe's account", () => {
  it("IMP-06@PoC FR 1: the recipe's IBAN, opened in the worker, matches the file's; another IBAN is a mismatch", async () => {
    const space = await newSpace();
    const recipeId = await saveRecipe(space, { by: "iban", value: grouped(IBAN) });
    const same = statement(`Рахунок;${grouped(IBAN)}`);
    const parse = await parser.parse(same, {}, {}, await bind(space, recipeId));
    expect(parse.account).toEqual({ by: "iban", status: "match" });
    expect(parse.events.events).toHaveLength(2);
    const other = statement(`Рахунок;${OTHER_IBAN}`);
    expect((await parser.parse(other, {}, {}, await bind(space, recipeId))).account).toEqual({
      by: "iban",
      status: "mismatch",
    });
    const none = statement("Виписка;березень");
    expect((await parser.parse(none, {}, {}, await bind(space, recipeId))).account?.status).toBe("not-found");
    // Without a binding the parse has none.
    expect((await parser.parse(same)).account).toBeNull();
  });

  it("IMP-06@PoC FR 1: an account number and a card mask are bound the same way", async () => {
    const space = await newSpace();
    const byNumber = await saveRecipe(space, { by: "account-number", value: "2600 1234 5678" });
    const file = statement("Рахунок;2600-1234-5678");
    expect((await parser.parse(file, {}, {}, await bind(space, byNumber))).account).toEqual({
      by: "account-number",
      status: "match",
    });
    const byMask = await saveRecipe(space, { by: "mask", value: "**** 1234" });
    const card = statement("Картка;5168 **** **** 4321");
    expect((await parser.parse(card, {}, {}, await bind(space, byMask))).account).toEqual({
      by: "mask",
      status: "mismatch",
    });
  });
});

describe("NFR-01@PoC FR 6: the account value is opened only in the parse worker", () => {
  it("NFR-01@PoC FR 6: no plaintext in the API thread — not in the answer, an error, the console or stdout; the key moves out", async () => {
    const space = await newSpace();
    const recipeId = await saveRecipe(space, { by: "iban", value: IBAN });
    const found = await reader.forParse(space.householdId, recipeId);
    expectNoValue(JSON.stringify(found));
    expect(found!.recipe.account).toEqual({ by: "iban" });
    const file = statement(`IBAN;${grouped(IBAN)}`);
    const binding = await bind(space, recipeId);
    const { result, text } = await written(() => parser.parse(file, {}, {}, binding));
    expect(result).not.toBeInstanceOf(Error);
    expectNoValue(text);
    // The answer carries the file's own preamble cells only through the analysis; the binding's outcome holds no value.
    expect(JSON.stringify((result as { account: unknown }).account)).toBe('{"by":"iban","status":"match"}');
    // The key was moved into the worker: nothing of it is left in this thread.
    expect(binding.opener.key.byteLength).toBe(0);
    // A refused parse: the error names its code only.
    const foreign = await newSpace();
    const foreignOpener = await keys.fieldOpener(foreign.householdId, ACCOUNT_VALUE_FIELD);
    const refused = await written(() => parser.parse(file, {}, {}, { ...binding, opener: foreignOpener }));
    expect(refused.result).toBeInstanceOf(StatementParseError);
    expectNoValue(
      `${String(refused.result)} ${JSON.stringify(refused.result)} ${(refused.result as Error).stack}`,
    );
    expectNoValue(refused.text);
  });
});

describe("IMP-06@PoC FR 1: another space's recipe cannot be used", () => {
  it("IMP-06@PoC FR 1: the reader gives another space's recipe as null", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const recipeId = await saveRecipe(owner, { by: "iban", value: IBAN });
    expect(await reader.forParse(stranger.householdId, recipeId)).toBeNull();
    expect(await reader.forParse(owner.householdId, randomUUID())).toBeNull();
    expect(await reader.forParse(owner.householdId, "not-a-uuid")).toBeNull();
    expect((await reader.forParse(owner.householdId, recipeId))?.id).toBe(recipeId);
  });

  it("IMP-06@PoC FR 1: another space's sealed value with this space's opener refuses the parse as ACCOUNT_BINDING", async () => {
    const owner = await newSpace();
    const stranger = await newSpace();
    const recipeId = await saveRecipe(owner, { by: "iban", value: IBAN });
    const sealedValue = (await reader.forParse(owner.householdId, recipeId))!.accountValueSealed!;
    const file = statement(`IBAN;${grouped(IBAN)}`);
    await expect(
      parser.parse(
        file,
        {},
        {},
        {
          by: "iban",
          sealedValue,
          opener: await keys.fieldOpener(stranger.householdId, ACCOUNT_VALUE_FIELD),
        },
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_BINDING" });
  });
});

describe("NFR-01@PoC FR 6: a wrong key fails closed", () => {
  it("NFR-01@PoC FR 6: a changed key, another field's opener or a used opener refuses the parse; it never parses unbound", async () => {
    const space = await newSpace();
    const recipeId = await saveRecipe(space, { by: "iban", value: IBAN });
    const file = statement(`IBAN;${grouped(IBAN)}`);
    const changed = await bind(space, recipeId);
    const bytes = new Uint8Array(changed.opener.key);
    bytes[0] = bytes[0]! ^ 0xff;
    await expect(parser.parse(file, {}, {}, changed)).rejects.toMatchObject({ code: "ACCOUNT_BINDING" });
    const otherField = await bind(space, recipeId);
    const wrongField = {
      ...otherField,
      opener: await keys.fieldOpener(space.householdId, "accounts.iban"),
    };
    await expect(parser.parse(file, {}, {}, wrongField)).rejects.toMatchObject({ code: "ACCOUNT_BINDING" });
    // `otherField`'s opener was never moved: it is still whole, and works once.
    expect((await parser.parse(file, {}, {}, otherField)).account?.status).toBe("match");
    // Used: its key was moved into the first worker and is detached here.
    await expect(parser.parse(file, {}, {}, otherField)).rejects.toMatchObject({ code: "ACCOUNT_BINDING" });
    // A destroyed key gives no opener at all.
    await keys.destroy(space.householdId);
    await expect(keys.fieldOpener(space.householdId, ACCOUNT_VALUE_FIELD)).rejects.toMatchObject({
      code: "SPACE_KEY_DESTROYED",
    });
  });
});

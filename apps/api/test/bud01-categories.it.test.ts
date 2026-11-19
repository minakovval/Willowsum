import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import type { HouseholdSpaces } from "../src/modules/household/index.ts";
import {
  categoryMerged,
  createCategoriesErasure,
  createCategoriesServices,
  createCategoryDirectory,
  type CategoryDirectory,
} from "../src/modules/categories/index.ts";
import { leakText } from "./leak-text.ts";

/**
 * BUD-01@PoC a) (wave 2 row 19), the server part of the module `categories`, through the real API on a real
 * PostgreSQL: the system tree of a space, custom groups and categories, rename, hide, merge, «обов'язкова», colour
 * and icon, the service categories «Переказ» and «Коригування», the directory other modules check categories with
 * (FR 9) and the event `categories.merged` that moves transactions, rules and limits (BUD-01 b, row 20, and the
 * budget). Every name is synthetic; the session is the test's principal header.
 */
const WEB = "http://localhost:5173";
const NOW = Date.parse("2026-10-17T10:00:00Z");

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let directory: CategoryDirectory;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

interface Principal {
  role?: string;
  scoped?: boolean;
}

interface Category {
  id: string;
  groupId: string;
  systemKey: string | null;
  kind: "expense" | "income" | "service";
  name: string;
  renamed: boolean;
  icon: string;
  color: string;
  iconTone: "white" | "ink";
  essential: boolean | null;
  hidden: boolean;
}

interface Group {
  id: string;
  systemKey: string | null;
  kind: "expense" | "income" | "service";
  name: string;
  renamed: boolean;
  tone: string;
  categories: Category[];
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(
  space: Space,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  principal: Principal = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function tree(space: Space, principal: Principal = {}): Promise<Group[]> {
  const res = await call(space, "GET", "/v1/categories", undefined, principal);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().groups as Group[];
}

const flat = (groups: Group[]) => groups.flatMap((g) => g.categories);

async function category(space: Space, name: string): Promise<Category> {
  const found = flat(await tree(space)).find((c) => c.name === name);
  expect(found, name).toBeDefined();
  return found!;
}

async function group(space: Space, name: string): Promise<Group> {
  const found = (await tree(space)).find((g) => g.name === name);
  expect(found, name).toBeDefined();
  return found!;
}

async function addCategory(space: Space, groupName: string, name: string, extra: object = {}) {
  const g = await group(space, groupName);
  const res = await call(space, "POST", "/v1/categories", { groupId: g.id, name, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Category;
}

async function events(householdId: string) {
  const { rows } = await db.owner.query(
    `SELECT event_name, event_version, payload FROM categories.outbox_events WHERE household_id = $1 ORDER BY created_at`,
    [householdId],
  );
  return rows as { event_name: string; event_version: number; payload: Record<string, unknown> }[];
}

const rowCount = async (householdId: string) =>
  Number(
    (
      await db.owner.query(
        `SELECT (SELECT count(*) FROM categories.categories WHERE household_id = $1)
              + (SELECT count(*) FROM categories.category_groups WHERE household_id = $1) AS n`,
        [householdId],
      )
    ).rows[0]!.n,
  );

const snapshot = async (householdId: string) =>
  (
    await db.owner.query(
      `SELECT id, name, state, merged_into, essential, icon, color, version FROM categories.categories
        WHERE household_id = $1 ORDER BY id`,
      [householdId],
    )
  ).rows;

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  directory = createCategoryDirectory({ db: db.databases.for("categories"), audit, newId: randomUUID });
  const base = fakeFlags();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled: async (_householdId, flag) => !off.has(flag) },
        authenticate: testAuthenticate,
        categories: createCategoriesServices({
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
          usage: [],
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

beforeEach(() => off.clear());

describe("BUD-01@PoC FR 1, FR 10, FR 11: the system tree of a new space", () => {
  it("BUD-01@PoC FR 1: a new space has 10 groups (8 of expenses, 2 of income) and the service «Переказ» and «Коригування», two levels", async () => {
    const space = await newSpace();
    const groups = await tree(space);
    expect(groups.map((g) => g.kind)).toEqual([
      ...Array<string>(8).fill("expense"),
      "income",
      "income",
      "service",
    ]);
    expect(groups[0]).toMatchObject({ name: "Житло", systemKey: "housing", renamed: false, tone: "#5872D2" });
    expect(flat(groups)).toHaveLength(51);
    expect(groups[10]!.categories.map((c) => [c.name, c.kind, c.essential])).toEqual([
      ["Переказ", "service", null],
      ["Коригування", "service", null],
    ]);
    expect(flat(groups).every((c) => !c.hidden)).toBe(true);
    // Read twice and at once: one tree, never a second copy.
    await Promise.all([tree(space), tree(space)]);
    expect(await rowCount(space.householdId)).toBe(51 + 11);
  });

  it("BUD-01@PoC AC16: «обов'язкова» is on for «Оренда», «Комунальні», «Продукти», «Зв'язок», «Освіта», «Здоров'я» and off for the other expense categories; off for «Продукти» it is off for the space", async () => {
    const space = await newSpace();
    const expenses = flat(await tree(space)).filter((c) => c.kind === "expense");
    expect(expenses.filter((c) => c.essential).map((c) => c.name)).toEqual([
      "Оренда",
      "Комунальні",
      "Продукти",
      "Зв'язок",
      "Здоров'я",
      "Освіта",
    ]);
    expect(expenses.every((c) => typeof c.essential === "boolean")).toBe(true);
    const groceries = await category(space, "Продукти");
    const res = await call(space, "PATCH", `/v1/categories/${groceries.id}`, { essential: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().essential).toBe(false);
    // The attribute belongs to the space's category, not to a budget: every reader of the category sees it.
    expect((await category(space, "Продукти")).essential).toBe(false);
    expect((await directory.category(space.householdId, groceries.id))?.essential).toBe(false);
  });

  it("BUD-01@PoC AC15: the income category «Зарплата» has no «обов'язкова»; setting it is refused", async () => {
    const space = await newSpace();
    const salary = await category(space, "Зарплата");
    expect(salary.essential).toBeNull();
    const res = await call(space, "PATCH", `/v1/categories/${salary.id}`, { essential: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ in: "body", path: "essential", issue: "not_expense" }]);
    expect((await category(space, "Зарплата")).essential).toBeNull();
    const income = await call(space, "POST", "/v1/categories", {
      groupId: (await group(space, "Інші доходи")).id,
      name: "Синтетичні роялті",
      essential: true,
    });
    expect(income.statusCode).toBe(400);
  });

  it("BUD-01@PoC AC17: «Оренда» #144097, «Комунальні» #494BAB, «Сад» #959FFE and «Продукти» #045D2F; white icons, «Сад» ink", async () => {
    const space = await newSpace();
    const cats = flat(await tree(space));
    const of = (name: string) => cats.find((c) => c.name === name)!;
    expect(["Оренда", "Комунальні", "Сад", "Продукти"].map((n) => [of(n).color, of(n).iconTone])).toEqual([
      ["#144097", "white"],
      ["#494BAB", "white"],
      ["#959FFE", "ink"],
      ["#045D2F", "white"],
    ]);
    expect(of("Сад").groupId).toBe((await group(space, "Житло")).id);
    expect(of("Продукти").icon).toMatch(/^[a-z0-9-]+$/);
  });

  it("BUD-01@PoC FR 10: the icon and colour change in the settings; the icon tone follows the colour; a malformed colour or icon is refused", async () => {
    const space = await newSpace();
    const garden = await category(space, "Сад");
    const res = await call(space, "PATCH", `/v1/categories/${garden.id}`, {
      icon: "flower",
      color: "#144097",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ icon: "flower", color: "#144097", iconTone: "white" });
    for (const body of [{ color: "blue" }, { color: "#12345" }, { icon: "Flower Pot" }, { icon: "<svg>" }]) {
      const bad = await call(space, "PATCH", `/v1/categories/${garden.id}`, body);
      expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await category(space, "Сад")).toMatchObject({ icon: "flower", color: "#144097" });
  });
});

describe("BUD-01@PoC FR 2, FR 3: custom groups and categories, rename, hide", () => {
  it("BUD-01@PoC FR 2: the user adds a custom group of type income or expense and custom categories in it and in a system group", async () => {
    const space = await newSpace();
    const res = await call(space, "POST", "/v1/category-groups", {
      name: "Синтетичне хобі",
      kind: "expense",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      name: "Синтетичне хобі",
      kind: "expense",
      systemKey: null,
      categories: [],
    });
    const income = await call(space, "POST", "/v1/category-groups", {
      name: "Синтетичні надходження",
      kind: "income",
    });
    expect(income.json()).toMatchObject({ kind: "income", tone: "#BA4E84" });
    const own = await addCategory(space, "Синтетичне хобі", "Моделі літаків");
    expect(own).toMatchObject({ kind: "expense", systemKey: null, essential: false, hidden: false });
    expect(own.color).toBe(res.json().tone);
    const coffee = await addCategory(space, "Харчування", "Кава", { essential: true });
    expect(coffee).toMatchObject({ kind: "expense", essential: true });
    const groups = await tree(space);
    expect(groups.find((g) => g.name === "Харчування")!.categories.map((c) => c.name)).toContain("Кава");
    expect(groups.find((g) => g.name === "Синтетичне хобі")!.categories.map((c) => c.name)).toEqual([
      "Моделі літаків",
    ]);
    // No group of the type «службова» and no category in the service group.
    expect(
      (await call(space, "POST", "/v1/category-groups", { name: "Інше службове", kind: "service" }))
        .statusCode,
    ).toBe(400);
    const service = await call(space, "POST", "/v1/categories", {
      groupId: (await group(space, "Службові")).id,
      name: "Синтетична службова",
    });
    expect(service.statusCode).toBe(400);
    expect(service.json().errors).toEqual([{ in: "body", path: "groupId", issue: "service" }]);
  });

  it("BUD-01@PoC FR 2: a name is unique in the space — a duplicate (of a system or custom name, any case) is refused «Така назва вже існує»; nothing written", async () => {
    const space = await newSpace();
    const coffee = await addCategory(space, "Харчування", "Кава");
    const before = await rowCount(space.householdId);
    const food = (await group(space, "Харчування")).id;
    for (const name of ["Продукти", "  продукти ", "КАВА"]) {
      const res = await call(space, "POST", "/v1/categories", { groupId: food, name });
      expect(res.statusCode, name).toBe(409);
      expect(res.json().code).toBe("CATEGORY_NAME_TAKEN");
    }
    const rename = await call(space, "PATCH", `/v1/categories/${coffee.id}`, { name: "Подорожі" });
    expect([rename.statusCode, rename.json().code]).toEqual([409, "CATEGORY_NAME_TAKEN"]);
    const groupDup = await call(space, "POST", "/v1/category-groups", { name: "житло", kind: "expense" });
    expect([groupDup.statusCode, groupDup.json().code]).toEqual([409, "CATEGORY_NAME_TAKEN"]);
    expect(await rowCount(space.householdId)).toBe(before);
    expect((await category(space, "Кава")).id).toBe(coffee.id);
    // The same name in another space is that space's own.
    const other = await newSpace();
    expect((await addCategory(other, "Харчування", "Кава")).name).toBe("Кава");
  });

  it("BUD-01@PoC FR 3: a renamed system category shows the new name instead of the standard one and keeps its key; a group renames too", async () => {
    const space = await newSpace();
    const groceries = await category(space, "Продукти");
    const res = await call(space, "PATCH", `/v1/categories/${groceries.id}`, { name: "Супермаркет" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      id: groceries.id,
      name: "Супермаркет",
      renamed: true,
      systemKey: "groceries",
    });
    expect(flat(await tree(space)).some((c) => c.name === "Продукти")).toBe(false);
    // The standard name is free again.
    await addCategory(space, "Харчування", "Продукти");
    const housing = await group(space, "Житло");
    const renamed = await call(space, "PATCH", `/v1/category-groups/${housing.id}`, { name: "Дім і побут" });
    expect(renamed.json()).toMatchObject({ name: "Дім і побут", renamed: true, systemKey: "housing" });
  });

  it("BUD-01@PoC FR 3: «Переказ» and «Коригування» cannot be hidden (or merged); they can be renamed", async () => {
    const space = await newSpace();
    for (const name of ["Переказ", "Коригування"]) {
      const c = await category(space, name);
      const hide = await call(space, "PATCH", `/v1/categories/${c.id}`, { hidden: true });
      expect([hide.statusCode, hide.json().code], name).toEqual([409, "CATEGORY_SERVICE_FIXED"]);
      const merge = await call(space, "POST", `/v1/categories/${c.id}/merge`, {
        targetId: (await category(space, "Інші витрати")).id,
      });
      expect([merge.statusCode, merge.json().code], name).toEqual([409, "CATEGORY_SERVICE_FIXED"]);
    }
    const into = await call(space, "POST", `/v1/categories/${(await category(space, "Штрафи")).id}/merge`, {
      targetId: (await category(space, "Переказ")).id,
    });
    expect(into.json().code).toBe("CATEGORY_SERVICE_FIXED");
    expect(flat(await tree(space)).every((c) => !c.hidden)).toBe(true);
    const transfer = await category(space, "Переказ");
    const rename = await call(space, "PATCH", `/v1/categories/${transfer.id}`, { name: "Між своїми" });
    expect(rename.json()).toMatchObject({ name: "Між своїми", systemKey: "transfer", hidden: false });
  });

  it("BUD-01@PoC AC7: a system category («Подорожі») cannot be deleted — only hidden; hidden, it stays in the settings tree and may be shown again", async () => {
    const space = await newSpace();
    const travel = await category(space, "Подорожі");
    // FR 12: a system category is never deleted (the route deletes empty custom ones only).
    const del = await call(space, "DELETE", `/v1/categories/${travel.id}`);
    expect([del.statusCode, del.json().code]).toEqual([409, "CATEGORY_SYSTEM_FIXED"]);
    expect((await category(space, "Подорожі")).id).toBe(travel.id);
    const hide = await call(space, "PATCH", `/v1/categories/${travel.id}`, { hidden: true });
    expect(hide.statusCode, hide.body).toBe(200);
    expect(hide.json().hidden).toBe(true);
    expect((await category(space, "Подорожі")).hidden).toBe(true);
    // The budget reads the state through the directory: a hidden category is out of the plan (budget, BUD-02).
    expect((await directory.category(space.householdId, travel.id))?.state).toBe("hidden");
    const show = await call(space, "PATCH", `/v1/categories/${travel.id}`, { hidden: false });
    expect(show.json().hidden).toBe(false);
  });
});

describe("BUD-01@PoC FR 8: merging categories", () => {
  it("BUD-01@PoC AC5: «Кава» merged into «Кафе і ресторани» — taken out of use; the event for transactions and the limit is published; the action is in the audit log", async () => {
    const space = await newSpace();
    const coffee = await addCategory(space, "Харчування", "Кава");
    const cafes = await category(space, "Кафе і ресторани");
    const res = await call(space, "POST", `/v1/categories/${coffee.id}/merge`, { targetId: cafes.id });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ sourceId: coffee.id, targetId: cafes.id, sourceState: "retired" });
    expect(flat(await tree(space)).some((c) => c.id === coffee.id)).toBe(false);
    expect((await call(space, "GET", `/v1/categories/${coffee.id}`)).statusCode).toBe(404);
    expect((await call(space, "PATCH", `/v1/categories/${coffee.id}`, { name: "Кава 2" })).statusCode).toBe(
      404,
    );
    // Transactions, split parts, rules, recurring payments and the limit follow the event (categorization, budget,
    // recurring consume it); the periods are recounted from it.
    const published = await events(space.householdId);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ event_name: "categories.merged", event_version: 1 });
    expect(categoryMerged.schema.parse(published[0]!.payload)).toMatchObject({
      sourceId: coffee.id,
      targetId: cafes.id,
      kind: "expense",
      mergedAt: "2026-10-17T10:00:00.000Z",
    });
    expect(await directory.category(space.householdId, coffee.id)).toMatchObject({
      state: "retired",
      mergedInto: cafes.id,
    });
    const log = await audit.entriesFor(space.householdId, { type: "categories.category", id: coffee.id });
    expect(log.map((e) => e.action)).toEqual(["create", "update"]);
    expect(log[1]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "state", before: "active", after: "retired" }),
        expect.objectContaining({ field: "mergedInto", before: null, after: cafes.id }),
      ]),
    );
    // The name of a category out of use is free again.
    await addCategory(space, "Харчування", "Кава");
  });

  it("BUD-01@PoC AC6: «Кава» (expense) into «Зарплата» (income) is refused «Категорії різних типів не можна об'єднати»; nothing changes", async () => {
    const space = await newSpace();
    const coffee = await addCategory(space, "Харчування", "Кава");
    const salary = await category(space, "Зарплата");
    const before = await snapshot(space.householdId);
    const res = await call(space, "POST", `/v1/categories/${coffee.id}/merge`, { targetId: salary.id });
    expect([res.statusCode, res.json().code]).toEqual([409, "CATEGORY_KINDS_DIFFER"]);
    expect(await snapshot(space.householdId)).toEqual(before);
    expect(await events(space.householdId)).toEqual([]);
    expect(
      (await audit.entriesFor(space.householdId, { type: "categories.category", id: coffee.id })).map(
        (e) => e.action,
      ),
    ).toEqual(["create"]);
  });

  it("BUD-01@PoC EC5: a merged system category is restored as hidden and may be shown again", async () => {
    const space = await newSpace();
    const fun = await category(space, "Розваги");
    const hobbies = await category(space, "Хобі");
    const res = await call(space, "POST", `/v1/categories/${fun.id}/merge`, { targetId: hobbies.id });
    expect(res.json()).toMatchObject({ sourceState: "hidden" });
    expect(await category(space, "Розваги")).toMatchObject({ id: fun.id, hidden: true });
    const show = await call(space, "PATCH", `/v1/categories/${fun.id}`, { hidden: false });
    expect(show.statusCode, show.body).toBe(200);
    expect(await directory.category(space.householdId, fun.id)).toMatchObject({
      state: "active",
      mergedInto: null,
    });
  });

  it("BUD-01@PoC FR 8: a category merged before into the source now points to the target; the source and target are checked", async () => {
    const space = await newSpace();
    const a = await addCategory(space, "Харчування", "Синтетичні снеки");
    const b = await addCategory(space, "Харчування", "Синтетичні солодощі");
    const groceries = await category(space, "Продукти");
    await call(space, "POST", `/v1/categories/${a.id}/merge`, { targetId: b.id });
    await call(space, "POST", `/v1/categories/${b.id}/merge`, { targetId: groceries.id });
    expect((await directory.category(space.householdId, a.id))?.mergedInto).toBe(groceries.id);
    // The re-pointed category is a change of its own: an audit entry with `mergedInto` before and after.
    const log = await audit.entriesFor(space.householdId, { type: "categories.category", id: a.id });
    expect(log.map((e) => e.action)).toEqual(["create", "update", "update"]);
    expect(log[2]!.changes).toEqual([
      expect.objectContaining({ field: "mergedInto", before: b.id, after: groceries.id }),
    ]);
    expect(log[2]!.actorId).toBe(space.accountId);
    const version = await db.owner.query(`SELECT version FROM categories.categories WHERE id = $1`, [a.id]);
    expect(version.rows[0].version).toBe(3);
    const self = await call(space, "POST", `/v1/categories/${groceries.id}/merge`, {
      targetId: groceries.id,
    });
    expect(self.json().errors).toEqual([{ in: "body", path: "targetId", issue: "same" }]);
    const gone = await call(space, "POST", `/v1/categories/${groceries.id}/merge`, { targetId: a.id });
    expect(gone.json().errors).toEqual([{ in: "body", path: "targetId", issue: "not_found" }]);
    const travel = await category(space, "Подорожі");
    await call(space, "PATCH", `/v1/categories/${travel.id}`, { hidden: true });
    const hidden = await call(space, "POST", `/v1/categories/${groceries.id}/merge`, { targetId: travel.id });
    expect(hidden.json().errors).toEqual([{ in: "body", path: "targetId", issue: "hidden" }]);
  });
});

describe("BUD-01@PoC FR 9: other modules check a category against the space's tree", () => {
  it("BUD-01@PoC FR 9: the directory answers a category of the space with its type and state; another space's or an unknown one is null; «Переказ» and «Коригування» by their keys", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const groceries = await category(a, "Продукти");
    expect(await directory.category(a.householdId, groceries.id)).toMatchObject({
      id: groceries.id,
      kind: "expense",
      state: "active",
      systemKey: "groceries",
      mergedInto: null,
    });
    expect(await directory.category(b.householdId, groceries.id)).toBeNull();
    expect(await directory.category(a.householdId, randomUUID())).toBeNull();
    const transfer = await directory.serviceCategory(b.householdId, "transfer");
    expect(transfer).toMatchObject({ kind: "service", systemKey: "transfer" });
    expect((await directory.serviceCategory(b.householdId, "adjustment"))?.systemKey).toBe("adjustment");
    expect(transfer!.id).not.toBe((await category(a, "Переказ")).id);
  });
});

describe("BUD-01@PoC «Права доступу»: the Owner works with categories; nobody else learns about them", () => {
  it("BUD-01@PoC AC12: a user outside the space viewing or changing its categories gets «not found» and learns no record, count or name", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const secret = await addCategory(a, "Родина", "Синтетична таємниця");
    const strip = (body: string) => ({ ...JSON.parse(body), supportId: undefined });
    const requests = [
      ["GET", `/v1/categories/${secret.id}`, undefined],
      ["PATCH", `/v1/categories/${secret.id}`, { name: "Інша" }],
      ["POST", `/v1/categories/${secret.id}/merge`, { targetId: (await category(b, "Продукти")).id }],
      ["PATCH", `/v1/category-groups/${(await group(a, "Родина")).id}`, { name: "Інша родина" }],
    ] as const;
    for (const [method, url, body] of requests) {
      const foreign = await call(b, method, url, body);
      const unknown = await call(b, method, url.replace(/[0-9a-f-]{36}/, randomUUID()), body);
      expect([foreign.statusCode, unknown.statusCode], `${method} ${url}`).toEqual([404, 404]);
      expect(strip(foreign.body)).toEqual(strip(unknown.body));
      expect(leakText(foreign.body)).not.toContain("таємниця");
    }
    // A category of space A as a merge target from A's own category is unknown in B too.
    const into = await call(b, "POST", `/v1/categories/${(await category(b, "Кешбек")).id}/merge`, {
      targetId: (await category(a, "Зарплата")).id,
    });
    expect(into.json().errors).toEqual([{ in: "body", path: "targetId", issue: "not_found" }]);
    const groupInto = await call(b, "POST", "/v1/categories", {
      groupId: (await group(a, "Родина")).id,
      name: "X",
    });
    expect(groupInto.json().errors).toEqual([{ in: "body", path: "groupId", issue: "not_found" }]);
    const list = await call(b, "GET", "/v1/categories");
    expect(leakText(list.body)).not.toContain("таємниця");
    expect(flat(list.json().groups)).toHaveLength(51);
    expect(await category(a, "Синтетична таємниця")).toMatchObject({ id: secret.id });
  });

  it.each(["owner", "admin", "editor"])(
    "BUD-01@PoC «Права доступу»: a %s reads the tree and adds, renames, hides and merges categories",
    async (role) => {
      const space = await newSpace();
      const p = { role };
      const g = await call(
        space,
        "POST",
        "/v1/category-groups",
        { name: `Група ${role}`, kind: "expense" },
        p,
      );
      expect(g.statusCode, g.body).toBe(201);
      const c = await call(space, "POST", "/v1/categories", { groupId: g.json().id, name: `Кат ${role}` }, p);
      expect(c.statusCode).toBe(201);
      expect((await call(space, "GET", "/v1/categories", undefined, p)).statusCode).toBe(200);
      expect((await call(space, "GET", `/v1/categories/${c.json().id}`, undefined, p)).statusCode).toBe(200);
      expect(
        (await call(space, "PATCH", `/v1/categories/${c.json().id}`, { hidden: true }, p)).statusCode,
      ).toBe(200);
      expect(
        (await call(space, "PATCH", `/v1/category-groups/${g.json().id}`, { name: `Г ${role}` }, p))
          .statusCode,
      ).toBe(200);
      const target = (await category(space, "Інші витрати")).id;
      expect(
        (await call(space, "POST", `/v1/categories/${c.json().id}/merge`, { targetId: target }, p))
          .statusCode,
      ).toBe(200);
    },
  );

  it.each(["viewer", "advisor"])(
    "BUD-01@PoC «Права доступу»: a %s reads the tree but may not change it (403); nothing written",
    async (role) => {
      const space = await newSpace();
      const p = { role };
      const travel = await category(space, "Подорожі");
      const before = await snapshot(space.householdId);
      expect((await call(space, "GET", "/v1/categories", undefined, p)).statusCode).toBe(200);
      expect((await call(space, "GET", `/v1/categories/${travel.id}`, undefined, p)).statusCode).toBe(200);
      const writes = [
        await call(space, "POST", "/v1/category-groups", { name: "Г", kind: "expense" }, p),
        await call(space, "POST", "/v1/categories", { groupId: travel.groupId, name: "К" }, p),
        await call(space, "PATCH", `/v1/categories/${travel.id}`, { hidden: true }, p),
        await call(space, "PATCH", `/v1/category-groups/${travel.groupId}`, { name: "Г" }, p),
        await call(space, "POST", `/v1/categories/${travel.id}/merge`, { targetId: travel.id }, p),
      ];
      expect(writes.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403]);
      expect(await snapshot(space.householdId)).toEqual(before);
    },
  );

  it("BUD-01@PoC «Права доступу»: a scoped member — «бюджет і цілі» closed by the visibility policy's default: reads not found, changes 403", async () => {
    const space = await newSpace();
    const travel = await category(space, "Подорожі");
    const before = await snapshot(space.householdId);
    const scoped = { role: "editor", scoped: true };
    const reads = [
      await call(space, "GET", "/v1/categories", undefined, scoped),
      await call(space, "GET", `/v1/categories/${travel.id}`, undefined, scoped),
    ];
    expect(reads.map((r) => r.statusCode)).toEqual([404, 404]);
    expect(leakText(reads[0]!.body)).not.toContain("Подорожі");
    const writes = [
      await call(space, "POST", "/v1/categories", { groupId: travel.groupId, name: "К" }, scoped),
      await call(space, "PATCH", `/v1/categories/${travel.id}`, { hidden: true }, scoped),
      await call(space, "POST", `/v1/categories/${travel.id}/merge`, { targetId: travel.id }, scoped),
    ];
    expect(writes.map((r) => r.statusCode)).toEqual([403, 403, 403]);
    expect(await snapshot(space.householdId)).toEqual(before);
  });

  it("BUD-01@PoC: the flag categories.tree off — every route answers 404 as if absent; nothing written", async () => {
    const space = await newSpace();
    off.add("categories.tree");
    const id = randomUUID();
    const results = [
      await call(space, "GET", "/v1/categories"),
      await call(space, "GET", `/v1/categories/${id}`),
      await call(space, "POST", "/v1/categories", { groupId: id, name: "К" }),
      await call(space, "PATCH", `/v1/categories/${id}`, { hidden: true }),
      await call(space, "POST", `/v1/categories/${id}/merge`, { targetId: id }),
      await call(space, "POST", "/v1/category-groups", { name: "Г", kind: "expense" }),
      await call(space, "PATCH", `/v1/category-groups/${id}`, { name: "Г" }),
    ];
    expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    expect(await rowCount(space.householdId)).toBe(0);
  });
});

describe("BUD-01@PoC «Права доступу»: every change is in the space's audit log (who, when, before and after)", () => {
  it("BUD-01@PoC «Права доступу»: the system tree, a group and a category created, renamed, hidden, recoloured, «обов'язкова» and merged — each an entry", async () => {
    const space = await newSpace();
    await tree(space);
    const seeded = await audit.entriesFor(space.householdId, {
      type: "categories.tree",
      id: space.householdId,
    });
    expect(seeded).toMatchObject([{ action: "create", actorKind: "system" }]);
    const g = (
      await call(space, "POST", "/v1/category-groups", { name: "Синтетична група", kind: "expense" })
    ).json();
    await call(space, "PATCH", `/v1/category-groups/${g.id}`, { name: "Синтетична група 2" });
    const c = await addCategory(space, "Синтетична група 2", "Синтетична категорія");
    await call(space, "PATCH", `/v1/categories/${c.id}`, { name: "Синтетична 2", hidden: true });
    await call(space, "PATCH", `/v1/categories/${c.id}`, {
      hidden: false,
      color: "#144097",
      essential: true,
    });
    await call(space, "PATCH", `/v1/categories/${c.id}`, { essential: true }); // unchanged: no entry
    await call(space, "POST", `/v1/categories/${c.id}/merge`, {
      targetId: (await category(space, "Хобі")).id,
    });
    const groupLog = await audit.entriesFor(space.householdId, { type: "categories.group", id: g.id });
    expect(groupLog.map((e) => e.action)).toEqual(["create", "update"]);
    expect(groupLog[1]!.changes).toEqual([
      expect.objectContaining({ field: "name", before: "Синтетична група", after: "Синтетична група 2" }),
    ]);
    const log = await audit.entriesFor(space.householdId, { type: "categories.category", id: c.id });
    expect(log.map((e) => e.action)).toEqual(["create", "update", "update", "update"]);
    expect(log.every((e) => e.actorKind === "user" && e.actorId === space.accountId)).toBe(true);
    const fields = (i: number) => log[i]!.changes.map((ch) => ch.field).sort();
    expect(fields(1)).toEqual(["name", "state"]);
    expect(fields(2)).toEqual(["color", "essential", "state"]);
    expect(fields(3)).toEqual(["mergedInto", "state"]);
  });
});

describe("NFR-12@PoC FR 3: a space's categories are erased with it", () => {
  it("NFR-12@PoC FR 3: the erasure deletes the tree, custom categories and the module's events of the space; the neighbour keeps its own", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const coffee = await addCategory(a, "Харчування", "Кава");
    await call(a, "POST", `/v1/categories/${coffee.id}/merge`, {
      targetId: (await category(a, "Продукти")).id,
    });
    await tree(b);
    const erased = await createCategoriesErasure(db.databases.for("categories")).eraseHousehold(
      a.householdId,
    );
    expect(erased).toMatchObject({ categories: 52, groups: 11, events: 1 });
    expect(await rowCount(a.householdId)).toBe(0);
    expect(await events(a.householdId)).toEqual([]);
    expect(await rowCount(b.householdId)).toBe(62);
  });
});

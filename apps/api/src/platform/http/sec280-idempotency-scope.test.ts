import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  householdA,
  householdB,
  memoryIdempotency,
  principalHeader,
  testApp,
  userA,
} from "../../../test/http.ts";
import { accountScopedKey, IDEMPOTENCY_REPLAYED_HEADER, type IdempotencyStore } from "./idempotency.ts";
import { defineRoute } from "./route.ts";

/**
 * Security review of #280 (#272 item 3): the route option `idempotencyScope`. `account` keeps one account's keys from
 * another account of the space and from another space; the default (and `space`) keeps the earlier, space-wide
 * behaviour of every other create route. Synthetic ids only.
 */
const userB = "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e11";
const REPLAYED = IDEMPOTENCY_REPLAYED_HEADER.toLowerCase();

function spyStore(): IdempotencyStore & { keys: string[] } {
  const inner = memoryIdempotency();
  const keys: string[] = [];
  return {
    keys,
    begin: async (h, k, hash) => {
      keys.push(k);
      return inner.begin(h, k, hash);
    },
    complete: (h, k, s, b) => inner.complete(h, k, s, b),
    abandon: (h, k) => inner.abandon(h, k),
  };
}

function route(scope: "space" | "account" | undefined) {
  let n = 0;
  return defineRoute({
    module: "things",
    method: "POST",
    path: "/v1/things",
    operationId: "createThing",
    summary: "Create a thing",
    access: { permission: "things.write", feature: "things" },
    create: true,
    ...(scope ? { idempotencyScope: scope } : {}),
    request: { body: z.strictObject({ name: z.string().min(1).max(20) }) },
    response: { status: 201, description: "Created", schema: z.object({ id: z.number().int() }) },
    handler: async () => ({ id: (n += 1) }),
  });
}

async function setup(scope: "space" | "account" | undefined) {
  const store = spyStore();
  const app = await testApp([route(scope)], { idempotency: () => store });
  const post = (userId: string, householdId: string, key: string, name = "Rent") =>
    app.inject({
      method: "POST",
      url: "/v1/things",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        ...principalHeader({ userId, householdId }),
      },
      payload: { name },
    });
  return { store, post };
}

describe('#280 security: `idempotencyScope: "account"`', () => {
  it("another account of the space with the same key and body runs anew; the author's repeat is a replay", async () => {
    const { post } = await setup("account");
    const first = await post(userA, householdA, "k-1");
    const other = await post(userB, householdA, "k-1");
    expect(other.statusCode).toBe(201);
    expect(other.headers[REPLAYED]).toBeUndefined();
    expect(other.json().id).not.toBe(first.json().id);
    const again = await post(userA, householdA, "k-1");
    expect(again.headers[REPLAYED]).toBe("true");
    expect(again.json().id).toBe(first.json().id);
  });

  it("another account with the same key and another body gets 201, not 409: no oracle that the key exists", async () => {
    const { post } = await setup("account");
    await post(userA, householdA, "k-2", "Rent");
    const other = await post(userB, householdA, "k-2", "Food");
    expect(other.statusCode).toBe(201);
  });

  it("the same account with the same key in another space runs anew (cross-space)", async () => {
    const { post } = await setup("account");
    const first = await post(userA, householdA, "k-3");
    const other = await post(userA, householdB, "k-3");
    expect(other.headers[REPLAYED]).toBeUndefined();
    expect(other.json().id).not.toBe(first.json().id);
  });

  it("the store gets SHA-256 of the account and the key, never the key in the clear", async () => {
    const { store, post } = await setup("account");
    await post(userA, householdA, "k-4");
    expect(store.keys).toEqual([accountScopedKey(userA, "k-4")]);
    expect(store.keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(accountScopedKey(userA, "k-4")).not.toBe(accountScopedKey(userB, "k-4"));
  });
});

describe("#280 security: other routes keep the space-wide default", () => {
  it.each([[undefined], ["space" as const]])(
    "scope %s: another account of the space repeating the key and body gets the stored response, key stored as sent",
    async (scope) => {
      const { store, post } = await setup(scope);
      const first = await post(userA, householdA, "k-5");
      const other = await post(userB, householdA, "k-5");
      expect(other.headers[REPLAYED]).toBe("true");
      expect(other.json().id).toBe(first.json().id);
      expect(store.keys).toEqual(["k-5", "k-5"]);
    },
  );
});

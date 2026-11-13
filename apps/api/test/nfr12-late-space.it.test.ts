import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { rowCount, withTestErasureDatabases } from "./erasure-helpers.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/** Review of PR #143: a space the account gets after its erasure request is erased by the run and by a reapply. */
let db: RealModulesDatabase;
beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});

describe("NFR-12@PoC FR 3: a space created after the request", () => {
  it("NFR-12@PoC FR 3: a first space created within the 30 days is erased with the account", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ws-late-space-"));
    try {
      const email = `late.${randomUUID().slice(0, 8)}@example.test`;
      const { rows } = await db.owner.query<{ id: string }>(
        `INSERT INTO identity.accounts (email, email_normalized, display_name, password_hash, email_confirmed_at)
         VALUES ($1, $1, 'Пізній Простір', '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic', now()) RETURNING id`,
        [email],
      );
      const accountId = rows[0]!.id;
      const erasure = <T>(work: (e: ReturnType<typeof createDataErasure>) => Promise<T>) =>
        withTestErasureDatabases(db, (erasureDatabases) =>
          work(
            createDataErasure({ databases: db.databases, erasureDatabases, log: localErasureLog({ dir }) }),
          ),
        );
      const request = await erasure((e) => e.request({ accountId }));
      expect(request.householdIds).toEqual([]);
      // The person signs in before the owner runs the request: the first space is made then.
      const { householdId } = await householdSpaces(db).ensureFirstSpace({
        accountId,
        displayName: "Пізній Простір",
      });
      expect(await rowCount(db, householdId)).toBeGreaterThan(0);
      const done = await erasure((e) => e.run(request.requestId));
      expect(done).toMatchObject({ state: "completed", householdIds: [householdId] });
      expect(await rowCount(db, householdId)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

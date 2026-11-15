import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { personWithSpace, rowCount, withTestErasureDatabases } from "./erasure-helpers.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

let db: RealModulesDatabase;
beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});

describe("PR 268 security probe: NFR-12@PoC FR 3 — the erasure run takes the space's bulk actions", () => {
  it("NFR-12@PoC FR 3: a space with a bulk action, its records and its jobs has no row left after the request is run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ws-erasure-268-"));
    try {
      const person = await personWithSpace(db, "bulk");
      const h = person.householdId;
      const actionId = randomUUID();
      await db.owner.query(
        `INSERT INTO bulk_actions.actions (household_id, id, actor_id, action, entity, params, background, status,
                                           record_count, created_at, ended_at)
         VALUES ($1, $2, $3, 'test-records.set-label', 'test-records', '{"label":"Синтетика"}', true, 'completed', 1,
                 now(), now())`,
        [h, actionId, person.accountId],
      );
      await db.owner.query(
        `INSERT INTO bulk_actions.items (household_id, action_id, position, record_id, version_before, before, after,
                                         outcome, version_after, run)
         VALUES ($1, $2, 1, $3, 1, '{"label":null}', '{"label":"Синтетика"}', 'changed', 2, 1)`,
        [h, actionId, randomUUID()],
      );
      await db.owner.query(
        `INSERT INTO bulk_actions.jobs (household_id, name, dedupe_key, payload, state)
         VALUES ($1, 'bulk-actions.undo', $2, $3, 'dead')`,
        [h, `undo:${actionId}`, JSON.stringify({ actionId })],
      );
      const t = Date.now();
      await withTestErasureDatabases(db, async (erasureDatabases) => {
        const e = createDataErasure({
          databases: db.databases,
          erasureDatabases,
          log: localErasureLog({ dir }),
          now: () => t,
        });
        const req = await e.request({ email: person.email });
        await e.run(req.requestId);
      });
      const { rows } = await db.owner.query(
        `SELECT (SELECT count(*) FROM bulk_actions.actions WHERE household_id = $1)
              + (SELECT count(*) FROM bulk_actions.items WHERE household_id = $1)
              + (SELECT count(*) FROM bulk_actions.jobs WHERE household_id = $1) AS n`,
        [h],
      );
      expect(Number(rows[0]!.n)).toBe(0);
      expect(await rowCount(db, h)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

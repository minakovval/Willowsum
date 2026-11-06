import type pg from "pg";
import { moduleRoleName, schemaName } from "../modules/rules.ts";

/** Query interface handed to a module's adapters inside one transaction. */
export interface ModuleQueryRunner {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/**
 * Database access for one module (ARC-01 FR 3). Every transaction switches to the module's role and
 * schema, so the database refuses reads and writes of other modules' tables. The pool connects as the
 * application role `ws_app`, which has no table privileges of its own.
 */
export class ModuleDatabase {
  readonly module: string;
  private readonly pool: pg.Pool;
  private readonly role: string;
  private readonly schema: string;

  constructor(pool: pg.Pool, module: string) {
    this.pool = pool;
    this.module = module;
    this.role = moduleRoleName(module);
    this.schema = schemaName(module);
  }

  async transaction<T>(work: (db: ModuleQueryRunner) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${client.escapeIdentifier(this.role)}`);
      await client.query(`SET LOCAL search_path = ${client.escapeIdentifier(this.schema)}`);
      const runner: ModuleQueryRunner = {
        query: (text, values) => {
          assertNoRoleSwitch(text);
          return client.query(text, values as unknown[] | undefined);
        },
      };
      const result = await work(runner);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const ROLE_SWITCH_RE =
  /\b(?:set|reset)\s+(?:(?:local|session)\s+)?(?:role|session\s+authorization|search_path)\b|\bset_config\s*\(/i;

/**
 * Module code must not leave its role or schema: `ws_app` is a member of every module role, so a
 * `SET ROLE` inside module code would bypass the schema boundary. Such statements are refused here, and
 * the dependency rules keep the pg driver out of module code except through this class.
 */
export function assertNoRoleSwitch(text: string): void {
  if (ROLE_SWITCH_RE.test(text)) {
    throw new Error("Module queries may not change the role, session authorization or search_path");
  }
}

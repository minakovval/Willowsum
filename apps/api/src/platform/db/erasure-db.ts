import { randomBytes } from "node:crypto";
import type pg from "pg";
import { ERASABLE_MODULES, erasureRoleName } from "../modules/rules.ts";
import { disableErasureLogin, enableErasureLogin } from "./migrate.ts";
import { ModuleDatabases } from "./module-db.ts";

export { ERASABLE_MODULES } from "../modules/rules.ts";

export interface ErasureDatabasesOptions {
  /** A connection of the migration role (the database owner with CREATEROLE): it alone can let the roles log in. */
  readonly admin: pg.ClientBase;
  /** Connection settings of a pool for `role` with `password` (host, database, TLS of the environment). */
  readonly connectionAs: (role: string, password: string) => pg.PoolConfig;
  /** The binding pool (`ws_context`), as for the module pools. */
  readonly context: pg.PoolConfig;
}

/**
 * One run of the owner's erasure (NFR-12@PoC FR 3, ADR-0013): the erasure roles of `ERASABLE_MODULES` log in with a
 * one-time random password for the length of `work`, through pools bound to one space each transaction like module
 * pools, and lose their login again afterwards — also when `work` fails. No stored password exists for them.
 */
export async function withErasureDatabases<T>(
  options: ErasureDatabasesOptions,
  work: (databases: ModuleDatabases) => Promise<T>,
): Promise<T> {
  const password = randomBytes(24).toString("base64url");
  try {
    for (const module of ERASABLE_MODULES) await enableErasureLogin(options.admin, module, password);
    const databases = new ModuleDatabases({
      connectionFor: (module) => options.connectionAs(erasureRoleName(module), password),
      context: options.context,
      roleFor: erasureRoleName,
      poolSize: 1,
    });
    try {
      return await work(databases);
    } finally {
      await databases.end();
    }
  } finally {
    for (const module of ERASABLE_MODULES) await disableErasureLogin(options.admin, module);
  }
}

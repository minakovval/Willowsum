import pg from "pg";
import { moduleRoleName, schemaName } from "../modules/rules.ts";

/** Query interface handed to a module's adapters inside one transaction. */
export interface ModuleQueryRunner {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/**
 * Database access for one module (ARC-01 FR 3). The pool logs in as the module's own role
 * `ws_mod_<module>`, which has privileges only on the module's schema and is a member of no other role
 * (migrate.ts checks this). Queries to another module's tables are therefore refused by the database,
 * whatever SQL the module sends.
 */
export class ModuleDatabase {
  readonly module: string;
  private readonly pool: pg.Pool;
  private readonly role: string;
  private readonly schema: string;
  private readonly verified = new WeakSet<pg.PoolClient>();

  constructor(pool: pg.Pool, module: string) {
    this.pool = pool;
    this.module = module;
    this.role = moduleRoleName(module);
    this.schema = schemaName(module);
  }

  async transaction<T>(work: (db: ModuleQueryRunner) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      if (!(await this.loggedInAsModuleRole(client))) {
        broken = new Error(`The ${this.module} pool must log in as ${this.role}`);
        throw broken;
      }
      await client.query("BEGIN");
      // pg_temp last: a temporary object can never shadow a module table (and creating one is not allowed).
      await client.query(`SET LOCAL search_path = ${client.escapeIdentifier(this.schema)}, pg_temp`);
      const result = await work({
        query: (text, values) => client.query(text, values as unknown[] | undefined),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (broken) throw error;
      await client.query("ROLLBACK").catch((rollbackError: Error) => {
        broken = rollbackError;
      });
      throw error;
    } finally {
      if (!broken) {
        // No session state survives into the next transaction on this connection.
        await client.query("DISCARD ALL").catch((discardError: Error) => {
          broken = discardError;
        });
      }
      // A connection whose state is unknown is destroyed, not returned to the pool.
      client.release(broken ?? false);
    }
  }

  /** Each new connection must be logged in as the module's role, not as anything broader. */
  private async loggedInAsModuleRole(client: pg.PoolClient): Promise<boolean> {
    if (this.verified.has(client)) return true;
    const { rows } = await client.query<{ session_user: string; current_user: string }>(
      "SELECT session_user, current_user",
    );
    if (rows[0]?.session_user !== this.role || rows[0]?.current_user !== this.role) return false;
    this.verified.add(client);
    return true;
  }
}

export interface ModuleDatabasesConfig {
  /** Connection settings of a module's pool: host, database, user = its role, password from secrets. */
  readonly connectionFor: (module: string) => pg.PoolConfig;
  /** Connections per module pool (default 3). */
  readonly poolSize?: number;
}

/** One small pool per module, created on first use. */
export class ModuleDatabases {
  private readonly config: ModuleDatabasesConfig;
  private readonly pools = new Map<string, { pool: pg.Pool; db: ModuleDatabase }>();

  constructor(config: ModuleDatabasesConfig) {
    this.config = config;
  }

  for(module: string): ModuleDatabase {
    let entry = this.pools.get(module);
    if (!entry) {
      const pool = new pg.Pool({
        max: this.config.poolSize ?? 3,
        idleTimeoutMillis: 30_000,
        ...this.config.connectionFor(module),
      });
      entry = { pool, db: new ModuleDatabase(pool, module) };
      this.pools.set(module, entry);
    }
    return entry.db;
  }

  async end(): Promise<void> {
    await Promise.all([...this.pools.values()].map((e) => e.pool.end()));
    this.pools.clear();
  }
}

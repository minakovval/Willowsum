import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import pg from "pg";
import { moduleRoleName, schemaName } from "../modules/rules.ts";
import { TELEMETRY_SCOPE } from "../telemetry/scope.ts";
import { databaseErrorAttributes, databaseErrorFields } from "./errors.ts";
import { CONTEXT_SCHEMA } from "./isolation.ts";

/** Query interface handed to a module's adapters inside one transaction. */
export interface ModuleQueryRunner {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/**
 * Query interface inside a household transaction (ARC-03 FR 2). Module SQL still filters by
 * `household_id = <householdId>` (the code-side filter); the database policy returns this household's
 * rows only, even when that filter is forgotten.
 */
export interface HouseholdQueryRunner extends ModuleQueryRunner {
  readonly householdId: string;
}

/**
 * Writes the household binding of a module connection (ARC-03; isolation.ts). Its pool logs in as
 * `ws_context`, which may only execute `platform_context.bind`; module roles cannot write a binding.
 */
export class HouseholdBinder {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async bind(pid: number, householdId: string | null): Promise<void> {
    await this.pool.query(`SELECT ${CONTEXT_SCHEMA}.bind($1, $2)`, [pid, householdId]);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Database access for one module (ARC-01 FR 3, ARC-03 FR 2). The pool logs in as the module's own role
 * `ws_mod_<module>`, which has privileges only on the module's schema and is a member of no other role
 * (migrate.ts checks this). Queries to another module's tables are therefore refused by the database,
 * whatever SQL the module sends. Before each transaction the connection is bound to one household (or to
 * none): customer-data tables show only that household's rows. Time is UTC in every transaction.
 */
export class ModuleDatabase {
  readonly module: string;
  private readonly pool: pg.Pool;
  private readonly binder: HouseholdBinder;
  private readonly role: string;
  private readonly schema: string;
  private readonly backendPid = new WeakMap<pg.PoolClient, number>();

  /** `role`: the login role the pool must use — the module's role, or its erasure role (ADR-0013). */
  constructor(pool: pg.Pool, module: string, binder: HouseholdBinder, role = moduleRoleName(module)) {
    this.pool = pool;
    this.module = module;
    this.binder = binder;
    this.role = role;
    this.schema = schemaName(module);
  }

  /** A transaction bound to no household: customer-data tables show no rows and accept none. */
  async transaction<T>(work: (db: ModuleQueryRunner) => Promise<T>): Promise<T> {
    return this.run(null, work);
  }

  /**
   * A transaction bound to one household. Module SQL cannot change the binding; the id itself comes from the
   * caller's TypeScript today — tying it to the authenticated session comes with ARC-07 (access-scope).
   */
  async inHousehold<T>(householdId: string, work: (db: HouseholdQueryRunner) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(householdId)) throw new Error("householdId must be a UUID");
    return this.run(householdId, (q) => work({ ...q, householdId }));
  }

  /**
   * Each transaction is a span (ARC-09): the module and, on failure, the SQLSTATE and the names of the
   * constraint, table, column and schema (NFR-10 FR 2) — never the SQL, its parameters or the message.
   */
  private async run<T>(householdId: string | null, work: (db: ModuleQueryRunner) => Promise<T>): Promise<T> {
    const span = trace.getTracer(TELEMETRY_SCOPE).startSpan(`db.transaction ${this.module}`, {
      kind: SpanKind.CLIENT,
      attributes: { "db.system.name": "postgresql", "ws.module": this.module },
    });
    try {
      return await this.runBound(householdId, work);
    } catch (error) {
      const fields = databaseErrorFields(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttributes({
        "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
        ...(fields ? databaseErrorAttributes(fields) : {}),
      });
      throw error;
    } finally {
      span.end();
    }
  }

  private async runBound<T>(
    householdId: string | null,
    work: (db: ModuleQueryRunner) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    let open = true;
    try {
      const pid = await this.moduleBackendPid(client);
      if (pid === undefined) {
        broken = new Error(`The ${this.module} pool must log in as ${this.role}`);
        throw broken;
      }
      // Bound before any module SQL runs on this connection; the previous binding is replaced.
      await this.binder.bind(pid, householdId).catch((error: Error) => {
        broken = error;
        throw error;
      });
      await client.query("BEGIN");
      // pg_temp last: a temporary object can never shadow a module table (and creating one is not allowed).
      await client.query(`SET LOCAL search_path = ${client.escapeIdentifier(this.schema)}, pg_temp`);
      await client.query(`SET LOCAL TimeZone = 'UTC'`);
      const result = await work({
        query: (text, values) => {
          // A runner kept beyond its transaction would run on a connection that serves someone else.
          if (!open) return Promise.reject(new Error("This transaction has ended"));
          return client.query(text, values as unknown[] | undefined);
        },
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
      open = false;
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
  private async moduleBackendPid(client: pg.PoolClient): Promise<number | undefined> {
    const known = this.backendPid.get(client);
    if (known !== undefined) return known;
    const { rows } = await client.query<{ session_user: string; current_user: string; pid: number }>(
      "SELECT session_user, current_user, pg_backend_pid() AS pid",
    );
    if (rows[0]?.session_user !== this.role || rows[0]?.current_user !== this.role) return undefined;
    this.backendPid.set(client, rows[0].pid);
    return rows[0].pid;
  }
}

export interface ModuleDatabasesConfig {
  /** Connection settings of a module's pool: host, database, user = its role, password from secrets. */
  readonly connectionFor: (module: string) => pg.PoolConfig;
  /** Connection settings of the binding pool: user `ws_context`, password from secrets. */
  readonly context: pg.PoolConfig;
  /** Connections per module pool (default 3). */
  readonly poolSize?: number;
  /** The login role of each pool (default: the module's role; the erasure script passes `erasureRoleName`). */
  readonly roleFor?: (module: string) => string;
}

/** One small pool per module, created on first use, plus one binding pool. */
export class ModuleDatabases {
  private readonly config: ModuleDatabasesConfig;
  private readonly pools = new Map<string, { pool: pg.Pool; db: ModuleDatabase }>();
  private readonly contextPool: pg.Pool;
  private readonly binder: HouseholdBinder;

  constructor(config: ModuleDatabasesConfig) {
    this.config = config;
    this.contextPool = new pg.Pool({ max: 2, idleTimeoutMillis: 30_000, ...config.context });
    this.contextPool.on("error", () => undefined);
    this.binder = new HouseholdBinder(this.contextPool);
  }

  for(module: string): ModuleDatabase {
    let entry = this.pools.get(module);
    if (!entry) {
      const pool = new pg.Pool({
        max: this.config.poolSize ?? 3,
        idleTimeoutMillis: 30_000,
        ...this.config.connectionFor(module),
      });
      // A dropped idle connection (database restart) must not crash the process; the next query reconnects.
      pool.on("error", () => undefined);
      entry = {
        pool,
        db: new ModuleDatabase(pool, module, this.binder, (this.config.roleFor ?? moduleRoleName)(module)),
      };
      this.pools.set(module, entry);
    }
    return entry.db;
  }

  async end(): Promise<void> {
    await Promise.all([...this.pools.values()].map((e) => e.pool.end()));
    this.pools.clear();
    await this.contextPool.end();
  }
}

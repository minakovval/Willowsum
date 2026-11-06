import { randomBytes } from "node:crypto";
import pg from "pg";

/** A throw-away database on the PostgreSQL given by DATABASE_URL (superuser), for integration tests. */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const base = process.env["DATABASE_URL"];
  if (!base)
    throw new Error(
      "Integration tests need DATABASE_URL (PostgreSQL superuser), e.g. from pnpm local:up or the CI service",
    );
  const name = `ws_it_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

/** Same server and database, connecting as another login role. */
export function urlAs(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

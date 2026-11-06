/**
 * One-time step per database (ARC-03, ADR-0002): DATABASE_URL=<superuser> pnpm --filter @willowsum/api db:bootstrap.
 * Closes the large-object functions of pg_catalog to PUBLIC, which only a superuser can do. After it, migrations
 * run as the schema owner with BYPASSRLS and no superuser.
 */
import pg from "pg";
import { bootstrapDatabase } from "../src/platform/db/migrate.ts";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await bootstrapDatabase(client);
  console.log("Database bootstrap: done");
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}

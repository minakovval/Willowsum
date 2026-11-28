// globalSetup of the integration config, after the cluster lock: migrates the real modules once per run into a
// template database; setupRealModules copies it for every suite (`CREATE DATABASE … TEMPLATE`, test/real-modules.ts).
// A full migration per suite took 15–18 s locally and up to 30 s on CI runners, the whole hookTimeout.
// The name is random per run and the run holds the cluster lock, so two runs never share a template; the template
// is dropped at the end of the run (also after a failure in the migration).
import pg from "pg";
import type { TestProject } from "vitest/node";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules } from "./real-modules.ts";

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  if (!process.env["DATABASE_URL"]) return undefined; // the tests fail on their own and name the variable
  const started = performance.now();
  const template = await createTestDatabase({ prefix: "ws_it_tpl_" });
  const owner = new pg.Client({ connectionString: template.url });
  try {
    await owner.connect();
    await migrateRealModules(owner, template.url);
  } catch (error) {
    await owner.end().catch(() => undefined);
    await template.drop().catch(() => undefined);
    throw error;
  }
  // No session may stay connected to a template: CREATE DATABASE … TEMPLATE refuses it.
  await owner.end();
  console.log(
    `Real modules migrated once into ${template.name} (${Math.round(performance.now() - started)} ms); ` +
      "every suite copies it.",
  );
  project.provide("realModulesTemplate", template.name);
  return template.drop;
}

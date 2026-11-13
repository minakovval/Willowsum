/**
 * ARC-04 criterion «Втрачені події при збої процесу»: a worker process that the integration test kills with
 * SIGKILL while it runs jobs. Its `record-thing` runs block forever after writing their effect, so the kill
 * always lands mid-run. Env: WS_Q_DATABASE_URL, WS_Q_PASSWORD, WS_Q_HOUSEHOLDS (comma-separated).
 */
import { ModuleDatabases } from "../../src/platform/db/module-db.ts";
import { CONTEXT_ROLE } from "../../src/platform/db/isolation.ts";
import { moduleRoleName } from "../../src/platform/modules/rules.ts";
import { createWorker } from "../../src/platform/queue/index.ts";
import { urlAs } from "../db.ts";
import { behaviour, queueSetup } from "../queue-fixture.ts";

const url = process.env["WS_Q_DATABASE_URL"]!;
const password = process.env["WS_Q_PASSWORD"]!;
const households = process.env["WS_Q_HOUSEHOLDS"]!.split(",");
const databases = new ModuleDatabases({
  connectionFor: (module) => ({ connectionString: urlAs(url, moduleRoleName(module), password) }),
  context: { connectionString: urlAs(url, CONTEXT_ROLE, password) },
});
const b = behaviour();
b.block = "forever";
b.onRun = (_name, key) => console.log(`RUNNING ${key}`);
createWorker({ ...queueSetup(databases, b), households: async () => households, pollMs: 50 }).start();

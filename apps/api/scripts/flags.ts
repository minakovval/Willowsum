/**
 * Changes feature flags, module kill switches and test spaces in a running environment (CICD-06), through the
 * feature-flags module's internal interface: every change is audited and reaches every API process within
 * 15 s, without a release. Uses the same configuration as the processes (WS_DB_*, the module passwords);
 * staff run it as an allowlisted production action until the owner's admin screen (ADM) calls FlagAdmin.
 *   node scripts/flags.ts state | rollout <flag> <stage> | kill <module> | revive <module> | test-space <id> on|off --actor <uuid>
 */
import { readFileSync } from "node:fs";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createFlagAdminFor, FLAGS, utcDay } from "../src/modules/feature-flags/index.ts";
import { ConfigError, loadConfig } from "../src/platform/config/config.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import { FLAGS_USAGE, parseFlagCommand, rolloutReminder, type FlagCommand } from "./lib/flags-cli.ts";

const modules = topologicalOrder(
  JSON.parse(readFileSync(new URL("../module-rules.json", import.meta.url), "utf8")) as ModuleRules,
);

let command: FlagCommand;
try {
  command = parseFlagCommand(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}\n${FLAGS_USAGE}`);
  process.exit(2);
}

let databases: ModuleDatabases;
try {
  const { database } = loadConfig(process.env, "worker", modules);
  const connection = { host: database.host, port: database.port, database: database.name, ssl: database.ssl };
  databases = new ModuleDatabases({
    connectionFor: (module) => ({
      ...connection,
      user: moduleRoleName(module),
      password: database.modulePasswords.get(module) ?? "",
    }),
    context: { ...connection, user: CONTEXT_ROLE, password: database.contextPassword },
    poolSize: 1,
  });
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : "Configuration error");
  process.exit(1);
}

const admin = createFlagAdminFor(
  databases.for("feature-flags"),
  createAuditLog(databases.for("audit")),
  modules,
);
try {
  switch (command.kind) {
    case "state": {
      const state = await admin.state();
      console.log(
        JSON.stringify(
          {
            flags: Object.fromEntries(state.rollouts),
            killed: [...state.killed].sort(),
            overdue: await admin.overdue(new Date()),
          },
          null,
          2,
        ),
      );
      break;
    }
    case "rollout": {
      console.log(JSON.stringify(await admin.setRollout(command.actor, command.key, command.rollout)));
      const reminder = rolloutReminder(command.key, command.rollout, FLAGS, utcDay(new Date()));
      if (reminder) console.log(reminder);
      break;
    }
    case "kill-switch":
      console.log(JSON.stringify(await admin.setKillSwitch(command.actor, command.module, command.disabled)));
      break;
    case "test-space":
      console.log(
        JSON.stringify(await admin.setTestHousehold(command.actor, command.householdId, command.isTest)),
      );
      break;
  }
} catch (error) {
  // Only our own validation messages: database errors may hold connection details.
  console.error(
    error instanceof Error && /^Unknown (flag|module)/.test(error.message)
      ? error.message
      : "The change failed",
  );
  process.exitCode = 1;
} finally {
  await databases.end();
}

/**
 * Records new event versions in events.snapshot.json (ARC-01, «Каталог подій»). Refuses incompatible
 * changes of a published version: publish a new version instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { modules } from "../src/modules/index.ts";
import { nextSnapshot, type EventSnapshot } from "../src/platform/events/catalogue.ts";

const file = fileURLToPath(new URL("../events.snapshot.json", import.meta.url));
const current = JSON.parse(readFileSync(file, "utf8")) as EventSnapshot;
try {
  writeFileSync(file, `${JSON.stringify(nextSnapshot(modules, current), null, 2)}\n`);
  console.log("events.snapshot.json updated");
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

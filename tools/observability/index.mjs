#!/usr/bin/env node
// Створено: 2026-11-07 · Оновлено: 2026-11-07
//
// SLOs and alert rules as code (ARC-09 FR 4, NFR-10 FR 5–6, ADR-0006).
//
//   node tools/observability/index.mjs --check   validate the rules; fail if infra/observability/ is out of date
//   node tools/observability/index.mjs --write   regenerate infra/observability/ from definitions.mjs
//
// `pnpm check:alerts` runs --check (CI job `infra`). Zero dependencies, Node 22.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as defs from "./definitions.mjs";
import { generate, validate } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../infra/observability");
const mode = process.argv.includes("--write") ? "write" : "check";

const problems = validate(defs);
if (problems.length > 0) {
  for (const p of problems) console.error(`error: ${p}`);
  process.exit(1);
}
const files = generate(defs);
const stale = [];
for (const [name, text] of Object.entries(files)) {
  const file = path.join(outDir, name);
  if (mode === "write") fs.writeFileSync(file, text);
  else if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) stale.push(name);
}
if (stale.length > 0) {
  console.error(
    `error: infra/observability/${stale.join(", ")} out of date. Run: node tools/observability/index.mjs --write`,
  );
  process.exit(1);
}
console.log(
  `ok: ${defs.ALERTS.length} alerts, ${defs.RECORDING_RULES.length} recording rules, ${defs.SLOS.length} SLOs` +
    (mode === "write" ? " (written)" : ""),
);

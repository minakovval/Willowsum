/**
 * Synthetic data for tests and staging (ARC-03 FR 6):
 *   node tools/synthetic/index.ts --out <dir> [--seed willowsum] [--households 1] [--format csv|sql]
 *                                 [--count <schema.table>=<rows per household>] …
 * Writes one CSV per table (or one psql script). Generators come from apps/api/src/modules/<module>/synthetic.ts.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generate, loadModuleGenerators, toCsv, toSql } from "./src/index.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    seed: { type: "string", default: "willowsum" },
    households: { type: "string", default: "1" },
    format: { type: "string", default: "csv" },
    count: { type: "string", multiple: true, default: [] },
    modules: { type: "string", default: fileURLToPath(new URL("../../apps/api/src/modules", import.meta.url)) },
  },
});
const households = Number.parseInt(values.households, 10);
if (!values.out || !Number.isInteger(households) || households < 1 || !["csv", "sql"].includes(values.format)) {
  console.error("Usage: index.ts --out <dir> [--seed s] [--households n] [--format csv|sql] [--count schema.table=n]");
  process.exit(2);
}
const counts: Record<string, number> = {};
for (const pair of values.count) {
  const [table, n] = pair.split("=");
  const rows = Number.parseInt(n ?? "", 10);
  if (!table || !Number.isInteger(rows) || rows < 0) {
    console.error(`--count ${pair}: expected <schema.table>=<rows>`);
    process.exit(2);
  }
  counts[table] = rows;
}

const tables = await loadModuleGenerators(values.modules);
const rows = generate({ seed: values.seed, households, tables, counts });
mkdirSync(values.out, { recursive: true });

const write = (stream: NodeJS.WritableStream, text: string): Promise<void> =>
  new Promise((resolve) => (stream.write(text) ? resolve() : stream.once("drain", resolve)));
const close = (stream: NodeJS.WritableStream): Promise<void> => new Promise((resolve) => stream.end(resolve));

const written = new Map<string, number>();
if (values.format === "sql") {
  const out = createWriteStream(path.join(values.out, "synthetic.sql"));
  const counted = (function* () {
    for (const r of rows) {
      written.set(r.table, (written.get(r.table) ?? 0) + 1);
      yield r;
    }
  })();
  for (const text of toSql(counted)) await write(out, text);
  await close(out);
} else {
  let current: { table: string; stream: NodeJS.WritableStream } | undefined;
  for (const chunk of toCsv(rows)) {
    if (chunk.header) {
      if (current) await close(current.stream);
      current = { table: chunk.table, stream: createWriteStream(path.join(values.out, `${chunk.table}.csv`)) };
      written.set(chunk.table, 0);
    } else {
      written.set(chunk.table, (written.get(chunk.table) ?? 0) + 1);
    }
    await write(current!.stream, chunk.text);
  }
  if (current) await close(current.stream);
}
console.log(
  JSON.stringify({ seed: values.seed, households, format: values.format, tables: Object.fromEntries(written) }),
);

/**
 * A family's synthetic bank statements for import-template regression and end-to-end scenarios (ARC-03 FR 6):
 *   node tools/synthetic/family.ts --out <dir> [--seed willowsum] [--start 2024-01-01] [--years 2|3]
 * Writes <bank>/<account>-<year>.csv|xlsx and truth.json (accounts, transactions, transfers, file → row → transaction).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateFamily } from "./src/family/index.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    seed: { type: "string", default: "willowsum" },
    start: { type: "string", default: "2024-01-01" },
    years: { type: "string", default: "2" },
  },
});
if (!values.out || !["2", "3"].includes(values.years) || !/^\d{4}-\d{2}-01$/.test(values.start)) {
  console.error("Usage: family.ts --out <dir> [--seed s] [--start YYYY-MM-01] [--years 2|3]");
  process.exit(2);
}
const { truth, statements } = generateFamily({ seed: values.seed, start: values.start, years: values.years === "3" ? 3 : 2 });
for (const s of statements) {
  const file = path.join(values.out, s.file.path);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, s.bytes);
}
mkdirSync(values.out, { recursive: true });
writeFileSync(path.join(values.out, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
console.log(
  JSON.stringify({
    seed: truth.seed,
    from: truth.from,
    to: truth.to,
    accounts: truth.accounts.length,
    transactions: truth.transactions.length,
    transfers: truth.transfers.length,
    files: statements.map((s) => s.file.path),
  }),
);

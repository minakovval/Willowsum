/**
 * The update of the built-in directory of banks (FIN-01@PoC FR 4; accounts README «Довідник установ»): rebuilds
 * `src/modules/accounts/adapters/banks/nbu-banks.json` from the NBU's public list of banks (head banks, JSON), keeps the
 * display names already curated, and prints the codes added and removed so a person checks them before the commit. The
 * API never calls the NBU: only this script, run by hand before a release.
 *   node scripts/nbu-banks.ts [--from <downloaded NBU JSON>] [--as-of YYYY-MM-DD] [--check]
 * Without --from it downloads the list from the source URL of the file. --check writes nothing and exits 1 when the
 * file would change.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { importNbuBanks, parseBankRegistry } from "../src/modules/accounts/domain/index.ts";
import { BANK_REGISTRY_FILE } from "../src/modules/accounts/adapters/banks/registry.ts";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const current = parseBankRegistry(JSON.parse(readFileSync(BANK_REGISTRY_FILE, "utf8")));
const from = option("--from");
const asOf = option("--as-of") ?? new Date().toISOString().slice(0, 10);

let rows: unknown;
if (from) {
  rows = JSON.parse(readFileSync(from, "utf8"));
} else {
  const response = await fetch(current.source.url);
  if (!response.ok) {
    console.error(`NBU list: HTTP ${response.status}`);
    process.exit(1);
  }
  rows = await response.json();
}
if (!Array.isArray(rows)) {
  console.error("NBU list: not a JSON array");
  process.exit(1);
}

const result = importNbuBanks(rows, current, asOf);
if (result.registry.banks.length === 0) {
  console.error("NBU list: no bank read — check the field names (GLMFO or MFO, SHORTNAME, N_STAN)");
  process.exit(1);
}
const { asOf: date, seed, source, banks } = result.registry;
const text = `${JSON.stringify({ registry: "nbu-banks", seed, asOf: date, source, banks }, null, 2)}\n`;
// The file must stay readable by the API (same checks as at start).
parseBankRegistry(JSON.parse(text));

console.log(
  `banks: ${banks.length}; added: ${result.added.join(", ") || "—"}; removed: ${result.removed.join(", ") || "—"}`,
);
if (result.added.length > 0) console.log("Check the display names of the added banks before the commit.");
if (process.argv.includes("--check")) {
  process.exit(readFileSync(BANK_REGISTRY_FILE, "utf8") === text ? 0 : 1);
}
writeFileSync(BANK_REGISTRY_FILE, text);

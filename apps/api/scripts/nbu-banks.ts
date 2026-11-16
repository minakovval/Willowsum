/**
 * The update of the built-in directory of banks (FIN-01@PoC FR 4; accounts README «Довідник установ»): rebuilds
 * `src/modules/accounts/adapters/banks/nbu-banks.json` from the NBU's public list of banks (head banks, JSON), keeps the
 * display names already curated, and prints the codes added and removed so a person checks them before the commit. The
 * API never calls the NBU: only this script, run by hand before a release, and at most once a day (owner, 2026-11-16):
 * when the file is already from today's list it does not download again unless --force. Usage: NBU_BANKS_USAGE.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { importNbuBanks, parseBankRegistry } from "../src/modules/accounts/domain/index.ts";
import { BANK_REGISTRY_FILE } from "../src/modules/accounts/adapters/banks/registry.ts";
import {
  kyivDate,
  listDate,
  mayDownload,
  NBU_BANKS_USAGE,
  parseNbuBanksCommand,
  type NbuBanksCommand,
} from "./lib/nbu-banks-cli.ts";

let command: NbuBanksCommand;
try {
  command = parseNbuBanksCommand(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}\n${NBU_BANKS_USAGE}`);
  process.exit(2);
}

const current = parseBankRegistry(JSON.parse(readFileSync(BANK_REGISTRY_FILE, "utf8")));
const today = kyivDate(new Date());

let rows: unknown;
if (command.from !== undefined) {
  rows = JSON.parse(readFileSync(command.from, "utf8"));
} else if (!mayDownload(command, current.asOf, today)) {
  console.log(
    `The directory is already from the NBU list of ${today}; not downloading again (--force to override).`,
  );
  process.exit(0);
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

const result = importNbuBanks(rows, current, listDate(command, current.asOf, today));
if (result.registry.banks.length === 0) {
  console.error("NBU list: no bank read — check the field names (GLMFO or MFO, SHORTNAME, N_STAN)");
  process.exit(1);
}
const { asOf, seed, source, banks } = result.registry;
const text = `${JSON.stringify({ registry: "nbu-banks", seed, asOf, source, banks }, null, 2)}\n`;
// The file must stay readable by the API (same checks as its test).
parseBankRegistry(JSON.parse(text));

console.log(
  `banks: ${banks.length}; added: ${result.added.join(", ") || "—"}; removed: ${result.removed.join(", ") || "—"}`,
);
if (command.check) process.exit(readFileSync(BANK_REGISTRY_FILE, "utf8") === text ? 0 : 1);
if (result.added.length > 0) console.log("Check the display names of the added banks before the commit.");
writeFileSync(BANK_REGISTRY_FILE, text);

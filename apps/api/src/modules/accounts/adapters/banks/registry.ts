import { readFileSync } from "node:fs";
import { parseBankRegistry, type BankRegistry } from "../../domain/index.ts";

/** The file of the built-in directory of banks (FIN-01 FR 4): versioned in the repository, read once, no network. */
export const BANK_REGISTRY_FILE = new URL("./nbu-banks.json", import.meta.url);

let loaded: BankRegistry | undefined;

/** The directory, parsed and checked on first use (a broken file fails loudly, never a half directory). */
export function bankRegistry(): BankRegistry {
  loaded ??= parseBankRegistry(JSON.parse(readFileSync(BANK_REGISTRY_FILE, "utf8")));
  return loaded;
}

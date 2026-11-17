import { INSTITUTION_NAME_MAX, oneLine, type Institution } from "./accounts.ts";

/**
 * «Банк або установа» (FIN-01@PoC FR 4): the built-in directory of Ukrainian banks by the list of the National Bank of
 * Ukraine. A bank picked from it is the institution with its name and the country «Україна»; «Інша установа» is a name
 * and a country typed by hand (`institutionOf`) and never changes the directory. The directory ships with the app
 * (a versioned file, no service at run time) and is refreshed from the NBU list with releases (lead decision, #213).
 */
export const BANK_COUNTRY = "UA";

/** A bank of the directory; `code` — the bank's code (МФО, 6 digits), the key of the NBU list. */
export interface Bank {
  readonly code: string;
  /** The name the form shows and the account keeps. */
  readonly name: string;
  /** The NBU's short legal name, when imported; searched too. */
  readonly legalName?: string;
}

export interface BankRegistrySource {
  readonly name: string;
  readonly url: string;
  readonly licence: string;
  readonly attribution: string;
}

export interface BankRegistry {
  /** The date of the NBU list the file was built from (YYYY-MM-DD). */
  readonly asOf: string;
  /** A hand-made seed list, not yet a full import of the NBU list. */
  readonly seed: boolean;
  readonly source: BankRegistrySource;
  readonly banks: readonly Bank[];
}

const CODE_RE = /^\d{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`bank registry: ${what} is not a text`);
  return value;
}

/**
 * Reads the directory file and refuses a broken one (a wrong shape, a code that is not 6 digits, a name that is not one
 * line of 1–100 characters, two banks with one code), so a bad update fails its test and the start of the API instead
 * of reaching a form.
 */
export function parseBankRegistry(raw: unknown): BankRegistry {
  if (typeof raw !== "object" || raw === null) throw new Error("bank registry: not an object");
  const file = raw as Record<string, unknown>;
  if (file["registry"] !== "nbu-banks") throw new Error("bank registry: registry is not nbu-banks");
  const asOf = text(file["asOf"], "asOf");
  if (!DATE_RE.test(asOf)) throw new Error("bank registry: asOf is not YYYY-MM-DD");
  if (typeof file["seed"] !== "boolean") throw new Error("bank registry: seed is not a boolean");
  const source = file["source"] as Record<string, unknown> | undefined;
  if (typeof source !== "object" || source === null) throw new Error("bank registry: no source");
  const list = file["banks"];
  if (!Array.isArray(list) || list.length === 0) throw new Error("bank registry: no banks");
  const seen = new Set<string>();
  const banks = list.map((item: unknown, i): Bank => {
    const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const code = row["code"];
    if (typeof code !== "string" || !CODE_RE.test(code)) throw new Error(`bank registry: banks[${i}].code`);
    if (seen.has(code)) throw new Error(`bank registry: duplicate code ${code}`);
    seen.add(code);
    const name = typeof row["name"] === "string" ? oneLine(row["name"], INSTITUTION_NAME_MAX) : null;
    if (name === null || name !== row["name"]) throw new Error(`bank registry: banks[${i}].name`);
    const legal = row["legalName"];
    if (legal === undefined) return { code, name };
    if (typeof legal !== "string" || oneLine(legal, 300) !== legal)
      throw new Error(`bank registry: banks[${i}].legalName`);
    return { code, name, legalName: legal };
  });
  return {
    asOf,
    seed: file["seed"],
    source: {
      name: text(source["name"], "source.name"),
      url: text(source["url"], "source.url"),
      licence: text(source["licence"], "source.licence"),
      attribution: text(source["attribution"], "source.attribution"),
    },
    banks,
  };
}

/** Search text: NFC, lower case, no quotes, one space. */
function folded(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("uk")
    .replace(/["'«»„“”’ʼ`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

const collator = new Intl.Collator("uk");

/**
 * The search of the field «Банк або установа» (FIN-01 FR 4, AC22): banks whose name or legal name contains the typed
 * text, regardless of case and quotes; names that start with it first, then by name. An empty text — every bank.
 */
export function searchBanks(registry: BankRegistry, query: string): Bank[] {
  const q = folded(query);
  const hits = registry.banks.filter(
    (b) =>
      q === "" ||
      folded(b.name).includes(q) ||
      (b.legalName !== undefined && folded(b.legalName).includes(q)),
  );
  const starts = (b: Bank) => (q !== "" && folded(b.name).startsWith(q) ? 0 : 1);
  return hits.sort(
    (a, b) => starts(a) - starts(b) || collator.compare(a.name, b.name) || a.code.localeCompare(b.code),
  );
}

/** The institution of an account for a bank picked from the directory: its name and «Україна» (lead decision, #213). */
export function bankInstitution(bank: Bank): Institution {
  return { name: bank.name, country: BANK_COUNTRY };
}

/**
 * Legal forms and bank abbreviations the NBU short name starts with, alone or one after another, with or without
 * quotes (e.g. `АТ КБ "ПриватБанк"`, `ПуАТ "КБ "АКОРДБАНК"`, `Акціонерний банк "Південний"`).
 */
const LEGAL_PREFIX =
  /^["«„“”]?(?:(?:ПУБЛІЧНЕ|ПРИВАТНЕ)\s+)?(?:АКЦІОНЕРНЕ\s+ТОВАРИСТВО|АКЦІОНЕРНИЙ\s+БАНК|ПрАТ|ПуАТ|ПАТ|АТ|КБ|АБ|АКБ)(?=[\s"«„“”])\s*/iu;

/** A display name from the NBU short name: without the legal form and the quotes; the NBU's letter case is kept. */
export function displayNameOf(shortName: string): string {
  let rest = shortName.normalize("NFC").trim();
  for (let prev = ""; prev !== rest;) {
    prev = rest;
    rest = rest.replace(LEGAL_PREFIX, "");
  }
  return rest
    .replace(/["«»„“”]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export interface NbuImport {
  readonly registry: BankRegistry;
  /** Codes new in the NBU list (their names derived — check them before the commit). */
  readonly added: readonly string[];
  /** Codes gone from the NBU list. Accounts keep the name they were created with. */
  readonly removed: readonly string[];
}

/**
 * Builds the directory from the rows of the NBU list of banks (the update script, `scripts/nbu-banks.ts`): one bank per
 * code (МФО: `GLMFO`, else `MFO`), the legal name `SHORTNAME`; a row whose status `N_STAN` is there and is not
 * «Нормальний» is left out. A bank already in the directory keeps its display name (names are curated once), a new one
 * gets `displayNameOf`. The field names are those of the NBU JSON (checked by the first full import, 2026-11-16).
 */
export function importNbuBanks(rows: readonly unknown[], current: BankRegistry, asOf: string): NbuImport {
  const known = new Map(current.banks.map((b) => [b.code, b]));
  const banks = new Map<string, Bank>();
  for (const item of rows) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const status = row["N_STAN"];
    if (typeof status === "string" && status.trim() !== "" && folded(status) !== "нормальний") continue;
    const rawCode = row["GLMFO"] ?? row["MFO"];
    const code =
      typeof rawCode === "number" || typeof rawCode === "string"
        ? String(rawCode).trim().padStart(6, "0")
        : "";
    const legal = typeof row["SHORTNAME"] === "string" ? oneLine(row["SHORTNAME"], 300) : null;
    if (!CODE_RE.test(code) || legal === null || banks.has(code)) continue;
    const name = known.get(code)?.name ?? oneLine(displayNameOf(legal), INSTITUTION_NAME_MAX);
    if (name === null) continue;
    banks.set(code, { code, name, legalName: legal });
  }
  const list = [...banks.values()].sort(
    (a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code),
  );
  const registry: BankRegistry = { ...current, asOf, seed: false, banks: list };
  return {
    registry,
    added: list.filter((b) => !known.has(b.code)).map((b) => b.code),
    removed: current.banks.filter((b) => !banks.has(b.code)).map((b) => b.code),
  };
}

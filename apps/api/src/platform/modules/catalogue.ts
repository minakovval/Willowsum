import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** One row of the module catalogue in docs/requirements/arc/ARC-01*.md (all release slices). */
export interface CatalogueEntry {
  readonly name: string;
  /** Domain column, e.g. «Платформа», «Гроші». */
  readonly domain: string;
  /** «Що належить модулю» — what the module owns. */
  readonly owns: string;
}

export type ModuleLayer = "platform" | "subject" | "process";

/** Folder of the ARC-01 card and its release views (the only docs/ path code reads; ci-paths guard). */
const ARC_DIR = "docs/requirements/arc";

const ROW_RE = /^\| ([^|]+?) \| ([a-z][a-z0-9-]*) \| ([^|]+?) \|\s*$/;

/** Parses the catalogue tables of the ARC-01 slices. The first slice that names a module wins. */
export function parseCatalogue(markdownFiles: readonly string[]): Map<string, CatalogueEntry> {
  const entries = new Map<string, CatalogueEntry>();
  for (const text of markdownFiles) {
    for (const line of text.split("\n")) {
      const match = ROW_RE.exec(line);
      if (!match) continue;
      const [, domain, name, owns] = match as unknown as [string, string, string, string];
      if (!entries.has(name)) entries.set(name, { name, domain: domain.trim(), owns: owns.trim() });
    }
  }
  return entries;
}

/** Reads the catalogue from the repository (the requirement is the single source of truth). */
export function readCatalogue(repoRoot: string): Map<string, CatalogueEntry> {
  const dir = path.join(repoRoot, ARC_DIR);
  const files = readdirSync(dir)
    .filter((f) => /^ARC-01(\.[a-z0-9-]+)?\.md$/.test(f))
    .sort((a, b) => sliceOrder(a) - sliceOrder(b));
  return parseCatalogue(files.map((f) => readFileSync(path.join(dir, f), "utf8")));
}

/**
 * The catalogue of one release view only (`ARC-01.<key>.md`, e.g. «poc»): the modules of that release
 * (ARC-01@PoC FR 1).
 */
export function readReleaseCatalogue(repoRoot: string, releaseKey: string): Map<string, CatalogueEntry> {
  if (!SLICE_ORDER.includes(releaseKey)) throw new Error(`Unknown release key «${releaseKey}»`);
  const file = path.join(repoRoot, ARC_DIR, `ARC-01.${releaseKey}.md`);
  return parseCatalogue([readFileSync(file, "utf8")]);
}

const SLICE_ORDER = ["poc", "poc-v2", "mvp", "v1-mobile", "v1", "v2"];

function sliceOrder(file: string): number {
  const key = /^ARC-01\.([a-z0-9-]+)\.md$/.exec(file)?.[1];
  if (key === undefined) return SLICE_ORDER.length; // the card itself comes last
  const index = SLICE_ORDER.indexOf(key);
  return index === -1 ? SLICE_ORDER.length : index;
}

/**
 * Process modules only collect other modules' data or orchestrate them (ARC-01, «Напрям залежностей»:
 * платформа ← предметні модулі ← процесні модулі — бюджет, звіти, планування, Головна).
 */
const PROCESS_MODULES = new Set([
  "budget",
  "cashflow",
  "goals",
  "debt-payoff",
  "reports",
  "planning",
  "dashboard",
  "weekly-digest",
  "advisor",
]);

const PLATFORM_DOMAINS = new Set(["Платформа", "Спільні функції"]);

/** Default dependency layer of a catalogue module. */
export function defaultLayer(entry: CatalogueEntry): ModuleLayer {
  if (PROCESS_MODULES.has(entry.name)) return "process";
  if (PLATFORM_DOMAINS.has(entry.domain)) return "platform";
  return "subject";
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ARC-05 FR 1: the provider SDK list (apps/api/provider-sdks.json) and the places allowed to import them.
 * Shared by the dependency analyzer (scripts/lib/dependency-rules.ts) and its tests; eslint.config.js reads
 * the same JSON file for the other packages.
 */
export interface ProviderSdkList {
  readonly packages: readonly string[];
}

export const PROVIDER_SDK_FILE = fileURLToPath(new URL("../../provider-sdks.json", import.meta.url));

/** Paths (relative to apps/api) where a provider SDK may be imported: adapters only. */
export const ADAPTER_PATHS = ["^src/modules/[^/]+/adapters/", "^src/platform/adapters/"];

/** The same for the other workspace packages (relative to the repository root): the web app's adapters. */
export const WORKSPACE_ADAPTER_PATHS = ["^apps/web/src/adapters/"];

const PACKAGE_RE = /^(@[a-z0-9][a-z0-9._-]*\/(\*|[a-z0-9][a-z0-9._-]*)|[a-z0-9][a-z0-9._-]*)$/;

export function readProviderSdks(file = PROVIDER_SDK_FILE): ProviderSdkList {
  const list = JSON.parse(readFileSync(file, "utf8")) as ProviderSdkList;
  for (const name of list.packages) {
    if (!PACKAGE_RE.test(name))
      throw new Error(`provider-sdks.json: «${name}» is not a package name or scope/*`);
  }
  return list;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regular expressions matching an import of the package as dependency-cruiser resolves it: hoisted
 * `node_modules/<name>/`, pnpm's `node_modules/.pnpm/<name with + for />@`, or — not installed — the bare
 * specifier itself (an unresolved import still names the SDK).
 */
export function providerSdkPaths(name: string): string[] {
  const [scope, rest] = name.startsWith("@") ? (name.split("/") as [string, string]) : [undefined, name];
  const pkg = rest === "*" ? "[^/@]+" : esc(rest);
  const full = scope ? `${esc(scope)}/${pkg}` : pkg;
  const flat = scope ? `${esc(scope)}\\+${pkg}` : pkg;
  return [`(^|/)node_modules/${full}/`, `(^|/)node_modules/\\.pnpm/${flat}@`, `^${full}(/|$)`];
}

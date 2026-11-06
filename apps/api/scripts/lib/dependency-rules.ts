import type { IForbiddenRuleType } from "dependency-cruiser";
import type { ModuleRules } from "../../src/platform/modules/rules.ts";

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Paths of an npm package as resolved on disk: hoisted, or pnpm's `node_modules/.pnpm/<name>@<version>/`. */
function packagePaths(name: string): string[] {
  return [`(^|/)node_modules/${esc(name)}/`, `(^|/)node_modules/\\.pnpm/${esc(name.replace("/", "+"))}@`];
}

/** Packages a domain layer may import: pure code only (ARC-01 FR 5). */
export const DOMAIN_ALLOWED_PACKAGES = ["zod", "decimal.js"];

/**
 * dependency-cruiser rules derived from module-rules.json (ARC-01 FR 4, FR 5 and the criteria table:
 * internal imports, cycles and domain purity — 0 each). Paths are relative to apps/api.
 */
export function buildForbiddenRules(rules: ModuleRules): IForbiddenRuleType[] {
  const forbidden: IForbiddenRuleType[] = [
    {
      name: "no-circular",
      comment: "Circular imports are not allowed (ARC-01 FR 4).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "unresolvable",
      comment: "Every import must resolve; an unresolved import would escape the other rules.",
      severity: "error",
      from: { path: "^src/" },
      to: { couldNotResolve: true },
    },
    {
      name: "module-internals",
      comment:
        "Another module is reachable only through its public interface src/modules/<name>/index.ts (ARC-01 FR 2).",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/[^/]+/", pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"] },
    },
    {
      name: "domain-pure",
      comment:
        "The domain layer has no I/O: only its own domain files, the domain kernel, zod and decimal.js (ARC-01 FR 5).",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/domain/", pathNot: "\\.test\\.ts$" },
      to: {
        pathNot: [
          "^src/modules/$1/domain/",
          "(^|/)packages/domain-kernel/src/",
          ...DOMAIN_ALLOWED_PACKAGES.flatMap((p) => packagePaths(p)),
        ],
      },
    },
    {
      name: "application-not-to-adapters",
      comment: "The application layer uses ports; adapters are wired in the module's index.ts (ARC-01 FR 5).",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/application/", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/modules/$1/adapters/" },
    },
    {
      name: "no-db-driver-in-modules",
      comment:
        "Modules reach the database only through platform/db (ModuleDatabase), which pins their role and schema.",
      severity: "error",
      from: { path: "^src/modules/" },
      to: { path: ["pg", "@types/pg"].flatMap((p) => packagePaths(p)) },
    },
    {
      name: "platform-not-to-modules",
      comment: "Platform code (src/platform) knows nothing about business modules.",
      severity: "error",
      from: { path: "^src/platform/" },
      to: { path: "^src/modules/" },
    },
  ];
  for (const [name, rule] of Object.entries(rules.modules)) {
    const allowed = [name, ...rule.dependsOn].map(esc).join("|");
    forbidden.push({
      name: `undeclared-dependency:${name}`,
      comment: `${name} may import only the modules listed in module-rules.json: ${rule.dependsOn.join(", ") || "none"}.`,
      severity: "error",
      from: { path: `^src/modules/${esc(name)}/` },
      to: { path: "^src/modules/[^/]+/", pathNot: `^src/modules/(${allowed})/` },
    });
  }
  return forbidden;
}

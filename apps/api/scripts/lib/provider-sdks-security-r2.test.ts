import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as analyze from "./analyze.ts";
import { checkModules } from "./check.ts";
import { readProviderSdks } from "./provider-sdks.ts";
import { STATIC_ANALYSIS_TIMEOUT_MS } from "../../../../tools/test-guards/budgets.mjs";

// Static analysis of real source trees: budget and its basis in tools/test-guards/budgets.mjs.
vi.setConfig({ testTimeout: STATIC_ANALYSIS_TIMEOUT_MS });

// Security review of ARC-05 (PR #84), round 2: the willowsum/no-provider-sdk-load ESLint rule and the
// dependency analyzer over apps/web, packages/* and tools/synthetic.

vi.mock("./analyze.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof analyze>();
  return { ...actual, analyzeWorkspaceSdks: vi.fn(actual.analyzeWorkspaceSdks) };
});

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const apiDir = fileURLToPath(new URL("../..", import.meta.url));
const sdks = readProviderSdks();

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ws-sdk-r2-"));
  for (const [file, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), code);
  }
  return dir;
}
const sdkFrom = async (files: Record<string, string>) =>
  (await analyze.analyzeWorkspaceSdks(tree(files), sdks)).map((v) =>
    v.replace("provider-sdk-outside-adapter: ", ""),
  );

describe("security ARC-05 r2: dependency analyzer over the other workspace packages", () => {
  it("the web adapter allowance is exactly apps/web/src/adapters/", async () => {
    const use = 'import s from "stripe";\nexport const y = s;\n';
    expect(
      await sdkFrom({
        "apps/web/src/adapters/ok.ts": use,
        "apps/web/src/adapters-evil/a.ts": use,
        "apps/web/src/screens/adapters/a.ts": use,
        "apps/web/src/adaptersx.ts": use,
        "packages/ui/src/adapters/a.ts": use,
      }),
    ).toEqual([
      "apps/web/src/adapters-evil/a.ts → stripe",
      "apps/web/src/adaptersx.ts → stripe",
      "apps/web/src/screens/adapters/a.ts → stripe",
      "packages/ui/src/adapters/a.ts → stripe",
    ]);
  });

  it("type-only imports and folders of any name are checked", async () => {
    expect(
      await sdkFrom({
        "apps/web/src/types.ts": 'import type { Stripe } from "stripe";\nexport type S = Stripe;\n',
        "apps/web/src/query.ts": 'export type Z = import("@azure/identity").T;\n',
        "apps/web/src/generated/a.ts": 'export * from "openai";\n',
        "packages/ui/src/vendor/a.ts": 'export * from "openai";\n',
        "packages/ui/src/build/a.ts": 'export * from "openai";\n',
      }),
    ).toEqual([
      "apps/web/src/generated/a.ts → openai",
      "apps/web/src/query.ts → @azure/identity",
      "apps/web/src/types.ts → stripe",
      "packages/ui/src/build/a.ts → openai",
      "packages/ui/src/vendor/a.ts → openai",
    ]);
  });

  // BLOCKING, fixed (analyze.ts:86 and eslint.config.js:150): `(^|/)dist/` (analyzer) and `**/dist/**` (ESLint) are not
  // anchored to a package's build output, so a `dist/` folder inside src/ escapes both checks and production code
  // can reach an SDK through it.
  it("a dist/ folder inside src/ is not a way around the rule", async () => {
    const files = {
      "apps/web/src/features/dist/wrap.ts": 'export { default } from "stripe";\n',
      "apps/web/src/features/use.ts": 'import s from "./dist/wrap.ts";\nexport const x = s;\n',
    };
    expect(await sdkFrom(files)).toEqual(["apps/web/src/features/dist/wrap.ts → stripe"]);
  });

  it("pnpm check:modules runs the workspace analysis over the repository", async () => {
    const spy = vi.mocked(analyze.analyzeWorkspaceSdks);
    spy.mockClear();
    expect(await checkModules(apiDir, repoRoot)).toEqual([]);
    expect(spy).toHaveBeenCalledWith(repoRoot, expect.objectContaining({ packages: sdks.packages }));
  }, 120_000);
});

describe("security ARC-05 r2: willowsum/no-provider-sdk-load", () => {
  let eslint: ESLint;
  beforeAll(() => {
    eslint = new ESLint({ cwd: repoRoot });
  });
  async function flagged(code: string, file: string): Promise<boolean> {
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
    return (result?.messages ?? []).some((m) => /provider SDK/.test(m.message));
  }

  it("every loading form the rule exists for", async () => {
    for (const [code, file] of [
      ['export type Z = import("stripe").Stripe;\n', "apps/web/src/a.ts"],
      ['import s = require("stripe");\nexport { s };\n', "packages/ui/src/a.ts"],
      ['export const p = require.resolve("stripe");\n', "apps/web/src/a.js"],
      ["export const s = () => import(`stripe`);\n", "apps/web/src/a.ts"],
      ["export const s = () => import(`@aws-sdk/client-s3/dist`);\n", "packages/ui/src/a.ts"],
      ['export const s = () => import("stripe");\n', "packages/api-contract/src/a.ts"],
      ['module.exports = require("stripe");\n', "packages/api-contract/src/a.cjs"],
      ['export const s = () => import("stripe");\n', "tools/synthetic/src/a.ts"],
    ] as const)
      expect(await flagged(code, file), `${file}: ${code}`).toBe(true);
  });

  it("does not flag look-alikes, computed specifiers it cannot know, or adapter folders", async () => {
    for (const [code, file] of [
      ['export const s = () => import("stripe-like-helper");\n', "apps/web/src/a.ts"],
      ['export const s = () => import("stripe");\n', "apps/web/src/adapters/a.ts"],
    ] as const)
      expect(await flagged(code, file), `${file}: ${code}`).toBe(false);
  });
});

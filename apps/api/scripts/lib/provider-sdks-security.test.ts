import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeImports } from "./analyze.ts";
import { readProviderSdks } from "./provider-sdks.ts";

// Security review of ARC-05 (PR #84): the provider SDK guard (dependency analyzer for apps/api, ESLint for
// every package) against every import form and against look-alike adapter folders.

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const RULES = { modules: { x: { layer: "subject" as const, dependsOn: [] } } };

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ws-sdk-sec-"));
  for (const [file, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), code);
  }
  return dir;
}

async function sdkViolations(files: Record<string, string>): Promise<string[]> {
  const found = await analyzeImports(tree(files), RULES, readProviderSdks());
  return found.filter((v) => v.startsWith("provider-sdk-outside-adapter: ")).map((v) => v.split(": ")[1]!);
}

describe("security ARC-05 FR 1: dependency analyzer (apps/api)", () => {
  it("catches every import form outside an adapter", async () => {
    const files = {
      "src/a/dynamic.ts": 'export const s = () => import("stripe");\n',
      "src/a/require.ts":
        'declare const require: (s: string) => unknown;\nexport const s = require("stripe");\n',
      "src/a/import-equals.ts": 'import s = require("twilio");\nexport { s };\n',
      "src/a/reexport.ts": 'export { default } from "openai";\n',
      "src/a/star.ts": 'export * from "plaid";\n',
      "src/a/type-only.ts": 'import type { X } from "@aws-sdk/client-kms";\nexport type Y = X;\n',
      "src/a/type-query.ts": 'export type Z = import("@azure/identity").T;\n',
      "src/a/subpath.ts": 'import x from "@google-cloud/storage/build/src/index.js";\nexport const y = x;\n',
      "src/a/esm.mjs": 'import s from "resend";\nexport const y = s;\n',
      "src/a/cjs.cjs": 'module.exports = require("postmark");\n',
      "scripts/a.js": 'import s from "@sendgrid/mail";\nexport const y = s;\n',
      "test/helpers/a.ts": 'import s from "mailgun.js";\nexport const y = s;\n',
    };
    expect(await sdkViolations(files)).toEqual([
      "scripts/a.js → @sendgrid/mail",
      "src/a/cjs.cjs → postmark",
      "src/a/dynamic.ts → stripe",
      "src/a/esm.mjs → resend",
      "src/a/import-equals.ts → twilio",
      "src/a/reexport.ts → openai",
      "src/a/require.ts → stripe",
      "src/a/star.ts → plaid",
      "src/a/subpath.ts → @google-cloud/storage/build/src/index.js",
      "src/a/type-only.ts → @aws-sdk/client-kms",
      "src/a/type-query.ts → @azure/identity",
      "test/helpers/a.ts → mailgun.js",
    ]);
  });

  it("the adapter allowance covers only src/modules/<module>/adapters/ and src/platform/adapters/", async () => {
    const use = (pkg: string) => `import s from "${pkg}";\nexport const y = s;\n`;
    const found = await sdkViolations({
      "src/modules/x/adapters/ok.ts": use("stripe"),
      "src/platform/adapters/ok.ts": use("stripe"),
      "src/modules/x/adapters-evil/a.ts": use("braintree"),
      "src/modules/x/adaptersx.ts": use("braintree"),
      "src/modules/x/domain/adapters/a.ts": use("minio"),
      "src/modules/x/application/adapters/a.ts": use("minio"),
      "src/platform/adapters-evil/a.ts": use("cloudflare"),
      "src/platform/x/adapters/a.ts": use("cloudflare"),
      "src/adapters/a.ts": use("openai"),
      "src/modules/adapters/a.ts": use("openai"),
      "scripts/src/modules/x/adapters/a.ts": use("twilio"),
      "test/src/platform/adapters/a.ts": use("twilio"),
      "src/legacy/a.ts": use("posthog-node"),
    });
    expect(found).toEqual([
      "scripts/src/modules/x/adapters/a.ts → twilio",
      "src/adapters/a.ts → openai",
      "src/legacy/a.ts → posthog-node",
      "src/modules/adapters/a.ts → openai",
      "src/modules/x/adapters-evil/a.ts → braintree",
      "src/modules/x/adaptersx.ts → braintree",
      "src/modules/x/application/adapters/a.ts → minio",
      "src/modules/x/domain/adapters/a.ts → minio",
      "src/platform/adapters-evil/a.ts → cloudflare",
      "src/platform/x/adapters/a.ts → cloudflare",
      "test/src/platform/adapters/a.ts → twilio",
    ]);
  });

  // BLOCKING, fixed (analyze.ts:30): the fixture exclusions are not anchored, so any `test/fixtures/` or `test/.tmp/`
  // folder inside src/ escapes every rule, and a production file can reach an SDK through it.
  it("a folder named test/fixtures inside src/ is not a way around the rule", async () => {
    const found = await sdkViolations({
      "src/modules/x/test/fixtures/wrap.ts": 'export { default } from "googleapis";\n',
      "src/modules/x/application/test/.tmp/wrap.ts": 'export { default } from "nodemailer";\n',
    });
    expect(found).toEqual([
      "src/modules/x/application/test/.tmp/wrap.ts → nodemailer",
      "src/modules/x/test/fixtures/wrap.ts → googleapis",
    ]);
  });
});

describe("security ARC-05 FR 1: ESLint (apps/web, packages/*, apps/api)", () => {
  let eslint: ESLint;
  beforeAll(() => {
    eslint = new ESLint({ cwd: repoRoot });
  });
  async function flagged(code: string, file: string): Promise<boolean> {
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
    return (result?.messages ?? []).some((m) => /provider SDK/.test(m.message));
  }
  const STATIC = 'import Stripe from "stripe";\nexport const s = Stripe;\n';

  it("static, type-only, re-export and subpath imports of a listed SDK or scope", async () => {
    for (const [code, file] of [
      [STATIC, "apps/web/src/a.ts"],
      ['import type { Stripe } from "stripe";\nexport type S = Stripe;\n', "apps/web/src/a.ts"],
      ['export { default } from "stripe";\n', "packages/ui/src/a.ts"],
      ['export * from "stripe";\n', "packages/i18n/src/a.ts"],
      ['import x from "stripe/lib/x";\nexport const s = x;\n', "apps/web/src/a.ts"],
      [
        'import x from "@aws-sdk/client-s3/dist-es/index.js";\nexport const s = x;\n',
        "packages/domain-kernel/src/a.ts",
      ],
      ['import { init } from "@sentry/react";\nexport const s = init;\n', "apps/web/src/a.tsx"],
    ] as const)
      expect(await flagged(code, file), `${file}: ${code}`).toBe(true);
  });

  it("look-alike adapter folders and packages outside the allowance are checked", async () => {
    for (const file of [
      "apps/api/src/modules/x/adapters-evil/a.ts",
      "apps/api/src/modules/x/domain/adapters/a.ts",
      "apps/api/src/platform/adapters-evil/a.ts",
      "apps/web/src/screens/adapters/a.ts",
      "apps/web/src/adapters-evil/a.ts",
      "apps/web/adapters/a.ts",
      "packages/api-contract/src/a.ts",
      "packages/ui/src/adapters/a.ts",
    ])
      expect(await flagged(STATIC, file), file).toBe(true);
    for (const file of [
      "apps/api/src/modules/x/adapters/a.ts",
      "apps/api/src/platform/adapters/a.ts",
      "apps/web/src/adapters/a.ts",
    ])
      expect(await flagged(STATIC, file), file).toBe(false);
  });

  // BLOCKING, fixed (eslint.config.js:146-150): `no-restricted-imports` does not see `import()` or `require()`, and the
  // block applies only to .ts/.tsx/.js, so apps/web and packages/* can load an SDK dynamically or from .mjs.
  it("dynamic import, require and .mjs/.mts/.cjs files are checked too", async () => {
    for (const [code, file] of [
      ['export const s = () => import("stripe");\n', "apps/web/src/a.ts"],
      ['export const s = () => import("@aws-sdk/client-s3");\n', "packages/ui/src/a.tsx"],
      [
        'import { createRequire } from "node:module";\nexport const s = createRequire(import.meta.url)("stripe");\n',
        "packages/ui/src/a.ts",
      ],
      [STATIC, "apps/web/src/a.mjs"],
      [STATIC, "packages/ui/src/a.mts"],
      ['module.exports = require("stripe");\n', "apps/web/src/a.cjs"],
    ] as const)
      expect(await flagged(code, file), `${file}: ${code}`).toBe(true);
  });
});

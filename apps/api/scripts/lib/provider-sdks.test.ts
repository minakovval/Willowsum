import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { analyzeImports, analyzeWorkspaceSdks, workspaceSourceDirs } from "./analyze.ts";
import { providerSdkPaths, readProviderSdks } from "./provider-sdks.ts";

const fixture = fileURLToPath(new URL("../../test/fixtures/provider-sdks", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const sdks = readProviderSdks();

describe("ARC-05 FR 1 / criterion «Імпорт SDK провайдера поза адаптером — 0»: dependency analyzer", () => {
  it("ARC-05 FR 1: reports every provider SDK imported outside an adapter, and none inside one", async () => {
    const violations = await analyzeImports(
      fixture,
      { modules: { alpha: { layer: "subject", dependsOn: [] } } },
      sdks,
    );
    expect(violations.filter((v) => v.startsWith("provider-sdk-outside-adapter"))).toEqual([
      "provider-sdk-outside-adapter: scripts/send.ts → twilio",
      "provider-sdk-outside-adapter: src/http/upload.ts → @google-cloud/storage/build/src",
      "provider-sdk-outside-adapter: src/modules/alpha/application/charge.ts → @aws-sdk/client-s3",
      "provider-sdk-outside-adapter: src/modules/alpha/application/charge.ts → stripe",
    ]);
  });

  it("ARC-05 FR 1: matches installed packages (hoisted and pnpm layout), scopes and bare specifiers, not look-alikes", () => {
    const match = (name: string, resolved: string) =>
      providerSdkPaths(name).some((re) => new RegExp(re).test(resolved));
    expect(match("stripe", "node_modules/stripe/esm/stripe.js")).toBe(true);
    expect(match("stripe", "../../node_modules/.pnpm/stripe@18.0.0/node_modules/stripe/esm/index.js")).toBe(
      true,
    );
    expect(
      match(
        "@aws-sdk/*",
        "node_modules/.pnpm/@aws-sdk+client-s3@3.700.0/node_modules/@aws-sdk/client-s3/x.js",
      ),
    ).toBe(true);
    expect(match("@aws-sdk/*", "@aws-sdk/client-kms")).toBe(true);
    expect(match("stripe", "stripe-like-helper")).toBe(false);
    expect(match("stripe", "node_modules/.pnpm/stripe-like@1.0.0/node_modules/stripe-like/i.js")).toBe(false);
    expect(match("openai", "src/modules/ai-assistant/adapters/openai.ts")).toBe(false);
    // Each form on its own: hoisted, pnpm store (scope «+» name «@» version), bare specifier.
    const [hoisted, pnpm, bare] = providerSdkPaths("@aws-sdk/*").map((re) => new RegExp(re));
    expect(hoisted!.test("node_modules/@aws-sdk/client-s3/index.js")).toBe(true);
    expect(pnpm!.test("node_modules/.pnpm/@aws-sdk+client-s3@3.700.0/dist/index.js")).toBe(true);
    expect(hoisted!.test("node_modules/.pnpm/@aws-sdk+client-s3@3.700.0/dist/index.js")).toBe(false);
    expect(bare!.test("@aws-sdk/client-s3/dist")).toBe(true);
    expect(bare!.test("node_modules/@aws-sdk/client-s3/index.js")).toBe(false);
  });

  it("the list is well-formed and covers the provider kinds of ARC-05 (payments, cloud, AI, mail, maps, messaging, banking)", () => {
    for (const name of [
      "stripe",
      "@aws-sdk/*",
      "@google-cloud/*",
      "openai",
      "@anthropic-ai/*",
      "nodemailer",
      "@sendgrid/*",
      "plaid",
      "twilio",
      "@mapbox/*",
    ])
      expect(sdks.packages).toContain(name);
    const dir = mkdtempSync(path.join(tmpdir(), "ws-sdks-"));
    const bad = path.join(dir, "sdks.json");
    writeFileSync(bad, JSON.stringify({ packages: ["Not A Package"] }));
    expect(() => readProviderSdks(bad)).toThrow(/not a package name/);
  });
});

describe("ARC-05 FR 1: the same analyzer rule over the web app, shared packages and tools/synthetic", () => {
  it("ARC-05 FR 1: catches static, dynamic, require and re-export loads in every file kind; allows apps/web/src/adapters", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ws-sdk-ws-"));
    const files: Record<string, string> = {
      "apps/web/src/map.ts": 'export const load = () => import("mapbox-gl");\n',
      "apps/web/src/screens/Pay.tsx":
        'import Stripe from "stripe";\nexport const P = () => <i>{String(Stripe)}</i>;\n',
      "apps/web/src/adapters/maps.ts": 'import mapboxgl from "mapbox-gl";\nexport const m = mapboxgl;\n',
      "apps/web/e2e/probe.ts": 'export * from "openai";\n',
      "packages/ui/src/a.mjs": 'import s from "@sentry/browser";\nexport const x = s;\n',
      "packages/i18n/src/b.cjs": 'module.exports = require("twilio");\n',
      "tools/synthetic/src/c.mts": 'export { default } from "@aws-sdk/client-s3";\n',
      "packages/ui/src/fine.ts": 'import x from "stripe-like-helper";\nexport const y = x;\n',
    };
    for (const [file, code] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), code);
    }
    expect(workspaceSourceDirs(root)).toEqual([
      "apps/web/src",
      "apps/web/e2e",
      "packages/i18n/src",
      "packages/ui/src",
      "tools/synthetic/src",
    ]);
    expect(await analyzeWorkspaceSdks(root, sdks)).toEqual([
      "provider-sdk-outside-adapter: apps/web/e2e/probe.ts → openai",
      "provider-sdk-outside-adapter: apps/web/src/map.ts → mapbox-gl",
      "provider-sdk-outside-adapter: apps/web/src/screens/Pay.tsx → stripe",
      "provider-sdk-outside-adapter: packages/i18n/src/b.cjs → twilio",
      "provider-sdk-outside-adapter: packages/ui/src/a.mjs → @sentry/browser",
      "provider-sdk-outside-adapter: tools/synthetic/src/c.mts → @aws-sdk/client-s3",
    ]);
  });

  it("a folder whose name only starts with node_modules is analysed, in apps/api and in the workspace", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ws-sdk-nm-"));
    const files: Record<string, string> = {
      "src/node_modules_x/a.ts": 'export { default } from "stripe";\n',
      "apps/web/src/node_modules_x/b.ts": 'export { default } from "twilio";\n',
    };
    for (const [file, code] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), code);
    }
    const api = await analyzeImports(root, { modules: {} }, sdks);
    expect(api.filter((v) => v.startsWith("provider-sdk-outside-adapter"))).toEqual([
      "provider-sdk-outside-adapter: src/node_modules_x/a.ts → stripe",
    ]);
    expect(await analyzeWorkspaceSdks(root, sdks, ["apps/web/src"])).toEqual([
      "provider-sdk-outside-adapter: apps/web/src/node_modules_x/b.ts → twilio",
    ]);
  });

  it("finds none in the repository, which it does scan (web, packages, tools/synthetic)", async () => {
    const dirs = workspaceSourceDirs(repoRoot);
    expect(dirs).toEqual(
      expect.arrayContaining([
        "apps/web/src",
        "packages/ui/src",
        "packages/domain-kernel/src",
        "tools/synthetic/src",
      ]),
    );
    expect(dirs.some((d) => d.startsWith("apps/api"))).toBe(false);
    expect(await analyzeWorkspaceSdks(repoRoot, sdks)).toEqual([]);
  });
});

describe("ARC-05 FR 1: the same list in ESLint for every other package (web, packages)", () => {
  const eslint = new ESLint({ cwd: repoRoot });
  async function restricted(code: string, file: string, dynamic = false): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
    const rule = dynamic ? "willowsum/no-provider-sdk-load" : "no-restricted-imports";
    return (result?.messages ?? []).filter((m) => m.ruleId === rule).length;
  }

  it("ARC-05 FR 1: refuses a provider SDK in the web app or a shared package, allows it in an adapter folder", async () => {
    const code =
      'import mapboxgl from "mapbox-gl";\nimport { x } from "@sentry/react";\nexport const m = [mapboxgl, x];\n';
    expect(await restricted(code, "apps/web/src/screens/Map.tsx")).toBe(2);
    expect(await restricted(code, "packages/ui/src/probe.ts")).toBe(2);
    expect(await restricted(code, "apps/api/src/http/probe.ts")).toBe(2);
    expect(await restricted(code, "apps/web/src/adapters/maps.ts")).toBe(0);
    expect(await restricted(code, "apps/api/src/modules/locations/adapters/maps.ts")).toBe(0);
    expect(await restricted(code, "apps/api/src/platform/adapters/telemetry.ts")).toBe(0);
    expect(
      await restricted('import x from "stripe-like-helper";\nexport const y = x;\n', "apps/web/src/a.ts"),
    ).toBe(0);
  });

  it("ARC-05 FR 1: dynamic loading and every file kind are checked, tools/synthetic included", async () => {
    const lazy = 'export const load = () => import("mapbox-gl");\n';
    expect(await restricted(lazy, "apps/web/src/screens/Map.tsx", true)).toBe(1);
    expect(await restricted(lazy, "tools/synthetic/src/probe.ts", true)).toBe(1);
    expect(await restricted('module.exports = require("twilio");\n', "packages/ui/src/a.cjs", true)).toBe(1);
    expect(
      await restricted('import s from "stripe";\nexport const x = s;\n', "packages/i18n/src/a.mjs"),
    ).toBe(1);
    expect(await restricted(lazy, "apps/web/src/adapters/maps.ts", true)).toBe(0);
  });

  it("the OpenAPI client rule still applies everywhere outside packages/api-contract, adapters included", async () => {
    const code = 'import createClient from "openapi-fetch";\nexport const c = createClient;\n';
    expect(await restricted(code, "apps/web/src/adapters/api.ts")).toBe(1);
    expect(await restricted(code, "apps/web/src/a.ts")).toBe(1);
  });
});

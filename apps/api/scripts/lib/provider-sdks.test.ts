import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { analyzeImports } from "./analyze.ts";
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

describe("ARC-05 FR 1: the same list in ESLint for every other package (web, packages)", () => {
  const eslint = new ESLint({ cwd: repoRoot });
  async function restricted(code: string, file: string): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
    return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports").length;
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

  it("the OpenAPI client rule still applies everywhere outside packages/api-contract, adapters included", async () => {
    const code = 'import createClient from "openapi-fetch";\nexport const c = createClient;\n';
    expect(await restricted(code, "apps/web/src/adapters/api.ts")).toBe(1);
    expect(await restricted(code, "apps/web/src/a.ts")).toBe(1);
  });
});

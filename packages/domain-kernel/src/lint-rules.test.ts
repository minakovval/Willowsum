import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({ cwd: root });

async function messages(code: string, file = "packages/domain-kernel/src/probe.ts"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

describe("NFR-06 static analysis: no floats for amounts, no plan names in code", () => {
  it("rejects parseFloat, Decimal and Money from JS numbers, and number-typed amounts", async () => {
    const found = await messages(`
      import { Decimal, Money } from "./index.ts";
      export const a = parseFloat("1.5");
      export const b = Number.parseFloat("1.5");
      export const c = new Decimal(0.1);
      export const d = Money.of(12.5, "EUR");
      export interface Row { amount: number; totalBalance: number; label: string }
      export function f(price: number, count: number): number { return price + count; }
      export class Holder { rate: number = 1; }
    `);
    expect(found.filter((m) => m.includes("parseFloat"))).toHaveLength(2);
    expect(found.filter((m) => m.includes("Decimal from a decimal string"))).toHaveLength(1);
    expect(found.filter((m) => m.includes("Money.of takes a decimal string"))).toHaveLength(1);
    expect(found.filter((m) => m.includes("is a Decimal or Money, not number"))).toHaveLength(4);
  });

  it("accepts decimal strings and number-typed counts", async () => {
    expect(
      await messages(`
        import { Decimal, Money } from "./index.ts";
        export const a = new Decimal("0.1");
        export const b = Money.of("12.50", "EUR");
        export function f(count: number, width: number): number { return count + width; }
      `),
    ).toEqual([]);
  });

  it("rejects plan names in backend and web code, but not icon names", async () => {
    const backend = await messages(
      `export const isPaid = (plan: string) => plan === "family" || plan === "Plus";`,
      "apps/api/src/probe.ts",
    );
    expect(backend).toHaveLength(2);
    expect(backend[0]).toMatch(/No plan names in code/);
    expect(await messages(`export const p = "Trial";`, "apps/web/src/probe.ts")).toHaveLength(1);
    expect(await messages(`export type Name = "plus" | "minus";`, "apps/web/src/probe.ts")).toEqual([]);
  });
});

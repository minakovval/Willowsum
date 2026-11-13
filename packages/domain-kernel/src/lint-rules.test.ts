import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it, vi } from "vitest";
import { STATIC_ANALYSIS_TIMEOUT_MS } from "../../../tools/test-guards/budgets.mjs";

// Static analysis of real source trees: budget and its basis in tools/test-guards/budgets.mjs.
vi.setConfig({ testTimeout: STATIC_ANALYSIS_TIMEOUT_MS });

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

  it("also catches unions, arrays, toNumber(), Number(amount), negative literals and Decimal() without new", async () => {
    const found = await messages(`
      import { Decimal, Money } from "./index.ts";
      export interface Dto { balance: number | null; amount?: number | undefined; prices: number[]; totalAmount: Array<number> }
      export const m = Money.of("1", "EUR");
      export const a = m.amount.toNumber();
      export const b = Number(m.amount);
      export const c = Number(amount);
      export const d = new Decimal(-0.1);
      export const e = Decimal(0.1);
      export const f = Money.of(-5, "EUR");
      declare const amount: string;
    `);
    expect(found.filter((x) => x.includes("is a Decimal or Money, not number"))).toHaveLength(4);
    expect(found.filter((x) => x.includes("toNumber()"))).toHaveLength(1);
    expect(found.filter((x) => x.includes("Number(amount)"))).toHaveLength(2);
    expect(found.filter((x) => x.includes("Decimal from a decimal string"))).toHaveLength(2);
    expect(found.filter((x) => x.includes("Money.of takes a decimal string"))).toHaveLength(1);
  });

  it("does not flag names that only end in the same letters (checksum, separate) or generic values", async () => {
    expect(
      await messages(`
        export interface Meta { checksum: number; separate: number; value: string | number; count: number }
        export const n = Number("42");
      `),
    ).toEqual([]);
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

  it("rejects plan names in code (strings, literal types, JSX props, templates), but not icon names", async () => {
    const backend = await messages(
      `export const isPaid = (plan: string) => plan === "family" || plan === "Plus";`,
      "apps/api/src/probe.ts",
    );
    expect(backend).toHaveLength(2);
    expect(backend[0]).toMatch(/No plan names in code/);
    expect(await messages(`export const p = "Trial";`, "apps/web/src/probe.ts")).toHaveLength(1);
    expect(await messages('export const icon = <Icon name="plus" />;', "apps/web/src/probe.tsx")).toEqual([]);
    expect(await messages(`export type Plan = "free" | "family";`, "apps/web/src/probe.ts")).toHaveLength(2);
    expect(
      await messages('export const b = <Badge plan="family" />;', "apps/web/src/probe.tsx"),
    ).toHaveLength(1);
    expect(await messages("export const t = `trial`;", "apps/api/src/probe.ts")).toHaveLength(1);
  });
});

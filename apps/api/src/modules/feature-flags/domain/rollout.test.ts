import { describe, expect, it } from "vitest";
import { syntheticHouseholds } from "@willowsum/synthetic";
import { bucketOf, isOnFor, rollout, type Rollout } from "./index.ts";

const households = syntheticHouseholds("cicd-06-buckets", 4_000).map((h) => h.id);
const never = async () => {
  throw new Error("test-space lookup not needed at this stage");
};
const yes = async () => true;
const no = async () => false;

async function share(flag: string, state: Rollout, isTest = no): Promise<string[]> {
  const on: string[] = [];
  for (const h of households) if (await isOnFor(flag, state, h, isTest)) on.push(h);
  return on;
}

describe("CICD-06 FR 1: staged rollout — test spaces → a share of spaces → all", () => {
  it("CICD-06 AC1: a new function ships off — «off» is off for every space, test spaces included", async () => {
    expect(await share("x.new", { stage: "off" }, yes)).toEqual([]);
  });

  it("CICD-06 AC1: stage «test» turns it on only for test spaces", async () => {
    const [a, b] = households as [string, string];
    expect(await isOnFor("x.new", { stage: "test" }, a, yes)).toBe(true);
    expect(await isOnFor("x.new", { stage: "test" }, b, no)).toBe(false);
  });

  it("CICD-06 AC1: stage «share» turns it on for about that share of spaces, plus every test space", async () => {
    const on = await share("x.new", { stage: "share", percent: 30 });
    expect(on.length / households.length).toBeGreaterThan(0.27);
    expect(on.length / households.length).toBeLessThan(0.33);
    const off = households.find((h) => !on.includes(h))!;
    expect(await isOnFor("x.new", { stage: "share", percent: 30 }, off, yes)).toBe(true);
  });

  it("CICD-06 AC1: stage «all» is on for every space without asking about test spaces", async () => {
    expect((await share("x.new", { stage: "all" }, never)).length).toBe(households.length);
  });

  it("the bucket is deterministic per space, differs per flag, and a larger share only adds spaces", async () => {
    const h = households[0]!;
    expect(bucketOf("x.new", h)).toBe(bucketOf("x.new", h));
    expect(bucketOf("x.new", h.toUpperCase())).toBe(bucketOf("x.new", h));
    const ten = await share("x.new", { stage: "share", percent: 10 });
    const fifty = await share("x.new", { stage: "share", percent: 50 });
    expect(ten.every((x) => fifty.includes(x))).toBe(true);
    const otherFlag = await share("y.other", { stage: "share", percent: 10 });
    expect(otherFlag).not.toEqual(ten);
    for (const x of households) expect(bucketOf("x.new", x)).toBeGreaterThanOrEqual(0);
    for (const x of households) expect(bucketOf("x.new", x)).toBeLessThan(100);
  });

  it("a share is 1–99 %; «off» and «all» take no percent", () => {
    expect(rollout.safeParse({ stage: "share", percent: 0 }).success).toBe(false);
    expect(rollout.safeParse({ stage: "share", percent: 100 }).success).toBe(false);
    expect(rollout.safeParse({ stage: "share", percent: 12.5 }).success).toBe(false);
    expect(rollout.safeParse({ stage: "all", percent: 100 }).success).toBe(false);
    expect(rollout.safeParse({ stage: "share", percent: 5 }).success).toBe(true);
  });
});

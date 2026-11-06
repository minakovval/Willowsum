import { z } from "zod";
import { describe, expect, it } from "vitest";
import { defineModule } from "../modules/define.ts";
import { buildCatalogue, catalogueProblems, nextSnapshot } from "./catalogue.ts";
import { compatibilityProblems } from "./compat.ts";
import { defineEvent, type EventDefinition } from "./define.ts";

const v1 = defineEvent({
  name: "ledger.posting-set-recorded",
  version: 1,
  schema: z.object({ postingSetId: z.string(), householdId: z.string() }),
});
const ledger = (events: EventDefinition[] = [v1]) =>
  defineModule({ name: "ledger", publishes: events, consumes: [] });

describe("ARC-01 event catalogue: versioned schemas, compatible changes only", () => {
  it("validates event names and versions", () => {
    expect(() => defineEvent({ name: "PostingRecorded", version: 1, schema: z.object({}) })).toThrow(
      /<module>.<event>/,
    );
    expect(() => defineEvent({ name: "ledger.recorded", version: 0, schema: z.object({}) })).toThrow(
      /positive integer/,
    );
    expect(() => defineModule({ name: "budget", publishes: [v1], consumes: [] })).toThrow(/«budget.…»/);
  });

  it("snapshot records each version; an unchanged catalogue has no problems", () => {
    const snapshot = nextSnapshot([ledger()], { events: {} });
    expect(Object.keys(snapshot.events)).toEqual(["ledger.posting-set-recorded@v1"]);
    expect(catalogueProblems([ledger()], snapshot)).toEqual([]);
    expect(catalogueProblems([ledger()], { events: {} })).toEqual([
      "ledger.posting-set-recorded@v1: not in events.snapshot.json — run pnpm events:snapshot",
    ]);
  });

  it("allows a new optional property, rejects a removed, retyped or newly required one", () => {
    const snapshot = nextSnapshot([ledger()], { events: {} });
    const withOptional = defineEvent({ ...v1, schema: v1.schema.extend({ note: z.string().optional() }) });
    expect(catalogueProblems([ledger([withOptional])], snapshot)).toEqual([]);

    const removed = defineEvent({ ...v1, schema: z.object({ postingSetId: z.string() }) });
    const retyped = defineEvent({
      ...v1,
      schema: z.object({ postingSetId: z.number(), householdId: z.string() }),
    });
    const required = defineEvent({ ...v1, schema: v1.schema.extend({ note: z.string() }) });
    expect(catalogueProblems([ledger([removed])], snapshot).join()).toMatch(/householdId: property removed/);
    expect(catalogueProblems([ledger([retyped])], snapshot).join()).toMatch(/postingSetId: schema changed/);
    expect(catalogueProblems([ledger([required])], snapshot).join()).toMatch(
      /note: new property is required/,
    );
    expect(() => nextSnapshot([ledger([required])], snapshot)).toThrow(/publish a new version instead/);
  });

  it("an incompatible change goes into a new version; the old one stays", () => {
    const snapshot = nextSnapshot([ledger()], { events: {} });
    const v2 = defineEvent({ ...v1, version: 2, schema: z.object({ postingSetId: z.string() }) });
    expect(Object.keys(nextSnapshot([ledger([v1, v2])], snapshot).events)).toEqual([
      "ledger.posting-set-recorded@v1",
      "ledger.posting-set-recorded@v2",
    ]);
    expect(catalogueProblems([ledger([v2])], snapshot)).toEqual([
      "ledger.posting-set-recorded@v1: published version removed (keep it until no consumer uses it)",
      "ledger.posting-set-recorded@v2: not in events.snapshot.json — run pnpm events:snapshot",
    ]);
    expect(() => buildCatalogue([ledger([v1, v1])])).toThrow(/published twice/);
  });

  it("consumer contract: every consumed event exists in the expected version", () => {
    const budget = defineModule({ name: "budget", publishes: [], consumes: [{ name: v1.name, version: 2 }] });
    const snapshot = nextSnapshot([ledger()], { events: {} });
    expect(catalogueProblems([ledger(), budget], snapshot)).toEqual([
      "budget consumes ledger.posting-set-recorded@v2, which is not published",
    ]);
  });

  it("additionalProperties may not become stricter; non-object schemas must stay identical", () => {
    expect(
      compatibilityProblems(
        { type: "object", properties: {} },
        { type: "object", properties: {}, additionalProperties: false },
      ),
    ).toEqual(["$: additional properties are no longer allowed"]);
    expect(compatibilityProblems({ type: "string" }, { type: "string", format: "uuid" })).toEqual([
      "$: schema changed",
    ]);
    expect(
      compatibilityProblems({ type: "string", format: "uuid" }, { format: "uuid", type: "string" }),
    ).toEqual([]);
  });
});

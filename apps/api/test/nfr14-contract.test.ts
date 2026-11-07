import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NFR-14 FR 6, NFR-15 FR 5, 13, 17: the contract describes the new problems — 429 RATE_LIMITED with
 * Retry-After on every operation, 403 ORIGIN_NOT_ALLOWED on writes, VERSION_CONFLICT and LIMIT_REACHED with
 * their extension members.
 */
const contract = JSON.parse(
  readFileSync(new URL("../../../packages/api-contract/openapi.json", import.meta.url), "utf8"),
) as {
  paths: Record<string, Record<string, { responses: Record<string, { headers?: Record<string, unknown> }> }>>;
  components: { schemas: { Problem: { properties: Record<string, { enum?: string[] }> } } };
};

describe("NFR-14 / NFR-15: the problems in the API contract", () => {
  it("every operation documents 429 with Retry-After; every write documents 403", () => {
    const operations = Object.values(contract.paths).flatMap((p) => Object.entries(p));
    expect(operations.length).toBeGreaterThan(0);
    for (const [method, op] of operations) {
      expect(op.responses["429"]?.headers?.["Retry-After"]).toBeDefined();
      if (method !== "get") expect(op.responses["403"]).toBeDefined();
    }
  });

  it("the codes and their extension members are in the Problem schema", () => {
    const { properties } = contract.components.schemas.Problem;
    expect(properties["code"]!.enum).toEqual(
      expect.arrayContaining(["RATE_LIMITED", "ORIGIN_NOT_ALLOWED", "VERSION_CONFLICT", "LIMIT_REACHED"]),
    );
    for (const member of ["currentVersion", "changedFields", "limit"])
      expect(properties[member]).toBeDefined();
  });
});

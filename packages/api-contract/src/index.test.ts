import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { generateTypes } from "../scripts/generate.ts";
import {
  createApiClient,
  isProblem,
  newIdempotencyKey,
  problemSupportCode,
  type Problem,
  type ProblemCode,
} from "./index.ts";

describe("ARC-07 FR 2: the typed client is generated from the committed contract", () => {
  it("src/schema.ts is exactly what openapi.json generates (CI: pnpm --filter @willowsum/api-contract check)", async () => {
    const contract = readFileSync(new URL("../openapi.json", import.meta.url), "utf8");
    expect(readFileSync(new URL("./schema.ts", import.meta.url), "utf8")).toBe(await generateTypes(contract));
  });

  it("calls only documented operations and types their answers", async () => {
    const calls: string[] = [];
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async (request: Request) => {
        calls.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response(JSON.stringify({ apiVersion: "v1" }), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const { data } = await client.GET("/v1/meta");
    expectTypeOf(data).toEqualTypeOf<{ apiVersion: "v1" } | undefined>();
    expect(data).toEqual({ apiVersion: "v1" });
    expect(calls).toEqual(["GET /v1/meta"]);
    // @ts-expect-error — a path outside the contract does not type-check (NFR-05 FR 1: no hidden endpoints).
    void client.GET("/v1/undocumented");
  });

  it("FR 4: recognises problem details and their machine code", () => {
    const problem: Problem = {
      type: "urn:willowsum:problem:forbidden",
      title: "No",
      status: 403,
      code: "FORBIDDEN",
    };
    expect(isProblem(problem)).toBe(true);
    expect(isProblem({ status: 403 })).toBe(false);
    expectTypeOf<ProblemCode>().toExtend<string>();
  });

  it("FR 4: makes a fresh idempotency key for each create", () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe("ARC-09 FR 3: the support code of a problem is the error code clients show", () => {
  it("returns the server's trace id from a problem; nothing for other answers or malformed ids", () => {
    const problem = {
      type: "urn:willowsum:problem:internal",
      title: "Something went wrong on our side",
      status: 500,
      code: "INTERNAL",
      supportId: "4bf92f3577b34da6a3ce929d0e0e4736",
    };
    expect(problemSupportCode(problem)).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(problemSupportCode({ ...problem, supportId: "<script>" })).toBeUndefined();
    expect(problemSupportCode({ ...problem, supportId: undefined })).toBeUndefined();
    expect(problemSupportCode({ apiVersion: "v1" })).toBeUndefined();
  });
});

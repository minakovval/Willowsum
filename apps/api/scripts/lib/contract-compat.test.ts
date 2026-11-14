import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractProblems } from "./contract-compat.ts";

type Json = Record<string, unknown>;
const today = "2026-11-06";

function doc(operations: Record<string, Record<string, Json>>): Json {
  return { openapi: "3.1.1", paths: operations, components: { schemas: { Problem: { type: "object" } } } };
}

function op(parts: {
  parameters?: Json[];
  body?: Json;
  bodyRequired?: boolean;
  response?: Json;
  extra?: Json;
}): Json {
  return {
    ...(parts.parameters ? { parameters: parts.parameters } : {}),
    ...(parts.body
      ? {
          requestBody: {
            required: parts.bodyRequired ?? true,
            content: { "application/json": { schema: parts.body } },
          },
        }
      : {}),
    responses: {
      "200": {
        description: "ok",
        content: { "application/json": { schema: parts.response ?? { type: "object" } } },
      },
    },
    ...parts.extra,
  };
}

const obj = (properties: Record<string, Json>, required: string[] = []): Json => ({
  type: "object",
  properties,
  required,
});
const check = (base: Json, head: Json, on = today) => contractProblems(base, head, { today: on });

describe("ARC-07 FR 3 / criterion «несумісна зміна контракту в межах версії — 0»", () => {
  const base = doc({
    "/v1/things": {
      get: op({
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer", maximum: 100 } },
        ],
        response: obj({ id: { type: "string" }, kind: { type: "string", enum: ["a", "b"] } }, ["id", "kind"]),
      }),
      post: op({
        body: obj({ name: { type: "string", maxLength: 40 }, note: { type: "string" } }, ["name"]),
      }),
    },
  });

  it("the same contract, a new route, a new optional request field and a new response field are compatible", () => {
    const head = structuredClone(base) as { paths: Record<string, Record<string, Json>> };
    head.paths["/v1/other"] = { get: op({}) };
    const post = head.paths["/v1/things"]!["post"] as {
      requestBody: { content: Record<string, { schema: Json }> };
    };
    (post.requestBody.content["application/json"]!.schema["properties"] as Json)["extra"] = {
      type: "string",
    };
    const get = head.paths["/v1/things"]!["get"] as {
      responses: Record<string, { content: Record<string, { schema: Json }> }>;
    };
    (get.responses["200"]!.content["application/json"]!.schema["properties"] as Json)["added"] = {
      type: "string",
    };
    expect(check(base, head)).toEqual([]);
  });

  it("a removed path or operation fails", () => {
    expect(check(base, doc({}))).toEqual([
      expect.stringMatching(/^GET \/v1\/things: operation removed without a deprecation mark/),
      expect.stringMatching(/^POST \/v1\/things: operation removed/),
    ]);
  });

  it("a removed response field fails; a removed request field fails", () => {
    const head = doc({
      "/v1/things": {
        get: op({
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer", maximum: 100 } },
          ],
          response: obj({ id: { type: "string" } }, ["id"]),
        }),
        post: op({ body: obj({ name: { type: "string", maxLength: 40 } }, ["name"]) }),
      },
    });
    expect(check(base, head)).toEqual([
      expect.stringMatching(/response 200 application\/json\.kind: field removed/),
      expect.stringMatching(/body application\/json\.note: field removed/),
    ]);
  });

  it("a new required request field, an optional field made required and a new required parameter fail", () => {
    const head = doc({
      "/v1/things": {
        get: op({
          parameters: [
            { name: "limit", in: "query", required: true, schema: { type: "integer", maximum: 100 } },
            { name: "sort", in: "query", required: true, schema: { type: "string" } },
          ],
          response: obj({ id: { type: "string" }, kind: { type: "string", enum: ["a", "b"] } }, [
            "id",
            "kind",
          ]),
        }),
        post: op({
          body: obj(
            { name: { type: "string", maxLength: 40 }, note: { type: "string" }, owner: { type: "string" } },
            ["name", "note", "owner"],
          ),
        }),
      },
    });
    expect(check(base, head)).toEqual([
      expect.stringMatching(/parameter query:limit: optional parameter made required/),
      expect.stringMatching(/parameter query:sort: new required parameter/),
      expect.stringMatching(/\.note: optional request field made required/),
      expect.stringMatching(/\.owner: new required request field/),
    ]);
  });

  it("a narrowed request type fails: tighter length or range, type removed, enum or pattern added", () => {
    const head = doc({
      "/v1/things": {
        get: op({
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer", maximum: 50 } },
          ],
          response: obj({ id: { type: "string" }, kind: { type: "string", enum: ["a", "b"] } }, [
            "id",
            "kind",
          ]),
        }),
        post: op({
          body: obj(
            { name: { type: "string", maxLength: 20, pattern: "^[a-z]+$" }, note: { type: "integer" } },
            ["name"],
          ),
        }),
      },
    });
    expect(check(base, head)).toEqual([
      expect.stringMatching(/query:limit: maximum tightened from 100 to 50/),
      expect.stringMatching(/\.name: maxLength tightened from 40 to 20/),
      expect.stringMatching(/\.name: pattern added/),
      expect.stringMatching(/\.note: type string no longer accepted/),
    ]);
  });

  it("a widened response fails: may be null, a field no longer always present, a new enum value", () => {
    const head = doc({
      "/v1/things": {
        get: op({
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer", maximum: 100 } },
          ],
          response: obj(
            {
              id: { anyOf: [{ type: "string" }, { type: "null" }] },
              kind: { type: "string", enum: ["a", "b", "c"] },
            },
            ["kind"],
          ),
        }),
        post: (base["paths"] as Record<string, Record<string, Json>>)["/v1/things"]!["post"]!,
      },
    });
    const problems = check(base, head);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\.id: response field no longer always present/),
        expect.stringMatching(/\.id: may now return null/),
        expect.stringMatching(/\.kind: may now return value "c"/),
      ]),
    );
  });

  it("an enum marked x-extensible-enum may gain values in responses", () => {
    const ext = (values: string[]): Json =>
      doc({
        "/v1/x": {
          get: op({
            response: obj({ code: { type: "string", enum: values, "x-extensible-enum": true } }, ["code"]),
          }),
        },
      });
    expect(check(ext(["A"]), ext(["A", "B"]))).toEqual([]);
  });

  describe("removal after the deprecation mark and 6 months", () => {
    const deprecated = (since: string): Json =>
      doc({
        "/v1/old": { get: op({ extra: { deprecated: true, "x-deprecated-since": since } }) },
        "/v1/new": { get: op({}) },
      });
    const without = doc({ "/v1/new": { get: op({}) } });

    it("allowed 6 months after the mark", () => {
      expect(check(deprecated("2026-05-06"), without)).toEqual([]);
    });

    it("refused before 6 months have passed", () => {
      expect(check(deprecated("2026-05-07"), without)).toEqual([
        "GET /v1/old: operation removed before 6 months after its deprecation (2026-05-07)",
      ]);
    });

    it("a field may also be removed 6 months after its mark", () => {
      const withField = (since: string) =>
        doc({
          "/v1/x": {
            get: op({
              response: obj(
                {
                  id: { type: "string" },
                  old: { type: "string", deprecated: true, "x-deprecated-since": since },
                },
                ["id"],
              ),
            }),
          },
        });
      const noField = doc({ "/v1/x": { get: op({ response: obj({ id: { type: "string" } }, ["id"]) }) } });
      expect(check(withField("2026-01-01"), noField)).toEqual([]);
      expect(check(withField("2026-10-01"), noField)).toEqual([
        expect.stringMatching(/\.old: field removed before 6 months/),
      ]);
    });

    it("a new deprecation mark carries the date it is added and keeps it", () => {
      const plain = doc({ "/v1/old": { get: op({}) } });
      const marked = (since: string) =>
        doc({ "/v1/old": { get: op({ extra: { deprecated: true, "x-deprecated-since": since } }) } });
      expect(check(plain, marked("2026-11-05"))).toEqual([]);
      expect(check(plain, marked("2025-01-01"))).toEqual([
        expect.stringMatching(/new deprecation mark must carry the date it is added/),
      ]);
      expect(check(marked("2026-11-05"), marked("2026-01-01"))).toEqual([
        expect.stringMatching(/x-deprecated-since changed/),
      ]);
      expect(check(plain, doc({ "/v1/old": { get: op({ extra: { deprecated: true } }) } }))).toEqual([
        expect.stringMatching(/deprecated without x-deprecated-since/),
      ]);
    });
  });

  it("follows local $ref into components", () => {
    const withRef = (schema: Json): Json => ({
      openapi: "3.1.1",
      paths: { "/v1/x": { get: op({ response: { $ref: "#/components/schemas/Thing" } }) } },
      components: { schemas: { Thing: schema } },
    });
    expect(check(withRef(obj({ id: { type: "string" } }, ["id"])), withRef(obj({}, [])))).toEqual([
      expect.stringMatching(/\.id: field removed/),
    ]);
  });

  describe("oneOf / anyOf variants are matched by structure, not only by type (#229)", () => {
    const transfer = {
      type: "object",
      properties: {
        kind: { type: "string", const: "transfer" },
        toAccountId: { type: "string", format: "uuid" },
      },
      required: ["kind", "toAccountId"],
      additionalProperties: false,
    };
    const adjustment = {
      type: "object",
      properties: { kind: { type: "string", const: "adjustment" } },
      required: ["kind"],
      additionalProperties: false,
    };
    const withVariants = (
      keyword: "oneOf" | "anyOf",
      request: Json[],
      response: Json[] = [
        { $ref: "#/components/schemas/Transfer" },
        { $ref: "#/components/schemas/Adjustment" },
      ],
    ): Json => ({
      openapi: "3.1.1",
      paths: {
        "/v1/accounts/{accountId}/close": {
          post: op({
            body: obj({ closedOn: { type: "string" }, settlement: { [keyword]: request } }, ["closedOn"]),
            response: obj({ settlement: { [keyword]: response } }, ["settlement"]),
          }),
        },
      },
      components: { schemas: { Transfer: transfer, Adjustment: adjustment } },
    });
    const refs = [{ $ref: "#/components/schemas/Transfer" }, { $ref: "#/components/schemas/Adjustment" }];

    for (const keyword of ["oneOf", "anyOf"] as const) {
      it(`${keyword} with inline and $ref branches of one type is compatible with itself`, () => {
        expect(
          check(withVariants(keyword, [transfer, adjustment]), withVariants(keyword, [transfer, adjustment])),
        ).toEqual([]);
        expect(check(withVariants(keyword, refs), withVariants(keyword, refs))).toEqual([]);
        expect(check(withVariants(keyword, refs), withVariants(keyword, [adjustment, transfer]))).toEqual([]);
      });

      it(`${keyword}: a new required property in a request branch fails`, () => {
        const stricter = {
          ...adjustment,
          properties: { ...adjustment.properties, reason: { type: "string" } },
          required: ["kind", "reason"],
        };
        expect(
          check(withVariants(keyword, [transfer, adjustment]), withVariants(keyword, [transfer, stricter])),
        ).toEqual([expect.stringMatching(/settlement\.reason: new required request field/)]);
      });

      it(`${keyword}: a removed request branch fails`, () => {
        expect(
          check(withVariants(keyword, [transfer, adjustment]), withVariants(keyword, [transfer])),
        ).not.toEqual([]);
        expect(check(withVariants(keyword, refs), withVariants(keyword, [refs[1] as Json]))).not.toEqual([]);
      });

      it(`${keyword}: a new response branch fails; a new optional request branch field passes`, () => {
        const other = {
          type: "object",
          properties: { kind: { type: "string", const: "writeOff" } },
          required: ["kind"],
        };
        expect(check(withVariants(keyword, refs), withVariants(keyword, refs, [...refs, other]))).toEqual([
          expect.stringMatching(/response 200 .*settlement.*may now return value "writeOff"/),
        ]);
        const looser = { ...transfer, properties: { ...transfer.properties, note: { type: "string" } } };
        expect(
          check(withVariants(keyword, [transfer, adjustment]), withVariants(keyword, [looser, adjustment])),
        ).toEqual([]);
      });
    }

    it("the committed packages/api-contract contract is compatible with itself", () => {
      const contract = JSON.parse(
        readFileSync(new URL("../../../../packages/api-contract/openapi.json", import.meta.url), "utf8"),
      ) as Json;
      expect(check(contract, structuredClone(contract))).toEqual([]);
    });
  });
});

import { z } from "zod";
import { API_VERSION } from "./openapi.ts";
import { defineRoute } from "./route.ts";

/** `GET /v1/meta`: the API version a client talks to. Public: it serves no household data. */
export const metaRoute = defineRoute({
  module: null,
  method: "GET",
  path: "/v1/meta",
  operationId: "getMeta",
  summary: "API version",
  access: { public: "Clients read the API version before sign-in; no household data" },
  response: {
    status: 200,
    description: "The API version",
    schema: z.object({ apiVersion: z.literal(API_VERSION) }),
  },
  handler: async () => ({ apiVersion: API_VERSION }),
});

export const platformRoutes = [metaRoute];

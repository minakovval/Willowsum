import { z } from "zod";
import { defineRoute } from "../../../../platform/http/route.ts";
import { flagsOn } from "../../application/index.ts";
import { FLAG_KEYS } from "../../domain/index.ts";
import { readIsTestHousehold, readSnapshot } from "../db/store.ts";

/**
 * `GET /v1/me/features`: the functions that are on for the caller's space. Clients show only these; a
 * function that is off is not listed at all, so a client never shows it as a teaser of what is to come (DAT-05 FR 7).
 */
export const myFeaturesRoute = defineRoute({
  module: "feature-flags",
  method: "GET",
  path: "/v1/me/features",
  operationId: "getMyFeatures",
  summary: "The functions that are on for the current space",
  access: { permission: "household.data.read", feature: "household.core" },
  response: {
    status: 200,
    description:
      "Keys of the functions that are on for the caller's space; functions that are off are not listed",
    schema: z.object({
      // New keys are added within /v1 as new functions arrive.
      features: z.array(z.enum(FLAG_KEYS as [string, ...string[]]).meta({ "x-extensible-enum": true })),
    }),
  },
  handler: async (_input, ctx) => {
    const snapshot = await ctx.db.transaction(readSnapshot);
    return {
      features: await flagsOn(snapshot, ctx.principal.householdId, () =>
        ctx.inHousehold(readIsTestHousehold),
      ),
    };
  },
});

export const featureFlagsRoutes = [myFeaturesRoute];

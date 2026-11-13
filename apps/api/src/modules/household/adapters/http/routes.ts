import { z } from "zod";
import { DATA_REGIONS } from "../../../../platform/db/isolation.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { renameSpace } from "../../application/index.ts";
import { SPACE_NAME_MAX, SPACE_REPORTING_CURRENCY, spaceName } from "../../domain/index.ts";
import { spaceSettingsTx } from "../db/store.ts";
import { householdServices, renameAudit } from "./services.ts";

/**
 * The space's settings (ACC-08@PoC FR 2, FR 5; «Налаштування → Простір», S-200). The space is the session's
 * (П-5): no route takes a space id, so another space can be neither read nor renamed. Behind the release flag
 * `household.space-settings` (ships off) under `household.core`.
 */
const MODULE = "household";
const FEATURE = "household.core";
const FLAG = "household.space-settings";

const settingsSchema = z.object({
  /** The space's name, 1–60 characters (ACC-08 FR 5). */
  name: z.string().min(1),
  /** The data region, fixed when the space was created (ARC-03 FR 3). */
  dataRegion: z.enum(DATA_REGIONS).meta({ "x-extensible-enum": true }),
  /**
   * The space's reporting currency, ISO 4217 (ACC-06@PoC FR 1, FR 2): EUR for every space in this release, with no
   * choice — no route changes it. Later releases may add currencies.
   */
  reportingCurrency: z.enum([SPACE_REPORTING_CURRENCY]).meta({ "x-extensible-enum": true }),
});

export const getSpaceRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/space",
  operationId: "getSpace",
  summary: "The current space: its name (shown in the profile), data region and reporting currency",
  access: { permission: "household.data.read", feature: FEATURE, flag: FLAG },
  response: { status: 200, description: "The caller's space", schema: settingsSchema },
  handler: async (_input, ctx) => {
    const settings = await ctx.inHousehold((q) => spaceSettingsTx(q).settings(ctx.principal.householdId));
    // The session's space always has its record (the login → space row references it; an erasure deletes both in
    // one transaction): a missing record is a broken invariant, not an answer about another space.
    if (!settings) throw new ApiProblem("INTERNAL");
    return settings as z.input<typeof settingsSchema>;
  },
});

export const renameSpaceRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/space",
  operationId: "renameSpace",
  summary: "Rename the current space (Owner)",
  access: { permission: "household.rename", feature: FEATURE, flag: FLAG },
  bodyLimitBytes: 4 * 1024,
  request: {
    body: z.object({
      /**
       * The new name: 1–60 characters after trimming, one line; uniqueness is not required (ACC-08 FR 5). The bound
       * of 4 UTF-16 units per character only caps the body; the 60 characters are counted as code points.
       */
      name: z
        .string()
        .max(SPACE_NAME_MAX * 4)
        .refine((n) => spaceName(n) !== null, { error: "invalid_space_name" }),
    }),
  },
  response: { status: 200, description: "The space with its new name", schema: settingsSchema },
  handler: async ({ body }, ctx) => {
    const audit = renameAudit(householdServices(ctx));
    const caller = { householdId: ctx.principal.householdId, accountId: ctx.principal.userId };
    const result = await ctx.inHousehold((q) => renameSpace(spaceSettingsTx(q), audit, caller, body.name));
    if (result.kind === "invalid") throw new ApiProblem("VALIDATION_FAILED");
    if (result.kind === "not-found") throw new ApiProblem("INTERNAL");
    return result.settings as z.input<typeof settingsSchema>;
  },
});

export const householdRoutes = [getSpaceRoute, renameSpaceRoute];

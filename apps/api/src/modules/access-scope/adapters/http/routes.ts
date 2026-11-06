import { z } from "zod";
import { defineRoute } from "../../../../platform/http/route.ts";
import { PERMISSION_KEYS, permissionsOf, ROLES } from "../../domain/index.ts";

/** `GET /v1/me/permissions`: what the caller may do in their space (clients hide what the role cannot do). */
export const myPermissionsRoute = defineRoute({
  module: "access-scope",
  method: "GET",
  path: "/v1/me/permissions",
  operationId: "getMyPermissions",
  summary: "My role and permissions in the current space",
  access: { permission: "household.data.read", feature: "household.core" },
  response: {
    status: 200,
    description: "The caller's role, whether a scope restricts them, and the permissions they hold",
    schema: z.object({
      role: z.enum(ROLES),
      scoped: z.boolean(),
      // New permissions are added within /v1 as new functions arrive.
      permissions: z.array(
        z.enum(PERMISSION_KEYS as [string, ...string[]]).meta({ "x-extensible-enum": true }),
      ),
    }),
  },
  handler: async (_input, ctx) => ({
    role: ctx.principal.role as (typeof ROLES)[number],
    scoped: ctx.principal.scoped,
    permissions: permissionsOf(ctx.principal),
  }),
});

export const accessScopeRoutes = [myPermissionsRoute];

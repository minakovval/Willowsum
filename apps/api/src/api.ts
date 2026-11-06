/**
 * The HTTP API of the `api` role (ARC-07): the platform routes plus every module's routes, checked by
 * access-scope (role and scope) and plan-catalog (feature key). Outside src/platform, because it wires
 * modules to the platform API layer.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { checkPermission, PERMISSION_KEYS } from "./modules/access-scope/index.ts";
import { modules } from "./modules/index.ts";
import { createEntitlements, FEATURE_KEYS, type EntitlementSource } from "./modules/plan-catalog/index.ts";
import type { ModuleDatabase } from "./platform/db/module-db.ts";
import { registerApi, type ApiOptions } from "./platform/http/api.ts";
import { moduleIdempotencyStore } from "./platform/http/idempotency.ts";
import { platformRoutes } from "./platform/http/meta.ts";
import type { ApiRoute, Principal } from "./platform/http/route.ts";

/** Every route of the API, in registry order: what is served and what the contract describes. */
export const apiRoutes: readonly ApiRoute[] = [...platformRoutes, ...modules.flatMap((m) => m.routes ?? [])];

export interface ApiWiring {
  readonly databases: { for(module: string): ModuleDatabase };
  readonly entitlements: EntitlementSource;
  /** The session of a request. Until identity (ACC-01) exists, nothing is signed in. */
  readonly authenticate?: (request: FastifyRequest) => Promise<Principal | null>;
  readonly supportId?: ApiOptions["supportId"];
}

export function apiOptions(wiring: ApiWiring): ApiOptions {
  const entitlements = createEntitlements(wiring.entitlements);
  return {
    routes: apiRoutes,
    authenticate: wiring.authenticate ?? (async () => null),
    checkPermission: (principal, permission) => checkPermission(principal, permission),
    checkFeature: (principal, feature) => entitlements.isEnabled(principal.householdId, feature),
    permissions: new Set(PERMISSION_KEYS),
    features: new Set(FEATURE_KEYS),
    databases: wiring.databases,
    idempotency: (module) => moduleIdempotencyStore(wiring.databases.for(module)),
    ...(wiring.supportId ? { supportId: wiring.supportId } : {}),
  };
}

export function mountApi(app: FastifyInstance, wiring: ApiWiring): void {
  registerApi(app, apiOptions(wiring));
}

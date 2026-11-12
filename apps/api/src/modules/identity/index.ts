// Public interface of the identity module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { identityRoutes } from "./adapters/index.ts";

export const identityModule = defineModule({
  name: "identity",
  publishes: [],
  consumes: [],
  routes: identityRoutes,
});

export {
  ARGON2_PARAMETERS,
  argon2Hasher,
  authenticateSession,
  createIdentityServices,
  SESSION_COOKIE,
} from "./adapters/index.ts";
export type { FirstSpace, SessionAccount } from "./application/index.ts";
export type { IdentityServices, IdentityServicesOptions } from "./adapters/index.ts";
export {
  CONFIRMATION_TTL_MS,
  MAIL_COOLDOWN_MS,
  MAIL_PER_HOUR,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_TTL_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SIGN_IN_FAILURE_WINDOW_MS,
  SIGN_IN_FAILURES_LIMIT,
  SIGN_IN_LOCK_MS,
  SIGN_UPS_PER_ADDRESS_PER_HOUR,
} from "./domain/index.ts";

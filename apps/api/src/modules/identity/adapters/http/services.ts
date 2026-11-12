import type { CaptchaVerifier } from "../../../../platform/adapters/captcha/index.ts";
import type { MailMessage, MailSender } from "../../../../platform/adapters/mail/index.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { createFixedWindowLimiter } from "../../../../platform/http/rate-limit.ts";
import type { PublicContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { IdentityDeps, PasswordHasher, Secrets } from "../../application/index.ts";
import { SIGN_UP_WINDOW_MS, SIGN_UPS_PER_ADDRESS_PER_HOUR } from "../../domain/index.ts";
import { argon2Hasher, nodeSecrets } from "../crypto.ts";
import { databaseIdentityStore, databaseRateLimitStore } from "../db/store.ts";

const BRAND = Symbol("willowsum-identity-services");

/**
 * What the API process wires for identity's routes (src/api.ts → `ctx.services`): the provider ports chosen by
 * `WS_PROVIDER_MODE` (mail, CAPTCHA — ARC-05), the audit log, the web app's origin for links in letters.
 */
export interface IdentityServices {
  readonly [BRAND]: true;
  readonly mail: MailSender;
  readonly captcha: CaptchaVerifier;
  readonly audit: Pick<AuditLog, "recordPlatform">;
  readonly webOrigin: string;
  readonly now: () => number;
  readonly hasher: PasswordHasher;
  readonly secrets: Secrets;
  /** Runs a letter's delivery after the answer has gone (default: the next turn of the event loop). */
  readonly deliver: (task: () => Promise<void>) => void;
}

export interface IdentityServicesOptions {
  readonly mail: MailSender;
  readonly captcha: CaptchaVerifier;
  readonly audit: Pick<AuditLog, "recordPlatform">;
  readonly webOrigin: string;
  readonly now?: () => number;
  readonly hasher?: PasswordHasher;
  readonly deliver?: (task: () => Promise<void>) => void;
}

export function createIdentityServices(options: IdentityServicesOptions): IdentityServices {
  const origin = new URL(options.webOrigin);
  if (origin.origin !== options.webOrigin)
    throw new Error("identity: webOrigin is an origin (scheme://host[:port])");
  return Object.freeze({
    [BRAND]: true as const,
    mail: options.mail,
    captcha: options.captcha,
    audit: options.audit,
    webOrigin: options.webOrigin,
    now: options.now ?? Date.now,
    hasher: options.hasher ?? argon2Hasher(),
    secrets: nodeSecrets,
    deliver:
      options.deliver ??
      ((task) => {
        setImmediate(() => void task());
      }),
  });
}

function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name || error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
}

/** The use cases' ports for one request of a public identity route. */
export function identityDeps(ctx: PublicContext): IdentityDeps {
  const services = ctx.services as IdentityServices | undefined;
  // Wired by src/api.ts; without it (or the module database) nothing of identity runs.
  if (!services || services[BRAND] !== true || !ctx.db) throw new ApiProblem("INTERNAL");
  const db = ctx.db;
  return {
    store: databaseIdentityStore(db),
    now: services.now,
    hasher: services.hasher,
    secrets: services.secrets,
    captcha: services.captcha,
    webOrigin: services.webOrigin,
    signUpLimiter: createFixedWindowLimiter({
      limit: SIGN_UPS_PER_ADDRESS_PER_HOUR,
      windowMs: SIGN_UP_WINDOW_MS,
      store: databaseRateLimitStore(db),
      now: services.now,
    }),
    sendLater: (message: MailMessage) =>
      services.deliver(async () => {
        try {
          await services.mail.send(message);
        } catch (error) {
          // The class only: the address and the text of a letter are personal data (ARC-09, NFR-10).
          logEvent("identity.mail_failed", "error", {
            "ws.module": "identity",
            "error.type": errorClass(error),
          });
        }
      }),
    audit: {
      accountChanged: async (accountId, before, after) => {
        await services.audit.recordPlatform({
          actor: { kind: "system" },
          channel: "web",
          entity: { type: "identity.account", id: accountId },
          action: before === null ? "create" : "update",
          changes: [{ field: "state", before, after, sensitive: false }],
        });
      },
    },
  };
}

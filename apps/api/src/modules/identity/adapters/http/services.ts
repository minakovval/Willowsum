import type { CaptchaVerifier } from "../../../../platform/adapters/captcha/index.ts";
import type { MailMessage, MailSender } from "../../../../platform/adapters/mail/index.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { HouseholdFreeDatabase, PublicContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
import {
  dailyCleanup,
  sessionAccount,
  type DailyCleanupReport,
  type FirstSpace,
  type IdentityDeps,
  type PasswordHasher,
  type Secrets,
  type SessionAccount,
} from "../../application/index.ts";
import { SIGN_UP_WINDOW_MS, SIGN_UPS_PER_ADDRESS_PER_HOUR, signUpAllowlist } from "../../domain/index.ts";
import { argon2Hasher, nodeSecrets } from "../crypto.ts";
import { databaseIdentityStore, databaseSlidingLimiter } from "../db/store.ts";

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
  /** The household module's first space (ACC-01 FR 7): created on the first sign-in. */
  readonly spaces: FirstSpace;
  /** May this login key sign up (ACC-01 FR 16)? From `signUpAllowlist`; the list itself is not kept here. */
  readonly signUpAllowed: (normalizedEmail: string) => boolean;
  readonly now: () => number;
  readonly hasher: PasswordHasher;
  readonly secrets: Secrets;
  /**
   * Runs work after the answer has gone (default: the next turn of the event loop): letters, and the lookup of a
   * password reset request.
   */
  readonly deliver: (task: () => Promise<void>) => void;
}

export interface IdentityServicesOptions {
  readonly mail: MailSender;
  readonly captcha: CaptchaVerifier;
  readonly audit: Pick<AuditLog, "recordPlatform">;
  readonly webOrigin: string;
  readonly spaces: FirstSpace;
  /**
   * The family's addresses that may sign up (`WS_SIGNUP_ALLOWLIST`; ACC-01 FR 16), matched as login keys (trimmed,
   * lower case). Omitted: every address may (local development and CI; the configuration requires it in staging
   * and production).
   */
  readonly signUpAllowlist?: Iterable<string>;
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
    spaces: options.spaces,
    signUpAllowed: signUpAllowlist(options.signUpAllowlist),
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
  return depsFor(services, ctx.db);
}

/**
 * The account of a session token for the protected routes of every module (src/api.ts builds the caller from it
 * and the account's space): a live session of a confirmed account, or null. A request never moves the idle
 * deadline (only `POST /v1/session/refresh`, sent for user actions, does; ACC-04 business rules); a lapsed session is
 * ended here with its reason.
 */
export function authenticateSession(
  services: IdentityServices,
  db: HouseholdFreeDatabase,
  token: string,
): Promise<SessionAccount | null> {
  return sessionAccount(depsFor(services, db), token);
}

/**
 * The daily task of identity (ACC-01 FR 6; ADR-0010), run by the scheduler role: deletes unconfirmed accounts 30
 * days after their sign-up and sweeps the rows that no longer change an answer or a limit.
 */
export function createIdentityMaintenance(options: {
  readonly db: HouseholdFreeDatabase;
  readonly audit: Pick<AuditLog, "recordPlatform">;
  readonly now?: () => number;
}): { dailyCleanup(): Promise<DailyCleanupReport> } {
  const deps = {
    store: databaseIdentityStore(options.db),
    now: options.now ?? Date.now,
    audit: {
      accountDeleted: async (accountId: string) => {
        await options.audit.recordPlatform({
          actor: { kind: "system" },
          channel: "system",
          entity: { type: "identity.account", id: accountId },
          action: "delete",
          changes: [{ field: "state", before: "unconfirmed", after: null, sensitive: false }],
        });
      },
    },
  };
  return { dailyCleanup: () => dailyCleanup(deps) };
}

function depsFor(services: IdentityServices, db: HouseholdFreeDatabase): IdentityDeps {
  return {
    store: databaseIdentityStore(db),
    now: services.now,
    hasher: services.hasher,
    secrets: services.secrets,
    captcha: services.captcha,
    webOrigin: services.webOrigin,
    spaces: services.spaces,
    signUpAllowed: services.signUpAllowed,
    signUpLimiter: databaseSlidingLimiter(db, {
      limit: SIGN_UPS_PER_ADDRESS_PER_HOUR,
      windowMs: SIGN_UP_WINDOW_MS,
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
    afterResponse: (task) =>
      services.deliver(async () => {
        try {
          await task();
        } catch (error) {
          // The class only: nothing of the request (an address) reaches telemetry (ARC-09, NFR-10).
          logEvent("identity.task_failed", "error", {
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
      passwordChanged: async (accountId) => {
        await services.audit.recordPlatform({
          actor: { kind: "system" },
          channel: "web",
          entity: { type: "identity.account", id: accountId },
          action: "update",
          // Sensitive: the log stores only the mask, never a hash (П-10).
          changes: [{ field: "password", before: "set", after: "set", sensitive: true }],
        });
      },
      signInChanged: async (accountId, before, after) => {
        await services.audit.recordPlatform({
          actor: { kind: "system" },
          channel: "web",
          entity: { type: "identity.account", id: accountId },
          action: "update",
          changes: [{ field: "sign-in", before, after, sensitive: false }],
        });
      },
      // Deletions are written by the daily task (createIdentityMaintenance), never by a request.
      accountDeleted: async () => {
        throw new Error("identity: accounts are deleted only by the daily task");
      },
    },
  };
}

import { z } from "zod";
import { clearedSessionCookie, sessionCookie } from "../../../../platform/http/cookies.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type PublicContext } from "../../../../platform/http/route.ts";
import {
  changeEmail,
  completePasswordReset,
  confirmEmail,
  confirmNotMe,
  notMeLinkState,
  passwordResetState,
  refreshSession,
  requestPasswordReset,
  resendForLink,
  resendForRegistration,
  sessionStatus,
  signIn,
  signOut,
  signUp,
  type ResendResult,
} from "../../application/index.ts";
import {
  DEVICE_BROWSERS,
  DEVICE_SYSTEMS,
  emailSchema,
  nameSchema,
  passwordSchema,
  SESSION_IDLE_MS,
  type SessionEndShown,
} from "../../domain/index.ts";
import { identityDeps } from "./services.ts";

/**
 * Identity's public routes (ACC-01@PoC part a; ADR-0009). They work before any session or space, so they are
 * public routes of the module. Before the body is read: the rate limit per client address (60/min, NFR-14), the
 * Origin of a write (NFR-15 FR 5), the module's kill switch and the flag `identity.sign-in` (on only at «all»). Answers
 * never tell whether an address has an account (NFR-15 FR 1, 2).
 */
const MODULE = "identity";
const FLAG = "identity.sign-in";
const PUBLIC =
  "Sign-up, email confirmation, sign-in and password reset work before a session or a space exists (ACC-01)";

/** The session cookie: `__Secure-session` on HTTPS (cookies.ts, NFR-15 FR 5). */
export const SESSION_COOKIE = "session";

/** An opaque token of identity: 32 random bytes, base64url. */
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const captchaToken = z.string().min(1).max(2048).optional();
const BODY_LIMIT = 8 * 1024;

const resendResponse = z.object({
  status: z.literal("sent"),
  /** Seconds until «Надіслати ще раз» may be used again (ACC-01 FR 15). */
  resendAfterS: z.number().int().min(0),
});

function resendAnswer(result: ResendResult): z.input<typeof resendResponse> {
  if (result.kind === "not-found") throw new ApiProblem("NOT_FOUND");
  if (result.kind === "wait") throw new ApiProblem("RATE_LIMITED", { retryAfterS: result.retryAfterS });
  return { status: "sent", resendAfterS: result.resendAfterS };
}

export const signUpRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/registrations",
  operationId: "signUp",
  summary: "Sign up with name, email and password",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["CAPTCHA_REQUIRED"],
  request: {
    body: z.object({
      name: nameSchema,
      email: emailSchema,
      password: passwordSchema,
      /** The CAPTCHA widget's token (ACC-01 FR 12). */
      captchaToken,
    }),
  },
  response: {
    status: 200,
    description:
      "Always «check your email», whether the address already has an account or not (ACC-01 FR 8); no session is created",
    schema: z.object({
      status: z.literal("check-email"),
      /** Opaque token of this sign-up for «Надіслати ще раз» and «Змінити email» (ACC-01 FR 13). */
      registrationToken: token,
      resendAfterS: z.number().int().min(0),
    }),
  },
  handler: async ({ body }, ctx) => {
    const result = await signUp(identityDeps(ctx), {
      name: body.name,
      email: body.email,
      password: body.password,
      captchaToken: body.captchaToken,
      clientAddress: ctx.http.clientAddress,
    });
    if (result.kind === "too-many") throw new ApiProblem("RATE_LIMITED", { retryAfterS: result.retryAfterS });
    if (result.kind === "captcha") throw new ApiProblem("CAPTCHA_REQUIRED");
    return {
      status: "check-email" as const,
      registrationToken: result.registrationToken,
      resendAfterS: result.resendAfterS,
    };
  },
});

export const resendRegistrationRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/registrations/resend",
  operationId: "resendRegistrationEmail",
  summary: "Send the letter of a sign-up again («Надіслати ще раз»)",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  request: { body: z.object({ registrationToken: token }) },
  response: {
    status: 200,
    description:
      "The letter is on its way; the same for a new and a taken address. 429 with Retry-After within 60 s of the last letter or after 5 in an hour",
    schema: resendResponse,
  },
  handler: async ({ body }, ctx) =>
    resendAnswer(await resendForRegistration(identityDeps(ctx), body.registrationToken)),
});

export const changeEmailRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/registrations/change-email",
  operationId: "changeRegistrationEmail",
  summary: "Leave the «check your email» screen to sign up with another address («Змінити email»)",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  request: { body: z.object({ registrationToken: token }) },
  response: {
    status: 200,
    description:
      "This sign-up's token and its confirmation link no longer work; an existing account is never changed. The client returns to the filled-in sign-up form",
    schema: z.object({ status: z.literal("closed") }),
  },
  handler: async ({ body }, ctx) => {
    if (!(await changeEmail(identityDeps(ctx), body.registrationToken))) throw new ApiProblem("NOT_FOUND");
    return { status: "closed" as const };
  },
});

export const confirmEmailRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/email-confirmations",
  operationId: "confirmEmail",
  summary: "Confirm the email address with the token of a confirmation link",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  request: { body: z.object({ token }) },
  response: {
    status: 200,
    description:
      "confirmed; expired (screen «Посилання недійсне» with «Надіслати ще раз»); already-used (sign-in page); invalid. Never a session",
    schema: z.object({ result: z.enum(["confirmed", "expired", "already-used", "invalid"]) }),
  },
  handler: async ({ body }, ctx) => ({ result: await confirmEmail(identityDeps(ctx), body.token) }),
});

export const resendConfirmationRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/email-confirmations/resend",
  operationId: "resendConfirmationEmail",
  summary: "A new confirmation link instead of an expired one («Надіслати ще раз» on «Посилання недійсне»)",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  request: { body: z.object({ token }) },
  response: {
    status: 200,
    description:
      "A new link is on its way and the old ones no longer work; 429 with Retry-After as for any resend",
    schema: resendResponse,
  },
  handler: async ({ body }, ctx) => resendAnswer(await resendForLink(identityDeps(ctx), body.token)),
});

export const signInRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/sessions",
  operationId: "signIn",
  summary: "Sign in with email and password",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["INVALID_CREDENTIALS", "CAPTCHA_REQUIRED", "SIGN_IN_LOCKED", "PASSWORD_RESET_REQUIRED"],
  request: {
    body: z.object({
      // Any text: a malformed address is just a wrong one (one answer, ACC-01 FR 9).
      email: z.string().min(1).max(320),
      password: z.string().min(1).max(1024),
      captchaToken,
    }),
  },
  response: {
    status: 200,
    description:
      "signed-in: the session cookie is set; a device (user agent) not in the account's sign-in history gets a security letter with «Це був не я» (not on the account's first sign-in). email-not-confirmed: no session; «Надіслати лист ще раз» uses registrationToken. 403 PASSWORD_RESET_REQUIRED: the right password, but «Це був не я» requires a new one first",
    schema: z.object({
      status: z.enum(["signed-in", "email-not-confirmed"]),
      /** Only with email-not-confirmed. */
      registrationToken: token.optional(),
      resendAfterS: z.number().int().min(0).optional(),
    }),
  },
  handler: async ({ body }, ctx) => {
    const result = await signIn(identityDeps(ctx), {
      email: body.email,
      password: body.password,
      captchaToken: body.captchaToken,
      userAgent: ctx.http.userAgent,
      clientAddress: ctx.http.clientAddress,
    });
    switch (result.kind) {
      case "invalid":
        throw new ApiProblem("INVALID_CREDENTIALS");
      case "password-reset-required":
        throw new ApiProblem("PASSWORD_RESET_REQUIRED");
      case "locked":
        throw new ApiProblem("SIGN_IN_LOCKED", { retryAfterS: result.retryAfterS });
      case "captcha":
        throw new ApiProblem("CAPTCHA_REQUIRED");
      case "email-not-confirmed":
        return {
          status: "email-not-confirmed" as const,
          registrationToken: result.registrationToken,
          resendAfterS: result.resendAfterS,
        };
      case "signed-in":
        ctx.http.setCookie(
          sessionCookie(
            SESSION_COOKIE,
            result.sessionToken,
            { https: ctx.http.https },
            { maxAgeS: result.maxAgeS },
          ),
        );
        return { status: "signed-in" as const };
    }
  },
});

/** 401 for a cookie whose session has ended: SESSION_ENDED with the reason; the cookie is removed (ACC-04@PoC). */
function sessionGone(
  ctx: PublicContext,
  check: { kind: "ended"; reason: SessionEndShown } | { kind: "none" },
): never {
  if (check.kind === "none") throw new ApiProblem("UNAUTHENTICATED");
  ctx.http.setCookie(clearedSessionCookie(SESSION_COOKIE, { https: ctx.http.https }));
  throw new ApiProblem("SESSION_ENDED", { extensions: { sessionEndReason: check.reason } });
}

export const currentSessionRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/session",
  operationId: "getSession",
  summary: "The signed-in account of this browser",
  access: { public: PUBLIC, flag: FLAG },
  problems: ["UNAUTHENTICATED", "SESSION_ENDED"],
  response: {
    status: 200,
    description:
      "The account of the session. Reading does not extend the session (only POST /v1/session/refresh does). 401 SESSION_ENDED with sessionEndReason when this browser's session has ended (its cookie is removed); 401 UNAUTHENTICATED without a session",
    schema: z.object({ name: z.string(), email: z.string() }),
  },
  handler: async (_input, ctx) => {
    const value = ctx.http.sessionCookie(SESSION_COOKIE);
    if (value === undefined) throw new ApiProblem("UNAUTHENTICATED");
    const check = await sessionStatus(identityDeps(ctx), value);
    if (check.kind !== "alive") sessionGone(ctx, check);
    return { name: check.account.name, email: check.account.email };
  },
});

export const refreshSessionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/session/refresh",
  operationId: "refreshSession",
  summary: "A user action in this browser: extend the session and rotate its token",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["UNAUTHENTICATED", "SESSION_ENDED"],
  response: {
    status: 200,
    description:
      "The client sends it for user actions only (click, input, navigation; ACC-04 business rules), never for background requests. The 15 min idle deadline moves for every tab of the browser and the session cookie gets a new token (NFR-01 FR 12); the 12 h end never moves. A token replaced less than 30 s ago (another tab's request on its way) extends the session without a new token; one replaced earlier ends the session (401 SESSION_ENDED, ended-elsewhere)",
    schema: z.object({
      status: z.literal("active"),
      /** Seconds without a user action after which the session ends (15 min, fixed). */
      idleTimeoutS: z.number().int().min(1),
      /** Seconds until the absolute end of the session (12 h after sign-in). */
      expiresInS: z.number().int().min(1),
    }),
  },
  handler: async (_input, ctx) => {
    const value = ctx.http.sessionCookie(SESSION_COOKIE);
    if (value === undefined) throw new ApiProblem("UNAUTHENTICATED");
    const result = await refreshSession(identityDeps(ctx), value);
    if (result.kind !== "refreshed") sessionGone(ctx, result);
    if (result.sessionToken !== null)
      ctx.http.setCookie(
        sessionCookie(
          SESSION_COOKIE,
          result.sessionToken,
          { https: ctx.http.https },
          { maxAgeS: result.maxAgeS },
        ),
      );
    return {
      status: "active" as const,
      idleTimeoutS: SESSION_IDLE_MS / 1000,
      expiresInS: result.maxAgeS,
    };
  },
});

export const signOutRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/session",
  operationId: "signOut",
  summary: "Sign out of this browser",
  access: { public: PUBLIC, flag: FLAG },
  response: {
    status: 200,
    description: "The session has ended and its cookie is removed (also when there was none)",
    schema: z.object({ status: z.literal("signed-out") }),
  },
  handler: async (_input, ctx) => {
    const value = ctx.http.sessionCookie(SESSION_COOKIE);
    if (value !== undefined) await signOut(identityDeps(ctx), value);
    ctx.http.setCookie(clearedSessionCookie(SESSION_COOKIE, { https: ctx.http.https }));
    return { status: "signed-out" as const };
  },
});

export const requestPasswordResetRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/password-resets",
  operationId: "requestPasswordReset",
  summary: "Ask for a password reset link by email («Відновлення пароля»)",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  request: { body: z.object({ email: emailSchema }) },
  response: {
    status: 200,
    description:
      "Always «if the account exists, we sent a letter» (ACC-01 FR 10, NFR-15 FR 1): the same answer and time for an address with and without an account. An account gets a link valid 60 min that revokes its earlier links, at most one letter per 60 s and 5 per hour",
    schema: z.object({ status: z.literal("requested") }),
  },
  handler: async ({ body }, ctx) => {
    requestPasswordReset(identityDeps(ctx), body.email);
    return { status: "requested" as const };
  },
});

export const checkPasswordResetRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/password-resets/check",
  operationId: "checkPasswordReset",
  summary: "Whether a password reset link can still be used (before the new-password form is shown)",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["RESET_LINK_INVALID"],
  request: { body: z.object({ token }) },
  response: {
    status: 200,
    description:
      "valid: the form for the new password may be shown. 410 RESET_LINK_INVALID: «Посилання недійсне» (used, replaced, older than 60 min or unknown). Changes nothing",
    schema: z.object({ status: z.literal("valid") }),
  },
  handler: async ({ body }, ctx) => {
    if ((await passwordResetState(identityDeps(ctx), body.token)) !== "valid")
      throw new ApiProblem("RESET_LINK_INVALID");
    return { status: "valid" as const };
  },
});

export const completePasswordResetRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/password-resets/complete",
  operationId: "completePasswordReset",
  summary: "Set a new password with a password reset link",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["RESET_LINK_INVALID"],
  request: {
    body: z.object({
      token,
      /** At least 12 characters, no composition rules (ACC-01 business rules). */
      password: passwordSchema,
    }),
  },
  response: {
    status: 200,
    description:
      "The password is changed, every session of the account has ended (this browser's cookie is removed too; no new session), the address counts as confirmed and a security notice is on its way. 410 RESET_LINK_INVALID when the link can no longer be used",
    schema: z.object({ status: z.literal("password-changed") }),
  },
  handler: async ({ body }, ctx) => {
    const result = await completePasswordReset(identityDeps(ctx), {
      token: body.token,
      password: body.password,
    });
    if (result.kind === "invalid") throw new ApiProblem("RESET_LINK_INVALID");
    ctx.http.setCookie(clearedSessionCookie(SESSION_COOKIE, { https: ctx.http.https }));
    return { status: "password-changed" as const };
  },
});

export const checkNotMeLinkRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/not-me-links/check",
  operationId: "checkNotMeLink",
  summary: "What the «Це був не я» page shows before the confirmation",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["NOT_ME_LINK_INVALID"],
  request: { body: z.object({ token }) },
  response: {
    status: 200,
    description:
      "valid: the sign-in of the new-device letter (time, browser and system, masked client address) and the account's email; the page asks to confirm. 410 NOT_ME_LINK_INVALID: «Посилання недійсне» (used, older than 7 days or unknown). Changes nothing",
    schema: z.object({
      status: z.literal("valid"),
      email: z.string(),
      signedInAt: z.iso.datetime(),
      device: z.object({ browser: z.enum(DEVICE_BROWSERS), os: z.enum(DEVICE_SYSTEMS) }),
      /** E.g. `89.64.•••.12`; location comes with a GeoIP database (NFR-15 FR 29). */
      address: z.string(),
    }),
  },
  handler: async ({ body }, ctx) => {
    const state = await notMeLinkState(identityDeps(ctx), body.token);
    if (state.kind !== "valid") throw new ApiProblem("NOT_ME_LINK_INVALID");
    return {
      status: "valid" as const,
      email: state.email,
      signedInAt: new Date(state.signedInAt).toISOString(),
      device: state.device,
      address: state.addressMasked,
    };
  },
});

export const confirmNotMeRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/not-me-links/confirm",
  operationId: "confirmNotMe",
  summary: "«Це був не я»: end every session and require a new password",
  access: { public: PUBLIC, flag: FLAG },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["NOT_ME_LINK_INVALID"],
  request: { body: z.object({ token }) },
  response: {
    status: 200,
    description:
      "Every session of the account has ended (this browser's cookie is removed too), every sign-in is refused until the password is changed, and a password reset link is on its way to the account's email. 410 NOT_ME_LINK_INVALID when the link was used, is older than 7 days or unknown",
    schema: z.object({ status: z.literal("secured") }),
  },
  handler: async ({ body }, ctx) => {
    if ((await confirmNotMe(identityDeps(ctx), body.token)).kind !== "secured")
      throw new ApiProblem("NOT_ME_LINK_INVALID");
    ctx.http.setCookie(clearedSessionCookie(SESSION_COOKIE, { https: ctx.http.https }));
    return { status: "secured" as const };
  },
});

export const identityRoutes = [
  signUpRoute,
  resendRegistrationRoute,
  changeEmailRoute,
  confirmEmailRoute,
  resendConfirmationRoute,
  signInRoute,
  currentSessionRoute,
  refreshSessionRoute,
  signOutRoute,
  requestPasswordResetRoute,
  checkPasswordResetRoute,
  completePasswordResetRoute,
  checkNotMeLinkRoute,
  confirmNotMeRoute,
];

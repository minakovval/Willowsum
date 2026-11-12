import { z } from "zod";
import { clearedSessionCookie, sessionCookie } from "../../../../platform/http/cookies.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import {
  changeEmail,
  confirmEmail,
  resendForLink,
  resendForRegistration,
  sessionAccount,
  signIn,
  signOut,
  signUp,
  type ResendResult,
} from "../../application/index.ts";
import { emailSchema, nameSchema, passwordSchema } from "../../domain/index.ts";
import { identityDeps } from "./services.ts";

/**
 * Identity's public routes (ACC-01@PoC part a; ADR-0009). They work before any session or space, so they are
 * public routes of the module: behind its kill switch and the flag `identity.sign-in` (on only at rollout «all»),
 * rate-limited per client address (60/min, NFR-14), writes refused from other origins (NFR-15 FR 5). Answers
 * never tell whether an address has an account (NFR-15 FR 1, 2).
 */
const MODULE = "identity";
const FLAG = "identity.sign-in";
const PUBLIC = "Sign-up, email confirmation and sign-in work before a session or a space exists (ACC-01)";

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
  problems: ["INVALID_CREDENTIALS", "CAPTCHA_REQUIRED", "SIGN_IN_LOCKED"],
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
      "signed-in: the session cookie is set. email-not-confirmed: no session; «Надіслати лист ще раз» uses registrationToken",
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
    });
    switch (result.kind) {
      case "invalid":
        throw new ApiProblem("INVALID_CREDENTIALS");
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

export const currentSessionRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/session",
  operationId: "getSession",
  summary: "The signed-in account of this browser",
  access: { public: PUBLIC, flag: FLAG },
  problems: ["UNAUTHENTICATED"],
  response: {
    status: 200,
    description: "The account of the session; 401 UNAUTHENTICATED without a live session",
    schema: z.object({ name: z.string(), email: z.string() }),
  },
  handler: async (_input, ctx) => {
    const value = ctx.http.sessionCookie(SESSION_COOKIE);
    const account = value === undefined ? null : await sessionAccount(identityDeps(ctx), value);
    if (!account) throw new ApiProblem("UNAUTHENTICATED");
    return { name: account.name, email: account.email };
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

export const identityRoutes = [
  signUpRoute,
  resendRegistrationRoute,
  changeEmailRoute,
  confirmEmailRoute,
  resendConfirmationRoute,
  signInRoute,
  currentSessionRoute,
  signOutRoute,
];

import { z } from "zod";

/**
 * Errors of the HTTP API (ARC-07 FR 4): RFC 9457 «problem details» (`application/problem+json`) with a
 * machine `code`. A problem never carries internal details (stack, SQL, driver messages) or personal data:
 * only the fixed title of its code, an optional fixed detail written by the route, and for invalid input
 * the paths and issue codes of the fields (never the values sent).
 */
export const PROBLEMS = {
  VALIDATION_FAILED: { status: 400, title: "The request is not valid" },
  MALFORMED_REQUEST: { status: 400, title: "The request body could not be read" },
  INVALID_CURSOR: { status: 400, title: "The page cursor is not valid" },
  UNAUTHENTICATED: { status: 401, title: "Sign-in is required" },
  /**
   * The session of this browser has ended (ACC-04@PoC): `sessionEndReason` says why, for the sign-in screen's
   * message — `idle` «Сесію завершено через бездіяльність», `ended-elsewhere` «Сесію завершено з іншого пристрою»,
   * `expired` (12 h) and `signed-out` (another tab signed out) without one. Only identity's session routes answer it,
   * to the holder of the session's own cookie; every other route answers UNAUTHENTICATED.
   */
  SESSION_ENDED: { status: 401, title: "The session has ended; sign in again" },
  /**
   * Sign-in failed (ACC-01 FR 9, NFR-15 FR 2): one answer for an unknown email and a wrong password, byte for
   * byte, so it never tells which one was wrong or that an account exists.
   */
  INVALID_CREDENTIALS: { status: 401, title: "Wrong email or password" },
  /**
   * The CAPTCHA was missing or did not pass (ACC-01 FR 12): at sign-up, and at every sign-in attempt for an email
   * after its lockout. Nothing else of the request was checked.
   */
  CAPTCHA_REQUIRED: { status: 400, title: "Complete the CAPTCHA and try again" },
  PLAN_LIMIT_REACHED: { status: 402, title: "The plan of this space does not include this action" },
  FORBIDDEN: { status: 403, title: "Your role does not allow this action" },
  /** A write request whose `Origin` is not one of the app's own (NFR-15 FR 5): a cross-site request. */
  ORIGIN_NOT_ALLOWED: { status: 403, title: "Requests from this origin are not allowed" },
  NOT_FOUND: { status: 404, title: "Not found" },
  /**
   * A password reset link that can no longer change the password (ACC-01 FR 10, NFR-15 FR 3): used, replaced by a
   * newer link, older than 60 minutes or unknown — one answer for all; the client shows «Посилання недійсне».
   */
  RESET_LINK_INVALID: { status: 410, title: "This password reset link is no longer valid" },
  /**
   * A «Це був не я» link that was used, is older than 7 days or unknown (ACC-04 FR 5, AC7) — one answer for all; the
   * client shows «Посилання недійсне».
   */
  NOT_ME_LINK_INVALID: { status: 410, title: "This link is no longer valid" },
  /**
   * The right password, but «Це був не я» was confirmed for the account: every sign-in is refused until the password
   * is changed with the reset link sent to its email (ACC-04 FR 5). Never given for a wrong password.
   */
  PASSWORD_RESET_REQUIRED: { status: 403, title: "Change your password with the link in your email first" },
  /**
   * Step-up (NFR-01 FR 13, NFR-15 FR 4): the current password typed to confirm a sensitive action is wrong. One
   * general answer, with no hint and no count of attempts left; it counts with the failed sign-ins.
   */
  STEP_UP_PASSWORD_INVALID: { status: 403, title: "The password is wrong" },
  /**
   * The sensitive action (the password change, ACC-05 FR 5) needs a step-up confirmation of this session for this
   * action from the last 5 minutes, used once: none was sent, or it was used, is older, belongs to another session
   * or action. The client asks for the current password again.
   */
  STEP_UP_REQUIRED: { status: 403, title: "Confirm this action with your current password" },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    title: "This idempotency key was already used for a different request",
  },
  IDEMPOTENCY_REQUEST_IN_PROGRESS: {
    status: 409,
    title: "A request with this idempotency key is still being processed",
  },
  /**
   * The record changed since the version the client read (NFR-15 FR 13): `currentVersion` and `changedFields`
   * say what to reload. Nothing was written.
   */
  VERSION_CONFLICT: { status: 409, title: "The record was changed by someone else; reload it and try again" },
  PAYLOAD_TOO_LARGE: { status: 413, title: "The request body is too large" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: "The request body must be application/json" },
  /**
   * A technical limit that does not depend on the plan (NFR-15 FR 17: filters per request, bulk size, drafts,
   * saved views); `limit` is the limit that was reached. Plan limits are 402 PLAN_LIMIT_REACHED instead.
   */
  LIMIT_REACHED: { status: 422, title: "A limit of the service was reached" },
  /** Too many requests from this client in the current minute (NFR-14 FR 5–6); retry after `Retry-After`. */
  RATE_LIMITED: { status: 429, title: "Too many requests; try again shortly" },
  /**
   * Sign-in for this email is locked after 5 failed attempts in 15 minutes (ACC-01, NFR-14 FR 7): retry after
   * `Retry-After`, then with a CAPTCHA. The same for an email without an account.
   */
  SIGN_IN_LOCKED: { status: 429, title: "Sign-in is temporarily locked; try again later" },
  INTERNAL: { status: 500, title: "Something went wrong on our side" },
  /** The route's module is switched off by its kill switch (CICD-06 FR 3); clients show «Тимчасово недоступно». */
  MODULE_UNAVAILABLE: { status: 503, title: "This function is temporarily unavailable" },
  /** The process is stopping (graceful stop, ARC-02 FR 5): the client retries after `Retry-After` on another one. */
  SERVICE_UNAVAILABLE: { status: 503, title: "The service is restarting; try again shortly" },
} as const satisfies Record<string, { status: number; title: string }>;

export type ProblemCode = keyof typeof PROBLEMS;
export const PROBLEM_CODES = Object.keys(PROBLEMS) as ProblemCode[];
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** `type` is a URN per code (RFC 9457 §3.1.1 allows any URI); clients switch on `code`. */
export function problemType(code: ProblemCode): string {
  return `urn:willowsum:problem:${code.toLowerCase().replaceAll("_", "-")}`;
}

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    // New codes are added within /v1: clients treat an unknown code by its HTTP status.
    code: z
      .enum(PROBLEM_CODES as [ProblemCode, ...ProblemCode[]])
      .meta({ "x-extensible-enum": true, description: "Machine-readable code; new codes may be added" }),
    detail: z.string().optional(),
    /**
     * The support code of this error (ARC-09 FR 3, NFR-10 FR 4): the trace id the server drew at random for the
     * request (32 hex digits). Every problem the API serves carries it; clients show it as the error code.
     */
    supportId: z.string().optional().meta({
      description:
        "Support code: the trace id the server drew for this request (32 hex digits); clients show it as the error code",
    }),
    /** For VERSION_CONFLICT: the version of the record now (NFR-15 FR 13). */
    currentVersion: z.number().int().min(0).optional().meta({
      description: "VERSION_CONFLICT: the current version of the record",
    }),
    /**
     * For VERSION_CONFLICT: the fields someone else changed — those of the `base` the client sent (the values it
     * read at its version) that the caller may read and whose stored value now differs. Names only, never values.
     */
    changedFields: z.array(z.string()).optional().meta({
      description:
        "VERSION_CONFLICT: the fields changed since the client's version — the readable fields of the base values it sent whose stored value now differs (field names only; fields left out of the base are not reported)",
    }),
    /** For SESSION_ENDED: why the session ended (ACC-04@PoC «Стани інтерфейсу»). */
    sessionEndReason: z.enum(["idle", "expired", "signed-out", "ended-elsewhere"]).optional().meta({
      description:
        "SESSION_ENDED: idle (15 min without a user action), expired (12 h after sign-in), signed-out (this browser signed out), ended-elsewhere (a password reset, a password change in the profile on another device, «Це був не я» or a reused token ended it)",
    }),
    /** For LIMIT_REACHED: the limit that was reached (a number of the service, never of the plan). */
    limit: z
      .number()
      .int()
      .min(0)
      .optional()
      .meta({ description: "LIMIT_REACHED: the limit that was reached" }),
    /** For VALIDATION_FAILED: where the input is wrong; never the values sent. */
    errors: z
      .array(
        z.object({ in: z.enum(["path", "query", "header", "body"]), path: z.string(), issue: z.string() }),
      )
      .optional(),
  })
  .meta({ description: "RFC 9457 problem details with a machine-readable code (ARC-07 FR 4)." });

export type Problem = z.infer<typeof ProblemSchema>;
export type ProblemFieldError = NonNullable<Problem["errors"]>[number];

/** Thrown by route handlers (and the API layer) to answer with a problem. */
export class ApiProblem extends Error {
  readonly code: ProblemCode;
  readonly detail: string | undefined;
  readonly errors: readonly ProblemFieldError[] | undefined;
  /** Extension members of the problem (VERSION_CONFLICT, LIMIT_REACHED); values the server chose, never input. */
  readonly extensions: ProblemExtensions | undefined;
  /** Whole seconds the client waits before retrying: sent as `Retry-After` (SIGN_IN_LOCKED, RATE_LIMITED). */
  readonly retryAfterS: number | undefined;

  constructor(
    code: ProblemCode,
    options: {
      detail?: string;
      errors?: readonly ProblemFieldError[];
      extensions?: ProblemExtensions;
      retryAfterS?: number;
    } = {},
  ) {
    super(code);
    this.name = "ApiProblem";
    this.code = code;
    this.detail = options.detail;
    this.errors = options.errors;
    this.extensions = options.extensions;
    if (
      options.retryAfterS !== undefined &&
      (!Number.isInteger(options.retryAfterS) || options.retryAfterS < 1)
    )
      throw new Error("retryAfterS is a positive integer");
    this.retryAfterS = options.retryAfterS;
  }
}

/** The extension members a problem may carry (declared in ProblemSchema). */
export type ProblemExtensions = Partial<
  Pick<Problem, "currentVersion" | "changedFields" | "limit" | "sessionEndReason">
>;

export function problemBody(
  code: ProblemCode,
  options: {
    detail?: string | undefined;
    errors?: readonly ProblemFieldError[] | undefined;
    supportId?: string | undefined;
    extensions?: ProblemExtensions | undefined;
  } = {},
): Problem {
  const { status, title } = PROBLEMS[code];
  return {
    type: problemType(code),
    title,
    status,
    code,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ...(options.supportId !== undefined ? { supportId: options.supportId } : {}),
    ...(options.errors !== undefined ? { errors: [...options.errors] } : {}),
    ...(options.extensions?.currentVersion !== undefined
      ? { currentVersion: options.extensions.currentVersion }
      : {}),
    ...(options.extensions?.changedFields !== undefined
      ? { changedFields: [...options.extensions.changedFields] }
      : {}),
    ...(options.extensions?.limit !== undefined ? { limit: options.extensions.limit } : {}),
    ...(options.extensions?.sessionEndReason !== undefined
      ? { sessionEndReason: options.extensions.sessionEndReason }
      : {}),
  };
}

/**
 * A record the caller cannot see does not exist for them (DAT-05 FR 6, AGENTS.md «Data access»): a route
 * that reads one record answers 404 NOT_FOUND both when it does not exist and when it belongs to another
 * space (the household policy hides it), with the same body as an unknown path — never «no access».
 */
export function requireFound<T>(record: T | null | undefined): T {
  if (record === null || record === undefined) throw new ApiProblem("NOT_FOUND");
  return record;
}

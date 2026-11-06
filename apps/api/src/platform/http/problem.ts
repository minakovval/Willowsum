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
  PLAN_LIMIT_REACHED: { status: 402, title: "The plan of this space does not include this action" },
  FORBIDDEN: { status: 403, title: "Your role does not allow this action" },
  NOT_FOUND: { status: 404, title: "Not found" },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    title: "This idempotency key was already used for a different request",
  },
  IDEMPOTENCY_REQUEST_IN_PROGRESS: {
    status: 409,
    title: "A request with this idempotency key is still being processed",
  },
  PAYLOAD_TOO_LARGE: { status: 413, title: "The request body is too large" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: "The request body must be application/json" },
  INTERNAL: { status: 500, title: "Something went wrong on our side" },
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
    /** Support id the user can quote; filled by the tracing hook once ARC-09 exists. */
    supportId: z.string().optional(),
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

  constructor(code: ProblemCode, options: { detail?: string; errors?: readonly ProblemFieldError[] } = {}) {
    super(code);
    this.name = "ApiProblem";
    this.code = code;
    this.detail = options.detail;
    this.errors = options.errors;
  }
}

export function problemBody(
  code: ProblemCode,
  options: {
    detail?: string | undefined;
    errors?: readonly ProblemFieldError[] | undefined;
    supportId?: string | undefined;
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
  };
}

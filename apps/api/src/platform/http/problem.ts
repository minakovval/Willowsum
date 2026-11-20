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
  /**
   * «Такий рахунок уже є» (FIN-01@PoC FR 25; FIN-12@PoC FR 11): an account of the same institution, number or IBAN and
   * currency is in the space already; nothing was created or changed («Реквізити»). Which one, the create form learns
   * from the duplicate check.
   */
  ACCOUNT_DUPLICATE: {
    status: 409,
    title: "An account with this institution, number and currency already exists",
  },
  /** «Закритий» (FIN-12@PoC FR 8): a closed account is read-only; nothing was written. */
  ACCOUNT_CLOSED: { status: 409, title: "The account is closed" },
  /** «Відкрити знову» of an account that is not closed (FIN-12@PoC FR 9); nothing was written. */
  ACCOUNT_NOT_CLOSED: { status: 409, title: "The account is not closed" },
  /**
   * FIN-12@PoC FR 7: an account closes only with a zero balance on the closing date — choose «Перенести на інший
   * рахунок» or «Списати коригуванням». Nothing was written.
   */
  ACCOUNT_BALANCE_NOT_ZERO: { status: 409, title: "The balance on the closing date is not zero" },
  /** FIN-12@PoC FR 7: the account has movements after the closing date; nothing was written. */
  ACCOUNT_ACTIVITY_AFTER_CLOSE: {
    status: 409,
    title: "The account has movements after the closing date",
  },
  /**
   * FIN-01@PoC EC4: a change of the account's money saved in another module (a transaction) has not reached the journal
   * yet and could not be finished now; the account was not closed. Try again later.
   */
  ACCOUNT_POSTINGS_PENDING: {
    status: 409,
    title: "Some of the account's transactions are still being posted; try again later",
  },
  /**
   * «Тип можна змінити лише в межах групи» (FIN-12@PoC FR 5, AC2): «Готівкові» ↔ «Кредитні» is refused; nothing was
   * written.
   */
  ACCOUNT_KIND_OTHER_GROUP: { status: 409, title: "The kind can change only within its group" },
  /**
   * FIN-12@PoC FR 5, AC11: «Кредит» ↔ «Кредитна картка» only for an account without transactions; nothing was written.
   */
  ACCOUNT_HAS_TRANSACTIONS: { status: 409, title: "The account has transactions; its kind cannot change" },
  /** IMP-02@PoC FR 15: the account's main currency (its own) stays; nothing was written. */
  ACCOUNT_MAIN_CURRENCY: { status: 409, title: "The account's main currency cannot be removed" },
  /** IMP-02@PoC FR 15, AC14: a currency whose wallet has transactions cannot be removed; nothing was written. */
  ACCOUNT_CURRENCY_HAS_TRANSACTIONS: {
    status: 409,
    title: "The currency has transactions on this account; it cannot be removed",
  },
  /** «Така назва вже існує» (BUD-01@PoC FR 2): a category or group of the space has the name (any case); nothing written. */
  CATEGORY_NAME_TAKEN: { status: 409, title: "A category with this name already exists" },
  /** «Категорії різних типів не можна об'єднати» (BUD-01@PoC FR 8, AC6); nothing was written. */
  CATEGORY_KINDS_DIFFER: { status: 409, title: "Categories of different types cannot be merged" },
  /** BUD-01@PoC FR 3: «Переказ» and «Коригування» are never hidden or merged; nothing was written. */
  CATEGORY_SERVICE_FIXED: { status: 409, title: "A service category cannot be hidden or merged" },
  /** BUD-01@PoC FR 12, FR 3: a system category is never deleted, only hidden; nothing was written. */
  CATEGORY_SYSTEM_FIXED: { status: 409, title: "A system category cannot be deleted; it can be hidden" },
  /**
   * «Категорію з транзакціями, правилами або лімітами не можна видалити — приховайте або об'єднайте її» (BUD-01@PoC
   * FR 12, AC19): a transaction, split part, rule, recurring payment, limit or «План» cell uses the category, or
   * another was merged into it; nothing was written.
   */
  CATEGORY_NOT_EMPTY: {
    status: 409,
    title: "A category with transactions, rules or limits cannot be deleted — hide or merge it",
  },
  /**
   * BUD-07@PoC FR 4: the proposal is not offered any more — its merchant became a regular payment, the series was
   * rejected «Не регулярний», or the transactions changed and the analysis no longer finds it; nothing was written.
   */
  RECURRING_PROPOSAL_GONE: {
    status: 409,
    title: "The proposal is no longer offered; read the proposals again",
  },
  /**
   * BUD-07@PoC FR 20, FR 21: the charge is not in the status the action needs — «Позначити пропущеним» only an overdue
   * charge, «Зарахувати за <місяць>» only an overdue or skipped one (it was paid or marked meanwhile); nothing was
   * written. FR 10: «Залишити» only a payment that is «Можливо, скасований».
   */
  RECURRING_CHARGE_STATE: {
    status: 409,
    title: "The charge or the payment is not in the status this action needs; read it again",
  },
  /**
   * BUD-07@PoC FR 8, FR 20: the transaction already pays a charge of a regular payment (matched, or settled by the user),
   * or is not one of the payment's type within the transactions analysed; nothing was written.
   */
  RECURRING_TRANSACTION_TAKEN: {
    status: 409,
    title: "The transaction already pays a charge, or cannot pay this one",
  },
  /** BUD-05@PoC FR 2: the account is another goal's own account, or has envelopes beside one; nothing was written. */
  GOAL_ACCOUNT_TAKEN: {
    status: 409,
    title: "The account is another goal's own account, or has envelopes",
  },
  /** «Сума конвертів перевищує залишок рахунку на N €» (BUD-05@PoC FR 3, AC4): `excess` is N; nothing was written. */
  GOAL_ENVELOPES_OVER_BALANCE: { status: 409, title: "The envelopes of the account exceed its balance" },
  /**
   * BUD-05@PoC FR 6, AC15: a goal on its own account has no «Внести» — its contributions are transfers to the account;
   * nothing was written.
   */
  GOAL_OWN_ACCOUNT: { status: 409, title: "Add a transfer to the goal's account instead" },
  GOAL_SPEND_OVER_COLLECTED: { status: 409, title: "The transactions take more than the goal holds" },
  /** «Бюджет уже існує» (BUD-02@PoC FR 1, edge case 6): the space has its one budget; nothing was written. */
  BUDGET_EXISTS: { status: 409, title: "The space already has a budget" },
  /** «Бюджет ще не існував на цю дату» (BUD-02@PoC edge case 5): the period is before the budget's first one. */
  BUDGET_PERIOD_BEFORE_START: { status: 404, title: "The budget did not exist yet in this period" },
  /** «За цих умов борг не зменшується» (BUD-19@PoC FR 3, AC4): a plan that never pays the debt off is not saved. */
  DEBT_NOT_DECREASING: { status: 409, title: "Under these terms the debt does not decrease" },
  /** «Розрахунок перевищує 100 років — збільште платіж» (BUD-19@PoC edge case 6): the plan is not saved. */
  DEBT_OVER_LIMIT: { status: 409, title: "The calculation exceeds 100 years — increase the payment" },
  /**
   * «Інша масова дія ще виконується» (DAT-03@PoC FR 6, AC7): the account already has a bulk action running; nothing was
   * written.
   */
  BULK_ACTION_RUNNING: { status: 409, title: "Another bulk action is still running" },
  /**
   * DAT-03@PoC FR 8, AC4: «Відмінити» is not available — the 24 hours after the end are over, the action was undone
   * already or is still running; nothing was written.
   */
  BULK_UNDO_UNAVAILABLE: { status: 409, title: "This bulk action can no longer be undone" },
  /**
   * BUD-14@PoC FR 7: another run of «Застосувати до N наявних транзакцій» (or its «Відмінити») of the space is still
   * running; nothing was written.
   */
  RULE_RUN_RUNNING: { status: 409, title: "Another run of a category rule is still running" },
  /** «Час для відміни минув» (BUD-14@PoC FR 7, AC6): the 7 days after the run are over; nothing was written. */
  RULE_RUN_UNDO_EXPIRED: { status: 409, title: "The time to undo this run is over" },
  /** «Запуск уже відмінено» (BUD-14@PoC FR 7): the run was undone already; nothing was written. */
  RULE_RUN_UNDONE: { status: 409, title: "This run was undone already" },
  /**
   * «Потребує уваги» (BUD-14@PoC FR 10): the rule's category or an account is gone; it applies to nothing until it is
   * edited; nothing was written.
   */
  RULE_NEEDS_ATTENTION: { status: 409, title: "The rule needs attention: edit it first" },
  /** DAT-03@PoC FR 10: «Продовжити» only for an interrupted bulk action; nothing was written. */
  BULK_ACTION_NOT_INTERRUPTED: { status: 409, title: "This bulk action is not interrupted" },
  /**
   * FIN-03@PoC FR 7, FR 9, FR 18: a side of a transfer between own accounts is never hidden, split or deleted, and its
   * account, amount, date and state change only once the mark is removed; nothing was written.
   */
  TRANSACTION_IN_TRANSFER: {
    status: 409,
    title: "The transaction is a side of a transfer; remove the mark first",
  },
  /**
   * FIN-03@PoC FR 11, edge case 4: a duplicate merged into another changes only through «Роз'єднати», and a transaction
   * that others were merged into is deleted only once they are unmerged; nothing was written.
   */
  TRANSACTION_MERGED: {
    status: 409,
    title: "The transaction is merged with a duplicate; unmerge it first",
  },
  /**
   * FIN-03@PoC FR 34 (owner, 2026-11-15, #281 item 4): duplicates are merged into the transaction («Об'єднано»), so its
   * amount and account change only after «Роз'єднати» (DELETE …/merge on it gives every duplicate back); its date and
   * texts change as usual; nothing was written.
   */
  TRANSACTION_HAS_DUPLICATES: {
    status: 409,
    title: "Duplicates are merged into this transaction; unmerge them to change its amount or account",
  },
  /**
   * BUD-01@PoC FR 6, FIN-03@PoC FR 23: a split transaction has the categories of its parts; its own category changes
   * only once the split is removed; nothing was written.
   */
  TRANSACTION_SPLIT: {
    status: 409,
    title: "The transaction is split; change the categories of its parts",
  },
  /**
   * BUD-14@PoC FR 3: the merchant joined another («Об'єднати з…»); it is renamed or merged through that one, or given
   * back by «Роз'єднати» first; nothing was written.
   */
  MERCHANT_MERGED: {
    status: 409,
    title: "The merchant is merged into another; unmerge it first",
  },
  /** FIN-03@PoC FR 18: hiding is for duplicates and technical records only; nothing was written. */
  TRANSACTION_NOT_HIDEABLE: {
    status: 409,
    title: "Only a duplicate or a technical record can be hidden",
  },
  /**
   * BUD-12@PoC FR 8: «Підтвердити» and its «Відмінити» are for the transactions of «До розбору»; one entered by hand was
   * never there; nothing was written.
   */
  TRANSACTION_NOT_IN_REVIEW: {
    status: 409,
    title: "The transaction is not in the review queue",
  },
  PAYLOAD_TOO_LARGE: { status: 413, title: "The request body is too large" },
  /**
   * IMP-01@PoC FR 6, FR 13–15: every file of an upload was rejected; `rejection` is the first one's reason (its code and
   * the ceiling it exceeded — never a plan's limit). Nothing of those files was stored.
   */
  FILE_REJECTED: { status: 422, title: "The file was not accepted" },
  /** The same for a size: the file, the upload, the batch or the space's storage is over its technical ceiling. */
  FILE_TOO_LARGE: { status: 413, title: "The file is over a technical ceiling" },
  /** IMP-01@PoC FR 10: the batch's state does not allow this step; nothing was written. */
  BATCH_STATE_CONFLICT: { status: 409, title: "The batch's state does not allow this" },
  /** IMP-05@PoC FR 7, AC7: the chosen reading has more decimals than the currency allows; nothing was written. */
  READING_TOO_PRECISE: { status: 422, title: "The reading has more decimals than the currency allows" },
  /**
   * IMP-05@PoC FR 10: a decision names a file, row, question or flag the batch's checks do not have; `errors` names the
   * decision and the issue's code. Nothing of the request was written.
   */
  IMPORT_DECISION_INVALID: { status: 422, title: "The decision does not fit the batch" },
  /**
   * IMP-01@PoC FR 5: a parse request names a file that is not the batch's accepted one, or a recipe or account the
   * space does not have (another space's is the same answer); `errors` names the field. Nothing was written.
   */
  IMPORT_PARSE_INVALID: { status: 422, title: "The parse request does not fit the batch" },
  /** IMP-06@PoC FR 2, FR 3, FR 14: the recipe is not valid; `recipeErrors` holds each error's code and field path. */
  RECIPE_INVALID: { status: 422, title: "The parsing recipe is not valid" },
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
    /** For VERSION_CONFLICT of «Підтвердити» (BUD-12 FR 7): the category the transaction has now; null — «Без категорії». */
    currentCategoryId: z.uuid().nullable().optional().meta({
      description:
        "VERSION_CONFLICT of confirming a transaction in review: the category it has now (null: none), so the card can show it without a reload",
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
    /** For GOAL_ENVELOPES_OVER_BALANCE: by how much the envelopes would exceed the balance (BUD-05@PoC AC4). */
    excess: z.object({ amount: z.string(), currency: z.string() }).optional().meta({
      description:
        "GOAL_ENVELOPES_OVER_BALANCE: by how much the envelopes would exceed the account's balance",
    }),
    /** For FILE_REJECTED and FILE_TOO_LARGE: why the first file was rejected (IMP-01 FR 6). */
    rejection: z
      .object({
        code: z.string().meta({ "x-extensible-enum": true, description: "The reason's code" }),
        ceiling: z.object({ name: z.string(), limit: z.number().int().min(0) }).optional(),
      })
      .optional()
      .meta({
        description: "FILE_REJECTED, FILE_TOO_LARGE: the first file's reason and the ceiling it exceeded",
      }),
    /** For RECIPE_INVALID (IMP-06 FR 14): each error's code and the field's path; the client localises the code. */
    recipeErrors: z
      .array(
        z.object({
          code: z.string().meta({ "x-extensible-enum": true, description: "The error's code" }),
          path: z.string().meta({
            description: 'The field\'s path in the recipe, e.g. columns[3].role; "" — the whole recipe',
          }),
          reason: z
            .string()
            .optional()
            .meta({ description: "UNSAFE_PATTERN: the rule of the safe dialect it breaks" }),
        }),
      )
      .optional()
      .meta({ description: "RECIPE_INVALID: the recipe's errors with their codes and paths" }),
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
  Pick<
    Problem,
    | "currentVersion"
    | "currentCategoryId"
    | "changedFields"
    | "limit"
    | "sessionEndReason"
    | "excess"
    | "rejection"
    | "recipeErrors"
  >
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
    ...(options.extensions?.currentCategoryId !== undefined
      ? { currentCategoryId: options.extensions.currentCategoryId }
      : {}),
    ...(options.extensions?.changedFields !== undefined
      ? { changedFields: [...options.extensions.changedFields] }
      : {}),
    ...(options.extensions?.limit !== undefined ? { limit: options.extensions.limit } : {}),
    ...(options.extensions?.sessionEndReason !== undefined
      ? { sessionEndReason: options.extensions.sessionEndReason }
      : {}),
    ...(options.extensions?.excess !== undefined ? { excess: { ...options.extensions.excess } } : {}),
    ...(options.extensions?.rejection !== undefined
      ? {
          rejection: {
            code: options.extensions.rejection.code,
            ...(options.extensions.rejection.ceiling
              ? { ceiling: { ...options.extensions.rejection.ceiling } }
              : {}),
          },
        }
      : {}),
    ...(options.extensions?.recipeErrors !== undefined
      ? {
          recipeErrors: options.extensions.recipeErrors.map((e) => ({
            code: e.code,
            path: e.path,
            ...(e.reason !== undefined ? { reason: e.reason } : {}),
          })),
        }
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

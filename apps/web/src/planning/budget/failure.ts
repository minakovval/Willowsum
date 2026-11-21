import type { MessageKey } from "@willowsum/i18n";
import { failureOf } from "../../auth/failure.ts";

/** The refusal in the budget's words: «Реєстрація і вхід недоступні» of the sign-in is not about the budget. */
export function budgetFailureKey(failure: Parameters<typeof failureOf>[0]): MessageKey {
  const key = failureOf(failure).key;
  return key === "auth.error.unavailable" || key === "auth.error.captcha"
    ? "planning.budget.error.body"
    : key;
}

import type { ApiClient, paths } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../auth/api.ts";

/**
 * FIN-12@PoC d) — what S-055 «Закрити рахунок» and S-055a «Оновити залишок» send (module `accounts`; API on `main`):
 * `GET /v1/accounts/{id}/closing` (the balance on the closing date), `POST /v1/accounts/{id}/close` (FR 7, FR 8) and
 * `POST /v1/accounts/{id}/balance` (FR 14, FR 15). The server decides every money movement; the screens only show it.
 */
export type Closing =
  paths["/v1/accounts/{accountId}/closing"]["get"]["responses"]["200"]["content"]["application/json"];
export type CloseBody = NonNullable<
  paths["/v1/accounts/{accountId}/close"]["post"]["requestBody"]
>["content"]["application/json"];
export type Settlement = NonNullable<CloseBody["settlement"]>;
export type BalanceResult =
  paths["/v1/accounts/{accountId}/balance"]["post"]["responses"]["200"]["content"]["application/json"];

export const readClosing = (api: ApiClient, accountId: string, closedOn: string): Promise<Outcome<Closing>> =>
  outcome(
    api.GET("/v1/accounts/{accountId}/closing", {
      params: { path: { accountId }, query: { closedOn } },
    }),
  );

export const closeAccount = (api: ApiClient, accountId: string, body: CloseBody): Promise<Outcome<unknown>> =>
  outcome(api.POST("/v1/accounts/{accountId}/close", { params: { path: { accountId } }, body }));

export const updateBalance = (
  api: ApiClient,
  accountId: string,
  balance: { readonly amount: string; readonly currency: string },
): Promise<Outcome<BalanceResult>> =>
  outcome(
    api.POST("/v1/accounts/{accountId}/balance", {
      params: { path: { accountId } },
      body: { balance: { amount: balance.amount, currency: balance.currency } },
    }),
  );

/** The issue the server gave a field of the request (`VALIDATION_FAILED`: `errors[].path` and `issue`). */
export function fieldIssue(o: Outcome<unknown>, path: string): string | null {
  if (o.ok || o.kind !== "problem" || o.problem.code !== "VALIDATION_FAILED") return null;
  const errors = (o.problem as { errors?: readonly { path: string; issue: string }[] }).errors ?? [];
  return errors.find((e) => e.path === path)?.issue ?? null;
}

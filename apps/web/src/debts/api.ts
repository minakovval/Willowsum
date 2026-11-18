import { useCallback, useEffect, useState } from "react";
import type { operations, paths } from "@willowsum/api-contract";
import { outcome, useAuthApi } from "../auth/api.ts";

/** One debt of `GET /v1/debts` (BUD-19@PoC FR 1, FR 7, FR 11; module `debt-payoff`). */
export type Debt =
  paths["/v1/debts"]["get"]["responses"]["200"]["content"]["application/json"]["debts"][number];
export type MoneyValue = Debt["balance"];

/**
 * The debts of the space for «Борги» and its tabs. `off` — the function is switched off for the space (flag
 * `debts.payoff`: 404 as an unknown path) or its module is (503): the page keeps the empty page of a function
 * that is not there. `error` carries the problem's support code for «Код: …».
 */
export type DebtsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly debts: readonly Debt[] }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly supportId?: string };

export function useDebts(): { state: DebtsState; retry: () => void; refresh: () => void } {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DebtsState>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/debts")).then((o) => {
      if (!live) return;
      if (o.ok) setState({ kind: "ready", debts: o.data.debts });
      else if (
        o.kind === "problem" &&
        (o.problem.code === "NOT_FOUND" || o.problem.code === "MODULE_UNAVAILABLE")
      )
        setState({ kind: "off" });
      else
        setState(
          o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" },
        );
    });
    return () => {
      live = false;
    };
  }, [api, attempt]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  /** Reads the debts again without the skeleton (after «Зберегти план»). */
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry, refresh };
}

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;
type Body<T> = T extends { requestBody: { content: { "application/json": infer B } } } ? B : never;

/** `POST /v1/debts/{accountId}/scenario`: the base and the scenario of one debt (BUD-19@PoC FR 2, FR 4). */
export type Scenario = Json<operations["calculateDebtScenario"]>;
export type Calculation = Scenario["base"];
export type ScenarioBody = Body<operations["calculateDebtScenario"]>;
export type PlanBody = Body<operations["saveDebtPlan"]>;
/** `POST /v1/debts/strategy`: Avalanche and Snowball for one total (FR 6). */
export type Strategies = Json<operations["compareDebtStrategies"]>;
export type StrategyBody = Body<operations["compareDebtStrategies"]>;

/** A calculation of the server: nothing yet (`idle`), under way, ready or failed. The last result stays while the next one loads. */
export type Calc<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly last: T | null }
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "error"; readonly last: T | null };

type Answer<T> = { readonly token: string; readonly data: T | null; readonly failed: boolean };

/**
 * Runs `run` for each new `key` (null — nothing to ask); a stale answer is dropped. `retry` asks again. The state
 * holds only the answers; «idle» and «loading» follow from the key and the last answer.
 */
function useCalc<T>(
  key: string | null,
  run: () => Promise<{ ok: true; data: T } | { ok: false }>,
): { calc: Calc<T>; retry: () => void } {
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const token = `${key}#${attempt}`;
  useEffect(() => {
    if (key === null) return;
    let live = true;
    void run().then((o) => {
      if (live)
        setAnswer((prev) => ({
          token,
          data: o.ok ? o.data : (prev?.data ?? null),
          failed: !o.ok,
        }));
    });
    return () => {
      live = false;
    };
  }, [key, token, run]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  let calc: Calc<T>;
  if (key === null) calc = { kind: "idle" };
  else if (answer === null || answer.token !== token) calc = { kind: "loading", last: answer?.data ?? null };
  else if (answer.failed) calc = { kind: "error", last: answer.data };
  else calc = { kind: "ready", data: answer.data as T };
  return { calc, retry };
}

/** FR 4: the scenario is calculated again at each change of the assumptions; nothing is written. */
export function useScenario(accountId: string, body: ScenarioBody | null) {
  const api = useAuthApi();
  const key = body === null ? null : JSON.stringify(body);
  const run = useCallback(async () => {
    const o = await outcome(
      api.POST("/v1/debts/{accountId}/scenario", {
        params: { path: { accountId } },
        body: JSON.parse(key ?? "{}") as ScenarioBody,
      }),
    );
    return o.ok ? ({ ok: true, data: o.data } as const) : ({ ok: false } as const);
  }, [api, accountId, key]);
  return useCalc<Scenario>(key === null ? null : `${accountId}:${key}`, run);
}

/** FR 6: both strategies for «Усього на борги / міс.» at once; nothing is written. */
export function useStrategies(body: StrategyBody | null) {
  const api = useAuthApi();
  const key = body === null ? null : JSON.stringify(body);
  const run = useCallback(async () => {
    const o = await outcome(
      api.POST("/v1/debts/strategy", { body: JSON.parse(key ?? "{}") as StrategyBody }),
    );
    return o.ok ? ({ ok: true, data: o.data } as const) : ({ ok: false } as const);
  }, [api, key]);
  return useCalc<Strategies>(key, run);
}

/** FR 5: «Зберегти план» (one plan per debt); the debt's own data is not changed. */
export function useSavePlan(accountId: string) {
  const api = useAuthApi();
  return useCallback(
    async (body: PlanBody): Promise<boolean> =>
      (await outcome(api.PUT("/v1/debts/{accountId}/plan", { params: { path: { accountId } }, body }))).ok,
    [api, accountId],
  );
}

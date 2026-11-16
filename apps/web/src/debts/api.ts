import { useCallback, useEffect, useState } from "react";
import type { paths } from "@willowsum/api-contract";
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

export function useDebts(): { state: DebtsState; retry: () => void } {
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
  return { state, retry };
}

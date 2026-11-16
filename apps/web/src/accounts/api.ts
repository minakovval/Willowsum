import { useCallback, useEffect, useState } from "react";
import type { paths } from "@willowsum/api-contract";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";

/** One row of `GET /v1/accounts` (FIN-01@PoC FR 13, FR 14, FR 16, FR 19, FR 22; module `accounts`). */
export type Account =
  paths["/v1/accounts"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
/** «Гроші разом», the «Кредитні» header and «Джерела даних» (`GET /v1/accounts/summary`, FR 18, FR 19, FR 21). */
export type AccountsSummary =
  paths["/v1/accounts/summary"]["get"]["responses"]["200"]["content"]["application/json"];
export type MoneyValue = { readonly amount: string; readonly currency: string };

/**
 * What a block of the page shows. `off` — the function is switched off for the space (flag `accounts.manual`: 404
 * as an unknown path) or its module is (503); `error` carries the problem's support code for «Код: …».
 */
export type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly supportId?: string };

function settle<T>(o: Outcome<T>): Loaded<T> {
  if (o.ok) return { kind: "ready", data: o.data };
  if (o.kind === "problem" && (o.problem.code === "NOT_FOUND" || o.problem.code === "MODULE_UNAVAILABLE"))
    return { kind: "off" };
  return o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" };
}

/** The most pages read for one list: 100 rows each, far above any household's accounts. */
const MAX_PAGES = 20;

/**
 * All accounts of the space, page by page (the API pages at most 100 rows), in the order they were added.
 * `includeClosed` — «Параметри» → «Показати закриті» (FR 22).
 */
export function useAccounts(includeClosed: boolean): {
  state: Loaded<readonly Account[]>;
  retry: () => void;
} {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loaded<readonly Account[]>>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    // «Показати закриті» keeps the list on screen (and the focus on «Параметри») while the new list loads.
    void (async () => {
      const rows: Account[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const o = await outcome(
          api.GET("/v1/accounts", {
            params: {
              query: {
                limit: 100,
                ...(includeClosed ? { includeClosed: "true" as const } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        );
        if (!live) return;
        if (!o.ok) {
          setState(settle(o));
          return;
        }
        rows.push(...o.data.items);
        cursor = o.data.nextCursor ?? undefined;
        if (!cursor) break;
      }
      setState({ kind: "ready", data: rows });
    })();
    return () => {
      live = false;
    };
  }, [api, includeClosed, attempt]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}

/** «Гроші разом», the debt of the «Кредитні» group and «Джерела даних» of the active accounts. */
export function useAccountsSummary(): { state: Loaded<AccountsSummary>; retry: () => void } {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loaded<AccountsSummary>>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/accounts/summary")).then((o) => {
      if (live) setState(settle(o));
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

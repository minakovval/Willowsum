import { useCallback, useEffect, useState } from "react";
import type { ApiClient, paths } from "@willowsum/api-contract";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import { accountNames, failed, type Loaded } from "./list.ts";
import type { Transaction } from "./api.ts";

/**
 * IMP-03@PoC c) (wave 2, row 139): what S-059 «Пари» and «Позначити як переказ» read and send, on the merged server part
 * (#749): `GET /v1/transfer-proposals`, `POST …/transfer` («Підтвердити», «Поєднати в пару»), `POST …/not-transfer` («Не
 * пара») and `GET …/transfer-candidates`. The screen only shows what the server gives: no sums or rates are worked out here.
 */
export type Proposals =
  paths["/v1/transfer-proposals"]["get"]["responses"]["200"]["content"]["application/json"];
export type Proposal = Proposals["items"][number];
export type Counterparts =
  paths["/v1/transactions/{transactionId}/transfer-candidates"]["get"]["responses"]["200"]["content"]["application/json"];
export type Counterpart = Counterparts["items"][number];

export interface PairsData {
  readonly proposals: Proposals;
  /** Account label («Поточний ··4417») by id; a failed read leaves the id without a name. */
  readonly names: ReadonlyMap<string, string>;
}

/** The open proposals with the account names, read again by `reload` (after an action, «Шукати пари знову»). */
export function usePairs(): { state: Loaded<PairsData>; reload: () => void; reloading: boolean } {
  const api = useAuthApi();
  const [state, setState] = useState<Loaded<PairsData>>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [o, names] = await Promise.all([outcome(api.GET("/v1/transfer-proposals")), accountNames(api)]);
      if (!live) return;
      setReloading(false);
      setState(o.ok ? { kind: "ready", data: { proposals: o.data, names } } : failed(o));
    })();
    return () => {
      live = false;
    };
  }, [api, version]);
  const reload = useCallback(() => {
    setReloading(true);
    setVersion((v) => v + 1);
  }, []);
  return { state, reload, reloading };
}

/** «Підтвердити» a proposal and «Поєднати в пару»: the outflow marked with the inflow as its counterpart. */
export const markPair = (
  api: ApiClient,
  transactionId: string,
  counterpartId: string,
): Promise<Outcome<Transaction>> =>
  outcome(
    api.POST("/v1/transactions/{transactionId}/transfer", {
      params: { path: { transactionId } },
      body: { counterpartId },
    }),
  ) as Promise<Outcome<Transaction>>;

/** «Не пара»: never proposed again (IMP-03 FR 12). */
export const dismissPair = (api: ApiClient, transactionId: string, counterpartId: string) =>
  outcome(
    api.POST("/v1/transactions/{transactionId}/not-transfer", {
      params: { path: { transactionId } },
      body: { counterpartId },
    }),
  );

/** The candidates of «Позначити як переказ» (FR 24), read when the dialog opens. */
export function useCounterparts(transactionId: string): {
  state: Loaded<{ counterparts: Counterparts; names: ReadonlyMap<string, string> }>;
  reload: () => void;
} {
  const api = useAuthApi();
  const [state, setState] = useState<
    Loaded<{ counterparts: Counterparts; names: ReadonlyMap<string, string> }>
  >({
    kind: "loading",
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [o, names] = await Promise.all([
        outcome(
          api.GET("/v1/transactions/{transactionId}/transfer-candidates", {
            params: { path: { transactionId } },
          }),
        ),
        accountNames(api),
      ]);
      if (!live) return;
      setState(o.ok ? { kind: "ready", data: { counterparts: o.data, names } } : failed(o));
    })();
    return () => {
      live = false;
    };
  }, [api, transactionId, version]);
  const reload = useCallback(() => {
    setState({ kind: "loading" });
    setVersion((v) => v + 1);
  }, []);
  return { state, reload };
}
